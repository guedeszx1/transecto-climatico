// Tela: arquivos, ajustes, abas de variável, faixa de azulejos, resumo, legenda e downloads.
// O cálculo pesado roda em trabalhador.js (Worker); o desenho da linha é em blocos (mapa.js).
import { lerLeituras, lerTrajeto } from './parsers.js';
import { detectarFuso, estatisticas, paraCsv, paraGeoJson } from './cruzar.js';
import {
  VARIAVEIS, criarMapa, desenharTrajeto, destacarTrecho, limparDestaque, irParaTrecho, corDe, gradienteCss, faixa, aplicarTemaMapa,
} from './mapa.js';
import { desenharAzulejos } from './azulejos.js';
import { tipoDoArquivo } from './rotear.js';
import { gerarFigura } from './figura.js';

const $ = (id) => document.getElementById(id);

const MEDIAS = {
  none: { tipo: 'metros', valor: 0 },
  m25: { tipo: 'metros', valor: 25 },
  m50: { tipo: 'metros', valor: 50 },
  m100: { tipo: 'metros', valor: 100 },
  m200: { tipo: 'metros', valor: 200 },
};

const CAMPOS_MAPA = [
  ['dataHora', 'Data e hora (uma coluna)'],
  ['data', 'Data'],
  ['hora', 'Hora'],
  ['temp', 'Temperatura (obrigatório)'],
  ['umid', 'Umidade (obrigatório)'],
  ['orvalho', 'Ponto de orvalho (opcional)'],
  ['alt', 'Altitude (opcional)'],
];

const UNIDADE = { temp: '°C', umid: '%', orvalho: '°C', alt: 'm' };
const NOME_VARIAVEL = { temp: 'Temperatura', umid: 'Umidade', orvalho: 'Ponto de orvalho', alt: 'Altitude' };
const ROTULO_EXEMPLO = 'Exemplo fictício: caminhada simulada em Recife (PE)';
// Exemplos prontos: arquivos em app/exemplos/.
const EXEMPLOS = {
  recife: { termo: 'exemplos/termo.csv', trajeto: 'exemplos/trajeto.kml', rotulo: ROTULO_EXEMPLO, nomeTermo: 'termo.csv', nomeTrajeto: 'trajeto.kml' },
};
const TEXTO_VAZIO = 'Envie os dois arquivos para ver o trajeto';
const CANCELADO = 'cancelado';
// tempo até o aviso de progresso aparecer: operação mais rápida não pisca na tela
const ATRASO_PROGRESSO_MS = 150;

const estado = {
  termo: null, // { buf, nome, res }
  trajeto: null, // { buf, nome, res }
  fuso: -3,
  fusoDetectado: null,
  semHorario: false,
  cruzado: null, // { modo, semDado, avisos } da última rodada do Worker
  exibidos: null, // série suavizada, usada no mapa, nos downloads e na figura
  lista: [], // trechos atuais (azulejos)
  mapa: null,
  variavel: 'temp',
  faixa: null, // { min, max } da escala atual
  azulejos: null,
  avisos: [],
  rotuloExemplo: null, // rótulo do exemplo carregado; null quando os arquivos são do usuário
  calcId: 0, // cada pedido ao Worker ganha um número; só o último vale
  desenhoId: 0, // cada desenho ganha um número; um desenho mais novo cancela o anterior
  trabalhador: null,
  rejeitarPendente: null,
  desenhando: false,
  zoomTimer: null,
  ritmo: null, // { inicioMs, fimMs, inverter } do modo distância; null quando o trajeto tem horário
  limitesRitmo: null, // { min, max } em ms: primeira e última leitura (com segundos inteiros)
};

// ---------- utilitários de tela ----------

function mostrarErro(msg) {
  const el = $('erro');
  el.textContent = msg;
  el.hidden = !msg;
  if (msg && !estado.cruzado) mostrarVazio('erro', msg);
}

function mostrarAvisos(lista) {
  const ul = $('avisos');
  ul.replaceChildren();
  for (const a of lista) {
    const li = document.createElement('li');
    li.textContent = a;
    ul.appendChild(li);
  }
  $('bloco-avisos').hidden = lista.length === 0;
}

// Estado do mapa vazio: 'padrao', 'carregando' ou 'erro'.
function mostrarVazio(tipo, texto = '') {
  const caixa = document.querySelector('.vazio-caixa');
  const titulo = $('vazio-titulo');
  const corpo = $('vazio-texto');
  caixa.classList.toggle('carregando', tipo === 'carregando');
  caixa.classList.toggle('erro', tipo === 'erro');
  if (tipo === 'carregando') {
    titulo.textContent = 'Lendo os arquivos…';
    corpo.textContent = 'Isto leva alguns segundos.';
  } else if (tipo === 'erro') {
    titulo.textContent = 'Não deu para gerar o mapa';
    corpo.textContent = texto;
  } else {
    titulo.textContent = TEXTO_VAZIO;
    corpo.textContent = 'Termohigrômetro e trajeto da caminhada. Os arquivos ficam no seu computador.';
  }
  $('exemplos').hidden = tipo === 'carregando';
  $('vazio').hidden = false;
}

function esconderVazio() {
  $('vazio').hidden = true;
}

// ---------- progresso: aviso sobre o mapa, só se a operação passar de ~150 ms ----------

let progressoTimer = null;
let progressoVisivel = false;

function mostrarProgresso(passo, pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  $('progresso-passo').textContent = passo;
  $('progresso-barra').style.width = `${p}%`;
  $('progresso-pct').textContent = `${p}%`;
  $('progresso-trilho').setAttribute('aria-valuenow', String(p));
  if (!progressoVisivel && progressoTimer === null) {
    progressoTimer = setTimeout(() => {
      progressoTimer = null;
      progressoVisivel = true;
      $('progresso').hidden = false;
    }, ATRASO_PROGRESSO_MS);
  }
}

function esconderProgresso() {
  clearTimeout(progressoTimer);
  progressoTimer = null;
  progressoVisivel = false;
  $('progresso').hidden = true;
}

function formatarNumero(v, casas) {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(casas).replace('.', ',');
}

// "51 min" ou "1 h 05 min"
function formatarDuracao(ms) {
  const minutos = Math.round(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, '0')} min`;
}

function formatarDistancia(m) {
  return m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m';
}

function duracaoDosPontos(pontos) {
  const ts = pontos.filter((p) => p.t !== null && p.t !== undefined).map((p) => p.t);
  if (ts.length < 2) return '';
  return formatarDuracao(Math.max(...ts) - Math.min(...ts));
}

// transecto_media-50m.csv, ou transecto_sem-media.csv
function nomeArquivo(ext) {
  const m = $('media').value;
  const janela = m === 'none' ? 'sem-media' : `media-${m.slice(1)}m`;
  return `transecto_${janela}.${ext}`;
}

function baixar(nome, conteudo, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "o horário de Brasília (UTC−3)" ou "o fuso UTC+2"
function fusoTexto(f) {
  if (f === -3) return 'o horário de Brasília (UTC−3)';
  return `o fuso UTC${f >= 0 ? '+' : '−'}${Math.abs(f)}`;
}

function atualizarFraseFuso() {
  const frase = $('fuso-frase');
  if (estado.semHorario) {
    frase.textContent = 'O trajeto não tem horário: as leituras foram distribuídas pela distância.';
  } else if (estado.fuso === estado.fusoDetectado) {
    frase.textContent = `Reconhecemos ${fusoTexto(estado.fuso)}.`;
  } else {
    frase.textContent = `Usando ${fusoTexto(estado.fuso)}.`;
  }
}

function marcarArquivo(tipo, nome) {
  $(`nome-${tipo}`).textContent = nome;
  $(`zona-${tipo}`).classList.add('com-arquivo');
}

// ---------- arquivos: escolher ou soltar; o site descobre o campo pela extensão ----------

const NOME_TIPO = { termo: 'termohigrômetro', trajeto: 'trajeto' };
const ACEITOS = 'Aceito a tabela do termohigrômetro (.csv, .txt, .tsv, .xlsx, .xls) e o trajeto (.kml, .kmz, .gpx).';

function mensagemNaoReconhecido(nome) {
  if (/\.pdf$/i.test(nome)) return `${nome}: PDF não é aceito. Exporte a tabela do aparelho em CSV ou Excel.`;
  return `Não reconheci "${nome}". ${ACEITOS}`;
}

function mostrarEnvioAviso(texto) {
  const el = $('envio-aviso');
  el.textContent = texto;
  el.hidden = !texto;
}

// Recebe um ou vários arquivos (escolhidos ou soltos) e manda cada um para o campo certo.
// Não gera o mapa: isso continua no botão Gerar mapa.
async function receberArquivos(arquivos) {
  if (!arquivos.length) return;
  const erros = [];
  const avisos = [];
  const porTipo = { termo: [], trajeto: [] };
  for (const f of arquivos) {
    const tipo = tipoDoArquivo(f.name);
    if (tipo) porTipo[tipo].push(f);
    else erros.push(mensagemNaoReconhecido(f.name));
  }
  const escolhidos = [];
  for (const tipo of ['termo', 'trajeto']) {
    const lista = porTipo[tipo];
    if (!lista.length) continue;
    const ultimo = lista[lista.length - 1];
    if (lista.length > 1) {
      const ignorados = lista.slice(0, -1).map((f) => `"${f.name}"`).join(', ');
      avisos.push(`Dois arquivos de ${NOME_TIPO[tipo]} no mesmo envio: fiquei com "${ultimo.name}" e ignorei ${ignorados}.`);
    }
    escolhidos.push([tipo, ultimo]);
  }

  mostrarErro(erros.join(' '));
  mostrarEnvioAviso(avisos.join(' '));
  if (!escolhidos.length) return;
  mostrarEnvioResumido(false);
  for (const [tipo, f] of escolhidos) await escolherArquivo(tipo, f);
}

function ligarZona(idZona, idInput) {
  const zona = $(idZona);
  const input = $(idInput);
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    const arquivos = [...input.files];
    input.value = '';
    receberArquivos(arquivos);
  });
}

// Soltar arquivos em qualquer lugar da barra lateral. Fora dela, o navegador não abre o arquivo.
function ligarSoltar() {
  const painel = $('painel-lateral');
  const barra = $('solte-aqui');
  let contador = 0;
  const temArquivos = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const mostrar = (ligado) => { barra.hidden = !ligado; };

  painel.addEventListener('dragenter', (e) => {
    if (!temArquivos(e)) return;
    e.preventDefault();
    contador++;
    mostrar(true);
  });
  painel.addEventListener('dragover', (e) => {
    if (!temArquivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  painel.addEventListener('dragleave', (e) => {
    if (!temArquivos(e)) return;
    contador = Math.max(0, contador - 1);
    if (!contador) mostrar(false);
  });
  painel.addEventListener('drop', (e) => {
    e.preventDefault();
    contador = 0;
    mostrar(false);
    receberArquivos([...e.dataTransfer.files]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

async function escolherArquivo(tipo, file) {
  const buf = await file.arrayBuffer();
  estado[tipo] = { buf, nome: file.name, res: null };
  estado.rotuloExemplo = null;
  marcarArquivo(tipo, file.name);
  $('gerar').disabled = !(estado.termo && estado.trajeto);
}

// ---------- mapeamento manual de colunas ----------

function mostrarMapeamento(res) {
  const caixa = $('mapeamento');
  const lista = $('campos-mapeamento');
  lista.replaceChildren();
  for (const [chave, rotulo] of CAMPOS_MAPA) {
    const linha = document.createElement('label');
    linha.className = 'campo-map';
    const span = document.createElement('span');
    span.textContent = rotulo;
    const sel = document.createElement('select');
    sel.dataset.chave = chave;
    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.textContent = '(nenhuma)';
    sel.appendChild(vazio);
    for (const c of res.colunas) {
      const op = document.createElement('option');
      op.value = c;
      op.textContent = c;
      sel.appendChild(op);
    }
    sel.value = res.mapeamento[chave] || '';
    linha.append(span, sel);
    lista.appendChild(linha);
  }
  caixa.hidden = false;
}

function lerMapeamentoDaTela() {
  const mapa = {};
  for (const sel of document.querySelectorAll('#campos-mapeamento select')) {
    mapa[sel.dataset.chave] = sel.value || null;
  }
  return mapa;
}

// ---------- exemplo ----------

async function carregarExemplo(chave) {
  const t0 = performance.now();
  const cfg = EXEMPLOS[chave];
  mostrarErro('');
  mostrarVazio('carregando');
  try {
    const [rt, rk] = await Promise.all([fetch(cfg.termo), fetch(cfg.trajeto)]);
    if (!rt.ok || !rk.ok) throw new Error('não encontrei os arquivos de exemplo na pasta do app.');
    estado.termo = { buf: await rt.arrayBuffer(), nome: cfg.nomeTermo, res: null };
    estado.trajeto = { buf: await rk.arrayBuffer(), nome: cfg.nomeTrajeto, res: null };
    marcarArquivo('termo', cfg.rotulo);
    marcarArquivo('trajeto', cfg.rotulo);
    estado.rotuloExemplo = cfg.rotulo;
    $('gerar').disabled = false;
    await gerar(t0);
  } catch (err) {
    console.error(err);
    mostrarErro('Não consegui carregar o exemplo: ' + (err && err.message ? err.message : err));
  }
}

// Tempo do clique até a tela pronta (medido depois da pintura).
function mostrarTempo(ms) {
  const el = $('tempo');
  el.textContent = `Processado em ${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  el.hidden = false;
}

// ---------- Worker: cálculo fora da página ----------

// Cancela o cálculo em andamento: o Worker é encerrado e a promessa pendente é rejeitada.
function pararTrabalho() {
  if (estado.trabalhador) {
    estado.trabalhador.terminate();
    estado.trabalhador = null;
  }
  if (estado.rejeitarPendente) {
    const rejeitar = estado.rejeitarPendente;
    estado.rejeitarPendente = null;
    rejeitar(new Error(CANCELADO));
  }
}

function calcularNoTrabalhador(dados) {
  pararTrabalho();
  return new Promise((resolver, rejeitar) => {
    const w = new Worker(new URL('./trabalhador.js', import.meta.url), { type: 'module' });
    estado.trabalhador = w;
    estado.rejeitarPendente = rejeitar;

    const encerrar = () => {
      w.terminate();
      if (estado.trabalhador === w) estado.trabalhador = null;
      if (estado.rejeitarPendente === rejeitar) estado.rejeitarPendente = null;
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === 'progresso') {
        mostrarProgresso(m.passo, m.pct);
      } else if (m.tipo === 'ok') {
        encerrar();
        resolver(m);
      } else if (m.tipo === 'erro') {
        encerrar();
        rejeitar(new Error(m.mensagem));
      }
    };
    w.onerror = (ev) => {
      encerrar();
      rejeitar(new Error(ev.message || 'falha no processamento'));
    };
    w.postMessage(dados);
  });
}

// ---------- trajeto sem horário: início, fim e sentido ----------

// Instante em ms (como nas leituras) para o campo datetime-local, com segundos.
function paraLocal(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}

// Valor do campo datetime-local ("AAAA-MM-DDTHH:MM" ou com segundos) para ms; NaN se vazio.
function deLocal(v) {
  if (!v) return NaN;
  const texto = v.length === 16 ? `${v}:00` : v;
  return Date.parse(`${texto}Z`);
}

function horaDe(ms) {
  return new Date(ms).toISOString().slice(11, 19);
}

// Primeira e última leitura com horário, arredondadas para o segundo.
function definirLimitesRitmo() {
  let min = Infinity;
  let max = -Infinity;
  for (const l of estado.termo.res.leituras) {
    if (!Number.isFinite(l.t)) continue;
    if (l.t < min) min = l.t;
    if (l.t > max) max = l.t;
  }
  if (!Number.isFinite(min)) {
    estado.limitesRitmo = null;
    return false;
  }
  estado.limitesRitmo = { min: Math.floor(min / 1000) * 1000, max: Math.ceil(max / 1000) * 1000 };
  for (const id of ['inicio', 'fim']) {
    $(id).min = paraLocal(estado.limitesRitmo.min);
    $(id).max = paraLocal(estado.limitesRitmo.max);
  }
  return true;
}

// Ritmo padrão: a caminhada inteira. manterInverter preserva a caixa "Inverter".
function setRitmoPadrao(manterInverter) {
  if (!definirLimitesRitmo()) return;
  const { min, max } = estado.limitesRitmo;
  const inverter = manterInverter ? $('inverter').checked : false;
  $('inverter').checked = inverter;
  estado.ritmo = { inicioMs: min, fimMs: max, inverter };
  restaurarCamposRitmo();
}

// Mostra nos campos o ritmo que está valendo (usado também quando uma entrada é recusada).
function restaurarCamposRitmo() {
  if (!estado.ritmo) return;
  $('inicio').value = paraLocal(estado.ritmo.inicioMs);
  $('fim').value = paraLocal(estado.ritmo.fimMs);
  $('inverter').checked = estado.ritmo.inverter;
}

function contarLeiturasNoIntervalo(ini, fim) {
  let n = 0;
  for (const l of estado.termo.res.leituras) if (Number.isFinite(l.t) && l.t >= ini && l.t <= fim) n++;
  return n;
}

// Lê os campos, valida e recalcula. Entrada recusada: erro no #erro e o resultado anterior segue.
function aplicarRitmoDaTela() {
  if (!estado.cruzado || !estado.limitesRitmo) return;
  const { min, max } = estado.limitesRitmo;
  let ini = deLocal($('inicio').value);
  let fim = deLocal($('fim').value);
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) {
    restaurarCamposRitmo();
    mostrarErro('Escolha a data e a hora de início e de fim da caminhada.');
    return;
  }
  ini = Math.min(max, Math.max(min, ini));
  fim = Math.min(max, Math.max(min, fim));
  if (fim <= ini) {
    restaurarCamposRitmo();
    mostrarErro('O início da caminhada precisa ser antes do fim.');
    return;
  }
  const n = contarLeiturasNoIntervalo(ini, fim);
  if (n < 2) {
    restaurarCamposRitmo();
    mostrarErro(`Só ${n} leitura(s) entre esses horários. Escolha um intervalo com pelo menos 2.`);
    return;
  }
  mostrarErro('');
  estado.ritmo = { inicioMs: ini, fimMs: fim, inverter: $('inverter').checked };
  restaurarCamposRitmo();
  recruzar(false);
}

// Frase com os números reais, e aviso curto se o ritmo estiver fora do que é de caminhada.
function atualizarRitmo(info) {
  const vel = info.velocidadeMs;
  const velTxt = vel === null ? '—' : vel.toFixed(1).replace('.', ',');
  const metros = info.metrosPorLeitura === null ? '—' : String(Math.round(info.metrosPorLeitura));
  const invertido = estado.ritmo && estado.ritmo.inverter ? ' O sentido do trajeto está invertido.' : '';
  $('frase-ritmo').textContent =
    `Sem horário no trajeto, consideramos que você andou em ritmo constante. ` +
    `A leitura das ${horaDe(info.inicioMs)} fica no começo do caminho, a das ${horaDe(info.fimMs)} no fim, ` +
    `e as outras são distribuídas pela distância percorrida: ${info.nUsadas} leituras, uma a cada ${metros} m, a ${velTxt} m/s.${invertido}`;

  const incomum = vel !== null && (vel < 0.3 || vel > 3);
  const aviso = $('aviso-ritmo');
  aviso.textContent = incomum ? `Ritmo incomum para uma caminhada: ${velTxt} m/s. Confira o início e o fim.` : '';
  aviso.hidden = !incomum;
}

// ---------- gerar ----------

async function gerar(t0 = performance.now()) {
  mostrarErro('');
  $('tempo').hidden = true;
  estado.avisos = [];
  $('gerar').disabled = true;
  if (!estado.cruzado) mostrarVazio('carregando');
  try {
    const mapeamentoManual = $('mapeamento').hidden ? undefined : lerMapeamentoDaTela();
    const termo = lerLeituras(estado.termo.buf, estado.termo.nome, mapeamentoManual);
    estado.termo.res = termo;
    estado.avisos.push(...termo.avisos);

    const faltaCampo = termo.leituras.length === 0 || !termo.mapeamento.temp || !termo.mapeamento.umid;
    if (faltaCampo) {
      mostrarMapeamento(termo);
      mostrarAvisos(estado.avisos);
      mostrarErro('Não consegui achar horário, temperatura e umidade no termohigrômetro. Escolha as colunas em "Colunas do termohigrômetro" e clique em "Aplicar".');
      return;
    }
    $('mapeamento').hidden = true;

    const trajeto = await lerTrajeto(estado.trajeto.buf, estado.trajeto.nome);
    estado.trajeto.res = trajeto;
    estado.avisos.push(...trajeto.avisos);
    if (!trajeto.pontos.length) {
      mostrarAvisos(estado.avisos);
      mostrarErro('Não encontrei pontos no trajeto. Confira se o arquivo é KML, KMZ ou GPX com a linha da caminhada.');
      return;
    }

    const fuso = detectarFuso(termo.leituras, trajeto.pontos);
    estado.fusoDetectado = fuso;
    estado.semHorario = fuso === null;
    estado.fuso = fuso === null ? -3 : fuso;
    const campoFuso = $('fuso');
    campoFuso.disabled = fuso === null;
    campoFuso.value = String(estado.fuso);
    if (fuso === null) setRitmoPadrao(false);
    else estado.ritmo = null;

    await recruzar(true, t0);
  } catch (err) {
    console.error(err);
    mostrarErro('Erro ao processar: ' + (err && err.message ? err.message : err));
  } finally {
    $('gerar').disabled = !(estado.termo && estado.trajeto);
  }
}

// Cruza, suaviza e monta os trechos no Worker; depois desenha. Só o último pedido vale.
async function recruzar(enquadrar, t0 = null) {
  const fusoCampo = Number($('fuso').value);
  if (!$('fuso').disabled) estado.fuso = Number.isFinite(fusoCampo) ? fusoCampo : -3;
  const id = ++estado.calcId;
  mostrarProgresso('Preparando', 0);

  let r;
  try {
    r = await calcularNoTrabalhador({
      leituras: estado.termo.res.leituras,
      pontos: estado.trajeto.res.pontos,
      fuso: estado.fuso,
      media: MEDIAS[$('media').value] || MEDIAS.m50,
      ritmo: estado.semHorario ? estado.ritmo : null,
    });
  } catch (err) {
    if (err.message === CANCELADO || id !== estado.calcId) return;
    esconderProgresso();
    mostrarErro('Erro no processamento: ' + err.message);
    return;
  }
  if (id !== estado.calcId) return;

  estado.cruzado = r.cruzado;
  estado.exibidos = r.exibidos;
  estado.lista = r.lista;
  $('bloco-ritmo').hidden = !estado.semHorario;
  if (estado.semHorario) atualizarRitmo(r.cruzado.info);
  mostrarAvisos([...estado.avisos, ...estado.cruzado.avisos]);
  atualizarFraseFuso();

  if (!estado.mapa) {
    estado.mapa = criarMapa($('mapa'));
    // ao trocar o zoom, a linha é redesenhada (os segmentos do mesmo pixel mudam)
    estado.mapa.mapa.on('zoomend', aoZoom);
  }
  esconderVazio();
  $('faixa-dados').hidden = false;
  $('faixa-estado').hidden = true;
  mostrarEnvioResumido(true);
  $('painel-resultado').hidden = false;
  $('downloads').hidden = false;
  for (const idBotao of ['baixar-csv', 'baixar-geojson', 'baixar-figura']) $(idBotao).disabled = false;

  await desenhar(enquadrar);
  if (t0 !== null && id === estado.calcId) requestAnimationFrame(() => mostrarTempo(performance.now() - t0));
}

// Com o mapa pronto, os campos de envio viram uma linha: "Arquivos: termo.csv e trajeto.kml".
function mostrarEnvioResumido(resumido) {
  $('envio-campos').hidden = resumido;
  $('envio-resumo').hidden = !resumido;
  if (resumido && estado.termo && estado.trajeto) {
    const sufixo = estado.rotuloExemplo ? `. ${estado.rotuloExemplo}` : '.';
    $('arquivos-texto').textContent = `Arquivos: ${estado.termo.nome} e ${estado.trajeto.nome}${sufixo}`;
  }
}

// ---------- renderização: linha, faixa, resumo e legenda juntos ----------

function resumoTexto() {
  const pontos = estado.exibidos;
  const v = estado.variavel;
  const e = estatisticas(pontos, v);
  if (e.n === 0) return 'Sem valores para esta variável neste trajeto.';
  const casas = VARIAVEIS[v].casas;
  const total = pontos.length ? pontos[pontos.length - 1].dist : 0;
  const dur = duracaoDosPontos(pontos);
  let texto = `Média ${formatarNumero(e.media, casas)} ${UNIDADE[v]}, de ${formatarNumero(e.min, casas)} a ${formatarNumero(e.max, casas)}, ${formatarDistancia(total)}`;
  if (dur) texto += ` em ${dur}`;
  texto += '.';
  if (estado.cruzado.semDado > 0) texto += ` ${estado.cruzado.semDado} pontos sem dado.`;
  return texto;
}

function tocarTrecho(i) {
  const pontos = estado.exibidos;
  const t = estado.lista[i];
  if (!t || t.iIni === null) return;
  irParaTrecho(estado.mapa, pontos, t.iIni, t.iFim);
  destacarTrecho(estado.mapa, pontos, t.iIni, t.iFim);
  estado.azulejos.destacar(i);
}

// Azulejos, resumo, legenda e abas: tudo que é rápido, feito de uma vez.
function atualizarFaixa(min, max) {
  const variavel = estado.variavel;
  const pontos = estado.exibidos;
  const casas = VARIAVEIS[variavel].casas;

  estado.azulejos = desenharAzulejos($('azulejos'), estado.lista, {
    variavel,
    casas,
    cor: corDe(variavel, min, max),
    aoTocar: tocarTrecho,
    aoPassar: (i) => {
      const t = estado.lista[i];
      if (t && t.iIni !== null) destacarTrecho(estado.mapa, pontos, t.iIni, t.iFim);
    },
    aoSair: () => limparDestaque(estado.mapa),
  });
  $('resumo').textContent = resumoTexto();
  $('explicacao-orvalho').hidden = variavel !== 'orvalho';
  $('legenda-gradiente').style.background = gradienteCss(variavel);
  $('legenda-min').textContent = formatarNumero(min, casas);
  $('legenda-max').textContent = formatarNumero(max, casas);

  for (const aba of document.querySelectorAll('#variavel [role="tab"]')) {
    aba.setAttribute('aria-selected', String(aba.dataset.valor === variavel));
  }
}

// Desenha a linha em blocos e atualiza a faixa. Um desenho mais novo cancela este.
async function desenhar(enquadrar) {
  const id = ++estado.desenhoId;
  const variavel = estado.variavel;
  const pontos = estado.exibidos;
  const { min, max } = faixa(pontos, variavel);
  estado.faixa = { min, max };
  atualizarFaixa(min, max);

  estado.desenhando = true;
  mostrarProgresso('Redesenhando o mapa', 0);
  try {
    const r = await desenharTrajeto(estado.mapa, pontos, variavel, estado.fuso, {
      enquadrar,
      aoPassar: (seg) => {
        const k = estado.azulejos ? estado.azulejos.doSegmento(seg) : -1;
        if (k < 0) return;
        estado.azulejos.destacar(k);
        const t = estado.lista[k];
        destacarTrecho(estado.mapa, pontos, t.iIni, t.iFim);
      },
      aoSair: () => {
        if (estado.azulejos) estado.azulejos.limpar();
        limparDestaque(estado.mapa);
      },
      progresso: (f) => mostrarProgresso('Redesenhando o mapa', f * 100),
      vigia: () => id === estado.desenhoId,
    });
    if (r !== null && id === estado.desenhoId) esconderProgresso();
  } finally {
    if (id === estado.desenhoId) estado.desenhando = false;
  }
}

// Zoom muda os pixels: redesenha depois de uma pausa, sem repetir o desenho que o próprio zoom causou.
function aoZoom() {
  if (estado.desenhando || !estado.exibidos) return;
  clearTimeout(estado.zoomTimer);
  estado.zoomTimer = setTimeout(() => desenhar(false), 200);
}

function escolherVariavel(valor) {
  estado.variavel = valor;
  if (estado.cruzado) desenhar(false);
}

// ---------- figura ----------

async function baixarFigura() {
  const botao = $('baixar-figura');
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Montando figura…';
  try {
    const v = estado.variavel;
    const { min, max } = estado.faixa;
    const blob = await gerarFigura({
      pontos: estado.exibidos,
      variavel: v,
      rotulo: NOME_VARIAVEL[v],
      unidade: UNIDADE[v],
      corDe: corDe(v, min, max),
      min,
      max,
      titulo: 'Transecto Climático',
      resumo: resumoTexto(),
      base: 'osm',
    });
    baixar(nomeArquivo('png'), blob, 'image/png');
  } catch (err) {
    console.error(err);
    mostrarErro('Não consegui montar a figura: ' + (err && err.message ? err.message : err));
  } finally {
    botao.textContent = textoOriginal;
    botao.disabled = false;
  }
}

// ---------- ligação ----------

function ligarEventos() {
  ligarZona('zona-termo', 'arquivo-termo');
  ligarZona('zona-trajeto', 'arquivo-trajeto');
  ligarSoltar();
  // troca de tema só recolore o contorno da linha: cálculo, zoom e seleção ficam como estão
  document.addEventListener('tema-mudou', () => aplicarTemaMapa(estado.mapa));

  $('gerar').addEventListener('click', () => gerar());
  $('aplicar-mapeamento').addEventListener('click', () => gerar());
  $('exemplo-recife').addEventListener('click', () => carregarExemplo('recife'));
  $('trocar-arquivos').addEventListener('click', () => mostrarEnvioResumido(false));

  const abas = [...document.querySelectorAll('#variavel [role="tab"]')];
  abas.forEach((aba, k) => {
    aba.addEventListener('click', () => escolherVariavel(aba.dataset.valor));
    aba.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const prox = abas[(k + (e.key === 'ArrowRight' ? 1 : abas.length - 1)) % abas.length];
      prox.focus();
      escolherVariavel(prox.dataset.valor);
    });
  });

  $('fuso').addEventListener('change', () => {
    if (!estado.cruzado) return;
    recruzar(false);
  });
  $('media').addEventListener('change', () => {
    if (!estado.cruzado) return;
    recruzar(false);
  });

  // trajeto sem horário: início, fim e sentido recalculam tudo
  $('inicio').addEventListener('change', aplicarRitmoDaTela);
  $('fim').addEventListener('change', aplicarRitmoDaTela);
  $('inverter').addEventListener('change', aplicarRitmoDaTela);
  $('usar-todas').addEventListener('click', () => {
    if (!estado.cruzado || !estado.limitesRitmo) return;
    setRitmoPadrao(true);
    mostrarErro('');
    recruzar(false);
  });

  $('baixar-csv').addEventListener('click', () => {
    if (estado.exibidos) {
      baixar(nomeArquivo('csv'), paraCsv(estado.exibidos, { fusoHoras: estado.fuso }), 'text/csv;charset=utf-8');
    }
  });
  $('baixar-geojson').addEventListener('click', () => {
    if (estado.exibidos) {
      baixar(
        nomeArquivo('geojson'),
        JSON.stringify(paraGeoJson(estado.exibidos, { fusoHoras: estado.fuso })),
        'application/geo+json'
      );
    }
  });
  $('baixar-figura').addEventListener('click', baixarFigura);
}

function iniciar() {
  if (!globalThis.L) {
    mostrarVazio('erro', 'A biblioteca do mapa (Leaflet) não carregou. Recarregue a página.');
    return;
  }
  mostrarVazio('padrao');
  ligarEventos();
}

iniciar();
