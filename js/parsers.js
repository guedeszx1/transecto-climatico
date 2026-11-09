// Grampo: lê o arquivo do termohigrômetro (lerLeituras) e o do trajeto (lerTrajeto).
// Roda no navegador e no Node. Sem DOM: o XML é lido por varredura simples.
// JSZip e XLSX vêm de globalThis (carregados pela página ou pelos testes).

// ---------------------------------------------------------------------------
// Sinônimos das colunas (já normalizados: sem acento, minúsculas, sem unidade)
// ---------------------------------------------------------------------------

const SINONIMOS = {
  dataHora: ['timestamp', 'datetime', 'date time', 'data hora', 'data e hora'],
  data: ['data', 'date'],
  hora: ['hora', 'time', 'horario', 'hora local'],
  temp: ['temperatura', 'temperature', 'temp', 't', 'air temp', 'oc'],
  umid: ['umidade', 'umidade relativa', 'humidity', 'relative humidity', 'rh', 'ur', 'umid'],
  orvalho: ['orvalho', 'dew point', 'dewpoint', 'td', 'ponto de orvalho', 'dew', 'dp'],
  alt: ['altitude', 'elevacao', 'elevation', 'elev', 'alt', 'altura', 'ele'],
};

const PAPEIS = ['dataHora', 'data', 'hora', 'temp', 'umid', 'orvalho', 'alt'];

// Colunas de numeração (No., Index, #...): nunca são tempo nem valor.
const IGNORADAS = new Set(['', 'no', 'n', 'nº', 'num', 'numero', 'index', 'indice', 'idx', 'id', 'row', 'sn']);

// ---------------------------------------------------------------------------
// Texto, separadores e colunas
// ---------------------------------------------------------------------------

function extensao(nome) {
  const m = String(nome || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function textoCelula(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function celVazia(v) {
  return textoCelula(v) === '';
}

// Decodifica bytes: UTF-8 (com ou sem BOM); se não for UTF-8 válido, Latin-1.
function decodificar(entrada) {
  if (typeof entrada === 'string') return entrada.replace(/^﻿/, '');
  const bytes = new Uint8Array(entrada);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

// "Temp_C", "T(°C)", "Umidade (%)", "p_orvalho" -> "temp c", "t", "umidade", "p orvalho"
function chaveColuna(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[%°*#,]/g, ' ')
    .replace(/[_\-./\\:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Casa se os tokens do sinônimo aparecem seguidos na chave da coluna.
function casa(chave, sinonimos) {
  const tokens = chave.split(' ').filter(Boolean);
  return sinonimos.some((s) => {
    const alvo = chaveColuna(s).split(' ');
    for (let i = 0; i + alvo.length <= tokens.length; i++) {
      if (alvo.every((t, j) => tokens[i + j] === t)) return true;
    }
    return false;
  });
}

function papelDaColuna(nome) {
  const chave = chaveColuna(nome);
  if (IGNORADAS.has(chave)) return null;
  return PAPEIS.find((p) => casa(chave, SINONIMOS[p])) ?? null;
}

function detectarSeparador(linhas) {
  const amostra = linhas.slice(0, 30);
  if (!amostra.length) return ',';
  const tem = (c) => amostra.filter((l) => l.includes(c)).length >= amostra.length / 2;
  if (tem(';')) return ';';
  if (tem('\t')) return '\t';
  return ',';
}

// Divide uma linha respeitando aspas duplas.
function dividirLinha(linha, sep) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

// Lê o arquivo como tabela: array de linhas, cada uma array de células.
function lerTabela(entrada, nomeArquivo, avisos) {
  const ext = extensao(nomeArquivo);
  if (ext === 'xlsx' || ext === 'xls') {
    if (!globalThis.XLSX) {
      avisos.push('Biblioteca de planilhas (XLSX) não carregada.');
      return [];
    }
    if (typeof entrada === 'string') {
      avisos.push('Planilha precisa ser lida como arquivo binário.');
      return [];
    }
    const wb = globalThis.XLSX.read(new Uint8Array(entrada), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const linhas = globalThis.XLSX.utils.sheet_to_json(ws, {
      header: 1, raw: true, defval: null, blankrows: false,
    });
    return linhas.filter((l) => !l.every(celVazia));
  }
  const texto = decodificar(entrada);
  const brutas = texto.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  const sep = detectarSeparador(brutas);
  return brutas.map((l) => dividirLinha(l, sep)).filter((l) => !l.every(celVazia));
}

// Linha com dados: tem data/hora ou pelo menos 3 números.
// Uma linha é de dados se a maioria das células preenchidas é número ou data (2 ou mais).
// Assim, "Start Time;08/06/2026" (metadado) não conta.
function pareceDado(linha) {
  let dados = 0;
  let preenchidas = 0;
  for (const c of linha) {
    if (celVazia(c)) continue;
    preenchidas++;
    if (typeof c === 'number') dados++;
    else if (lerData(textoCelula(c))) dados++;
    else if (/\d/.test(String(c)) && numero(c) !== null) dados++;
  }
  return dados >= 2 && dados * 2 >= preenchidas;
}

// Títulos: a última linha antes da primeira linha de dados que tem colunas reconhecidas
// (preâmbulo pode repetir palavras como "Temperature"). Prefere linha com 2 colunas.
function acharCabecalho(linhas) {
  const max = Math.min(linhas.length, 60);
  const primeiroDado = linhas.slice(0, max).findIndex(pareceDado);
  const fim = primeiroDado >= 0 ? primeiroDado : max;
  let comDuas = -1;
  let comUma = -1;
  for (let i = 0; i < fim; i++) {
    const n = linhas[i].filter((c) => typeof c === 'string' && c !== '' && papelDaColuna(c)).length;
    if (n >= 2) comDuas = i;
    else if (n >= 1) comUma = i;
  }
  if (comDuas >= 0) return comDuas;
  if (comUma >= 0) return comUma;
  return 0;
}

// Devolve índices das colunas por papel (-1 se não achou).
function detectarMapeamento(colunas) {
  const chaves = colunas.map(chaveColuna);
  const usadas = new Set();
  const achar = (papel) => {
    const i = chaves.findIndex((k, idx) => !usadas.has(idx) && !IGNORADAS.has(k) && casa(k, SINONIMOS[papel]));
    if (i >= 0) usadas.add(i);
    return i;
  };
  const idx = {};
  idx.dataHora = achar('dataHora');
  idx.data = achar('data');
  idx.hora = achar('hora');
  // Uma só coluna de data (ou de hora) com a data e a hora juntas.
  if (idx.dataHora < 0) {
    if (idx.data >= 0 && idx.hora < 0) { idx.dataHora = idx.data; idx.data = -1; }
    else if (idx.hora >= 0 && idx.data < 0) { idx.dataHora = idx.hora; idx.hora = -1; }
  }
  idx.temp = achar('temp');
  idx.umid = achar('umid');
  idx.orvalho = achar('orvalho');
  idx.alt = achar('alt');
  return idx;
}

function mapeamentoManual(m, colunas, avisos) {
  const idx = {};
  for (const p of PAPEIS) {
    const nome = m[p];
    if (!nome) { idx[p] = -1; continue; }
    const i = colunas.indexOf(nome);
    if (i < 0) avisos.push(`Coluna "${nome}" não encontrada no arquivo.`);
    idx[p] = i;
  }
  return idx;
}

function nomesMapeamento(idx, colunas) {
  const out = {};
  for (const p of PAPEIS) {
    const i = idx ? idx[p] : -1;
    out[p] = i >= 0 && colunas[i] !== '' ? colunas[i] : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Números, datas e horas
// ---------------------------------------------------------------------------

function numero(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || /^(-|--|n\/a|na|nan|null|#n\/a)$/i.test(s)) return null;
  s = s.replace(/\s/g, '').replace(/[^\d.,+\-eE]/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

function valorNum(linha, i) {
  return i >= 0 ? numero(linha[i]) : null;
}

// Número serial do Excel (dias desde 1899-12-30, sistema 1900) -> ms, lido como UTC.
function serialParaMs(v) {
  return Math.round((v - 25569) * 86400000);
}

function diaUtc(c) {
  if (c.mes < 1 || c.mes > 12 || c.dia < 1 || c.dia > 31) return null;
  const ms = Date.UTC(c.ano, c.mes - 1, c.dia);
  return new Date(ms).getUTCDate() === c.dia ? ms : null;
}

const RE_YMD = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?=$|[T\s])/i;
const RE_AAMMDD = /^(\d{2})-(\d{1,2})-(\d{1,2})(?=$|[T\s])/i;
// dd/mm/aaaa, dd.mm.aaaa, mm/dd/aa (HOBO): o mesmo separador nas duas pontas.
const RE_DMY = /^(\d{1,2})([\/.\-])(\d{1,2})\2(\d{4}|\d{2})(?=$|[T\s])/i;

// Lê a parte de data do texto. Devolve { resto, bases: [dia0, dia1], dica }.
// bases são ms do dia à meia-noite UTC. Quando dd/mm é ambíguo, bases[0] é dd/mm
// e bases[1] é mm/dd. dica 'dmy' ou 'mdy' quando um valor > 12 decide.
function lerData(texto) {
  const s = String(texto).trim();
  let m;
  let ano, mes, dia, p1, p2;
  if ((m = s.match(RE_YMD))) {
    ano = +m[1]; mes = +m[2]; dia = +m[3];
  } else if ((m = s.match(RE_AAMMDD))) {
    // Hífen com ano de 2 dígitos: dd-mm-aa (padrão brasileiro) ou aa-mm-dd.
    // Se o primeiro campo é um dia válido, são duas leituras; a ordem do arquivo decide.
    const resto = s.slice(m[0].length).replace(/^[T\s]+/i, '');
    const a = +m[1], b = +m[2], c = +m[3];
    const ymd = diaUtc({ ano: 2000 + a, mes: b, dia: c });
    const dmy = a >= 1 && a <= 31 ? diaUtc({ ano: 2000 + c, mes: b, dia: a }) : null;
    if (dmy === null) return { resto, bases: [ymd, ymd], dica: null };
    return { resto, bases: [dmy, ymd], dica: null, ymd: true };
  } else if ((m = s.match(RE_DMY))) {
    ano = m[4].length === 2 ? 2000 + +m[4] : +m[4];
    p1 = +m[1]; p2 = +m[3];
  } else {
    return null;
  }
  const resto = s.slice(m[0].length).replace(/^[T\s]+/i, '');
  if (p1 === undefined) {
    const b = diaUtc({ ano, mes, dia });
    return { resto, bases: [b, b], dica: null };
  }
  if (p1 > 12) {
    const b = diaUtc({ ano, mes: p2, dia: p1 });
    return { resto, bases: [b, b], dica: 'dmy' };
  }
  if (p2 > 12) {
    const b = diaUtc({ ano, mes: p1, dia: p2 });
    return { resto, bases: [b, b], dica: 'mdy' };
  }
  return {
    resto,
    bases: [diaUtc({ ano, mes: p2, dia: p1 }), diaUtc({ ano, mes: p1, dia: p2 })],
    dica: null,
  };
}

// Hora "HH:MM[:SS[.frac]] [AM|PM] [Z|±HH[:MM]]" -> { ms do dia, off ms } ou null.
const RE_HORA = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*([AaPp][Mm])?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

function lerHora(texto) {
  const m = String(texto).trim().match(RE_HORA);
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  const se = m[3] ? +m[3] : 0;
  const frac = m[4] ? Math.round(Number('0.' + m[4]) * 1000) : 0;
  if (m[5]) {
    if (h < 1 || h > 12) return null;
    const pm = m[5].toUpperCase() === 'PM';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || mi > 59 || se > 59) return null;
  let off = 0;
  const tz = m[6];
  if (tz && tz.toUpperCase() !== 'Z') {
    const sinal = tz[0] === '-' ? -1 : 1;
    const dig = tz.slice(1).replace(':', '');
    off = sinal * (Number(dig.slice(0, 2)) * 60 + Number(dig.slice(2, 4) || 0)) * 60000;
  }
  return { ms: ((h * 60 + mi) * 60 + se) * 1000 + frac, off, ampm: Boolean(m[5]) };
}

// Junta dia (com possíveis candidatos) e deslocamento em ms.
function combina(d, delta, ampm = false) {
  return { cand: d.bases.map((b) => (b === null ? null : b + delta)), dica: d.dica, ampm, ymd: Boolean(d.ymd) };
}

// Coluna única com data e hora juntas.
function lerTempoUnico(v) {
  if (typeof v === 'number') {
    const ms = serialParaMs(v);
    return { cand: [ms, ms], dica: null, ampm: false };
  }
  const d = lerData(textoCelula(v));
  if (!d) return null;
  const h = d.resto ? lerHora(d.resto) : { ms: 0, off: 0, ampm: false };
  if (!h) return null;
  return combina(d, h.ms - h.off, h.ampm);
}

// Data e hora em colunas separadas.
function lerTempoSeparado(vData, vHora) {
  let d;
  if (typeof vData === 'number') {
    const ms = serialParaMs(Math.floor(vData));
    d = { bases: [ms, ms], dica: null };
  } else {
    d = lerData(textoCelula(vData));
    if (!d) return null;
  }
  let delta;
  let ampm = false;
  if (typeof vHora === 'number') {
    delta = Math.round((((vHora % 1) + 1) % 1) * 86400000);
  } else {
    const h = lerHora(textoCelula(vHora));
    if (!h) return null;
    delta = h.ms - h.off;
    ampm = h.ampm;
  }
  return combina(d, delta, ampm);
}

// Linha de unidades ou de formato: nas colunas mapeadas não há número, só texto como
// "°C", "%", "dd-mm-yyyy", "hh:mm:ss". Exige pelo menos um marcador de unidade ou formato.
const RE_MARCA_UNIDADE = /°|%|\b(dd|mm|yy|yyyy|hh|ss|rh|hpa|kpa)\b|^[cfk]$/i;
function pareceLinhaUnidades(linha, idx) {
  const cols = [idx.dataHora, idx.data, idx.hora, idx.temp, idx.umid, idx.orvalho, idx.alt]
    .filter((i) => i >= 0);
  const textos = cols.map((i) => textoCelula(linha[i])).filter((s) => s !== '');
  if (!textos.length) return false;
  if (textos.some((s) => /\d/.test(s))) return false;
  return textos.some((s) => RE_MARCA_UNIDADE.test(s));
}

function lerTempoDaLinha(linha, idx) {
  if (idx.dataHora >= 0) return lerTempoUnico(linha[idx.dataHora]);
  if (idx.data >= 0 && idx.hora >= 0) return lerTempoSeparado(linha[idx.data], linha[idx.hora]);
  if (idx.data >= 0) return lerTempoUnico(linha[idx.data]);
  return null;
}

// Escolhe dd/mm (0) ou mm/dd (1) para o arquivo inteiro.
function escolherOrdem(tempos) {
  const validos = tempos.filter(Boolean);
  if (validos.some((t) => t.dica === 'dmy')) return 0;
  if (validos.some((t) => t.dica === 'mdy')) return 1;
  // Sem valor decisivo: a ordem que deixa os horários crescentes ganha.
  const inv = [0, 0];
  for (const k of [0, 1]) {
    let anterior = null;
    for (const t of validos) {
      const v = t.cand[k];
      if (v === null) continue;
      if (anterior !== null && v < anterior) inv[k]++;
      anterior = v;
    }
  }
  if (inv[0] !== inv[1]) return inv[1] < inv[0] ? 1 : 0;
  // Empate: horário com AM/PM indica formato americano (mm/dd); senão, dd/mm.
  // Com datas dd-mm-aa/aa-mm-dd, o empate fica com dd-mm-aa (índice 0).
  const comYmd = validos.some((t) => t.ymd);
  return !comYmd && validos.some((t) => t.ampm) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Termohigrômetro
// ---------------------------------------------------------------------------

/**
 * @param {string|ArrayBuffer} entrada conteúdo do arquivo
 * @param {string} nomeArquivo nome com extensão (.csv .txt .tsv .xlsx .xls)
 * @param {object} [mapeamento] nomes das colunas escolhidos pelo usuário
 * @returns {{colunas: string[], mapeamento: object, leituras: object[], avisos: string[]}}
 */
export function lerLeituras(entrada, nomeArquivo = '', mapeamento = null) {
  const avisos = [];
  const tabela = lerTabela(entrada, nomeArquivo, avisos);
  if (!tabela.length) {
    avisos.push('Arquivo sem dados.');
    return { colunas: [], mapeamento: nomesMapeamento(null, []), leituras: [], avisos };
  }

  const iCab = acharCabecalho(tabela);
  const colunas = tabela[iCab].map(textoCelula);
  const idx = mapeamento ? mapeamentoManual(mapeamento, colunas, avisos) : detectarMapeamento(colunas);
  const nomes = nomesMapeamento(idx, colunas);

  const temTempo = idx.dataHora >= 0 || (idx.data >= 0);
  const temValores = idx.temp >= 0 || idx.umid >= 0;
  if (!temTempo) avisos.push('Não encontrei coluna de data/hora. Escolha o mapeamento manualmente.');
  if (!temValores) avisos.push('Não encontrei coluna de temperatura nem de umidade. Escolha o mapeamento manualmente.');
  if (!temTempo || !temValores) return { colunas, mapeamento: nomes, leituras: [], avisos };

  // Linha de unidades logo após o cabeçalho (Kestrel: "DD-MM-YYYY HH:MM:SS,°C,%"): não é leitura.
  const dadosBrutos = tabela.slice(iCab + 1);
  const dados = dadosBrutos.length && pareceLinhaUnidades(dadosBrutos[0], idx)
    ? dadosBrutos.slice(1)
    : dadosBrutos;
  const tempos = dados.map((l) => (l.every(celVazia) ? null : lerTempoDaLinha(l, idx)));
  const ordem = escolherOrdem(tempos);
  if (ordem === 1 && tempos.some((t) => t && !t.ymd && t.cand[0] !== t.cand[1])) {
    avisos.push('Datas ambíguas (dd/mm ou mm/dd) lidas como mm/dd/aaaa, porque a ordem dos horários ficou crescente. Confira.');
  }
  if (tempos.some((t) => t && t.ymd && t.cand[0] !== t.cand[1])) {
    avisos.push(ordem === 1
      ? 'Datas com ano de 2 dígitos lidas como aa-mm-dd, porque a ordem dos horários ficou crescente. Confira.'
      : 'Datas com ano de 2 dígitos lidas como dd-mm-aa (padrão brasileiro). Confira.');
  }

  const leituras = [];
  let descartadas = 0;
  let primeira = null;
  dados.forEach((linha, k) => {
    if (linha.every(celVazia)) return;
    const t = tempos[k] ? tempos[k].cand[ordem] : null;
    const r = {
      t: t ?? null,
      temp: valorNum(linha, idx.temp),
      umid: valorNum(linha, idx.umid),
      orvalho: valorNum(linha, idx.orvalho),
      alt: valorNum(linha, idx.alt),
    };
    if (r.t === null || (r.temp === null && r.umid === null && r.orvalho === null && r.alt === null)) {
      descartadas++;
      primeira ??= k + 1;
      return;
    }
    leituras.push(r);
  });
  if (descartadas) {
    avisos.push(`${descartadas} linha(s) ignorada(s) por horário inválido ou sem valores (a primeira é a linha ${primeira} dos dados).`);
  }
  leituras.sort((a, b) => a.t - b.t);
  return { colunas, mapeamento: nomes, leituras, avisos };
}

// ---------------------------------------------------------------------------
// Trajeto (KML, KMZ, GPX)
// ---------------------------------------------------------------------------

// Horário ISO. Sem fuso é lido como UTC; com Z ou ±HH:MM é UTC real.
function tempoIso(texto) {
  const m = String(texto).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i,
  );
  if (!m) return null;
  const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
  let t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms);
  const tz = m[8];
  if (tz && tz.toUpperCase() !== 'Z') {
    const sinal = tz[0] === '-' ? -1 : 1;
    const dig = tz.slice(1).replace(':', '');
    t -= sinal * (Number(dig.slice(0, 2)) * 60 + Number(dig.slice(2, 4))) * 60000;
  }
  return Number.isNaN(t) ? null : t;
}

function novoPonto(lon, lat, ele, t, pontos) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return 1;
  pontos.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null, t: t ?? null });
  return 0;
}

function decodificarEntidades(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

// Placemark inteiro, ou um gx:Track / LineString / Point solto.
const RE_BLOCO_KML = /<Placemark\b[^>]*>[\s\S]*?<\/Placemark>|<gx:Track\b[^>]*>[\s\S]*?<\/gx:Track>|<LineString\b[^>]*>[\s\S]*?<\/LineString>|<Point\b[^>]*>[\s\S]*?<\/Point>/g;
const RE_GEOM_KML = /<gx:Track\b[^>]*>[\s\S]*?<\/gx:Track>|<LineString\b[^>]*>[\s\S]*?<\/LineString>|<Point\b[^>]*>[\s\S]*?<\/Point>/g;

function geomKml(bloco, tempoPadrao, pontos) {
  let ignorados = 0;
  if (bloco.startsWith('<gx:Track')) {
    const whens = [...bloco.matchAll(/<when>\s*([^<]*?)\s*<\/when>/g)].map((m) => tempoIso(m[1]));
    const coords = [...bloco.matchAll(/<gx:coord>\s*([^<]*?)\s*<\/gx:coord>/g)]
      .map((m) => m[1].split(/\s+/).map((x) => (x === '' ? NaN : Number(x))));
    coords.forEach((c, i) => {
      ignorados += novoPonto(c[0], c[1], c[2], whens[i] ?? null, pontos);
    });
    return ignorados;
  }
  const c = bloco.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (!c) return 0;
  const t = bloco.startsWith('<Point') ? tempoPadrao : null;
  for (const tupla of c[1].trim().split(/\s+/)) {
    if (!tupla) continue;
    const v = tupla.split(',').map((x) => (x.trim() === '' ? NaN : Number(x)));
    ignorados += novoPonto(v[0], v[1], v[2], t, pontos);
  }
  return ignorados;
}

function lerKml(xml) {
  const pontos = [];
  let ignorados = 0;
  for (const m of xml.matchAll(RE_BLOCO_KML)) {
    const bloco = m[0];
    if (bloco.startsWith('<Placemark')) {
      const ts = bloco.match(/<TimeStamp\b[^>]*>\s*<when>\s*([^<]*?)\s*<\/when>/);
      const tempo = ts ? tempoIso(ts[1]) : null;
      for (const sub of bloco.matchAll(RE_GEOM_KML)) ignorados += geomKml(sub[0], tempo, pontos);
    } else {
      ignorados += geomKml(bloco, null, pontos);
    }
  }
  const nomeM = xml.match(/<Document\b[^>]*>\s*<name>([^<]*)<\/name>/) || xml.match(/<name>([^<]*)<\/name>/);
  return { pontos, ignorados, nome: decodificarEntidades(nomeM ? nomeM[1] : '') };
}

function atributo(attrs, nome) {
  const r = attrs.match(new RegExp(`\\b${nome}\\s*=\\s*["']([^"']*)["']`));
  return r && r[1].trim() !== '' ? Number(r[1]) : NaN;
}

function lerGpx(xml) {
  const pontos = [];
  let ignorados = 0;
  const tag = ['trkpt', 'rtept'].find((t) => new RegExp(`<${t}\\b`).test(xml));
  if (tag) {
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g');
    for (const m of xml.matchAll(re)) {
      const lat = atributo(m[1], 'lat');
      const lon = atributo(m[1], 'lon');
      const corpo = m[2] || '';
      const ele = corpo.match(/<ele>\s*([^<]*?)\s*<\/ele>/);
      const tm = corpo.match(/<time>\s*([^<]*?)\s*<\/time>/);
      const eleN = ele && ele[1].trim() !== '' ? Number(ele[1]) : NaN;
      ignorados += novoPonto(lon, lat, eleN, tm ? tempoIso(tm[1]) : null, pontos);
    }
  }
  const nomeM = xml.match(/<trk>\s*<name>([^<]*)<\/name>/)
    || xml.match(/<metadata>\s*<name>([^<]*)<\/name>/)
    || xml.match(/<name>([^<]*)<\/name>/);
  return { pontos, ignorados, nome: decodificarEntidades(nomeM ? nomeM[1] : '') };
}

function semRepetidosSeguidos(pontos) {
  const out = [];
  for (const p of pontos) {
    const a = out[out.length - 1];
    if (a && a.lat === p.lat && a.lon === p.lon && a.ele === p.ele && a.t === p.t) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {string|ArrayBuffer} entrada conteúdo (KML/GPX) ou bytes (KMZ)
 * @param {string} nomeArquivo nome com extensão (.kml .kmz .gpx)
 * @returns {Promise<{pontos: object[], temTempo: boolean, nome: string, avisos: string[]}>}
 */
export async function lerTrajeto(entrada, nomeArquivo = '') {
  const avisos = [];
  const ext = extensao(nomeArquivo);
  const base = String(nomeArquivo).replace(/\.[^.]*$/, '') || 'trajeto';
  try {
    let r;
    if (ext === 'kmz') {
      if (!globalThis.JSZip) throw new Error('biblioteca de KMZ (JSZip) não carregada');
      const zip = await globalThis.JSZip.loadAsync(entrada);
      const kmls = Object.keys(zip.files).filter((n) => /\.kml$/i.test(n) && !zip.files[n].dir);
      if (!kmls.length) throw new Error('o KMZ não tem arquivo .kml dentro');
      const alvo = kmls.find((n) => /(^|\/)doc\.kml$/i.test(n)) || kmls[0];
      if (kmls.length > 1) avisos.push(`O KMZ tem ${kmls.length} arquivos KML. Usei ${alvo}.`);
      r = lerKml(await zip.file(alvo).async('string'));
    } else if (ext === 'kml') {
      r = lerKml(decodificar(entrada));
    } else if (ext === 'gpx') {
      r = lerGpx(decodificar(entrada));
    } else {
      return {
        pontos: [], temTempo: false, nome: base,
        avisos: [`Formato não suportado (.${ext || '?'}). Use KML, KMZ ou GPX.`],
      };
    }

    const pontos = semRepetidosSeguidos(r.pontos);
    if (r.ignorados) avisos.push(`${r.ignorados} ponto(s) com coordenada inválida foram ignorados.`);
    if (!pontos.length) avisos.push('Nenhum ponto encontrado no arquivo do trajeto.');
    const comTempo = pontos.filter((p) => p.t !== null).length;
    if (comTempo > 0 && comTempo < pontos.length) avisos.push('Só parte dos pontos tem horário.');
    return {
      pontos,
      temTempo: pontos.length > 0 && comTempo === pontos.length,
      nome: r.nome || base,
      avisos,
    };
  } catch (e) {
    return {
      pontos: [], temTempo: false, nome: base,
      avisos: [`Não consegui ler o trajeto: ${e.message}`],
    };
  }
}
