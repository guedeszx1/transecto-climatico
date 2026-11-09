// Mapa Leaflet: linha colorida por segmento. Usa o global L (vendor/leaflet).

import { estatisticas } from './cruzar.js';

export const VARIAVEIS = {
  temp: { rotulo: 'Temperatura (°C)', casas: 1, cores: ['#313695', '#74add1', '#fee090', '#f46d43', '#a50026'] },
  umid: { rotulo: 'Umidade (%)', casas: 1, cores: ['#fff7bc', '#41b6c4', '#253494'] },
  orvalho: { rotulo: 'Ponto de orvalho (°C)', casas: 1, cores: ['#edf8b1', '#7fcdbb', '#1d91c0', '#0c2c84'] },
  alt: { rotulo: 'Altitude (m)', casas: 0, cores: ['#1a9850', '#fee08b', '#d73027'] },
};

const CINZA = '#7c8590';

// Cor de um token do CSS (o tema vive no CSS; o JS só lê).
export function corVar(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim() || '#000000';
}
// quantos segmentos entram em cada bloco antes de ceder a vez ao navegador
const BLOCO_SEGMENTOS = 4000;

function hexParaRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbParaHex([r, g, b]) {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Faixa [min, max] da variável. Se min == max, abre um pouco para não quebrar a escala.
export function faixa(pontos, variavel) {
  const e = estatisticas(pontos, variavel);
  if (e.n === 0) return { min: 0, max: 1 };
  if (e.min === e.max) return { min: e.min - 0.5, max: e.max + 0.5 };
  return { min: e.min, max: e.max };
}

// Cor de um valor na escala da variável, com faixa dada.
export function corPara(variavel, valor, min, max) {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return CINZA;
  const cores = VARIAVEIS[variavel].cores.map(hexParaRgb);
  const t = Math.min(1, Math.max(0, (valor - min) / (max - min)));
  const pos = t * (cores.length - 1);
  const i = Math.min(Math.floor(pos), cores.length - 2);
  const f = pos - i;
  const a = cores[i];
  const b = cores[i + 1];
  return rgbParaHex(a.map((c, k) => c + (b[k] - c) * f));
}

// Função de cor para uma variável e uma faixa fixa: corDe(v, min, max)(valor) -> '#rrggbb'.
export function corDe(variavel, min, max) {
  return (valor) => corPara(variavel, valor, min, max);
}

// CSS do gradiente da legenda.
export function gradienteCss(variavel) {
  return `linear-gradient(to right, ${VARIAVEIS[variavel].cores.join(', ')})`;
}

export function criarMapa(elemento) {
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a>',
  });
  const satelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Powered by Esri | Fontes: Esri, Maxar, Earthstar Geographics' }
  );
  const mapa = L.map(elemento, {
    center: [-15, -50],
    zoom: 4,
    layers: [osm],
    preferCanvas: true,
  });
  L.control.layers({ 'Mapa (OSM)': osm, 'Satélite (Esri)': satelite }, null, { position: 'topright' }).addTo(mapa);
  const renderer = L.canvas({ padding: 0.5 });
  const grupo = L.layerGroup().addTo(mapa);
  const destaque = L.layerGroup().addTo(mapa);
  // só a base OpenStreetMap recebe o filtro do tema escuro (a de satélite não)
  const marcarOsm = () => {
    const c = osm.getContainer();
    if (c) c.classList.add('base-osm');
  };
  marcarOsm();
  osm.on('add', marcarOsm);
  return { mapa, renderer, grupo, destaque, cores: [], contorno: null };
}

function formatarTempo(t, fusoHoras) {
  // mostra o horário no relógio do termohigrômetro
  const d = new Date(t + fusoHoras * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function formatarValor(v, casas) {
  return v === null || v === undefined ? '—' : v.toFixed(casas);
}

// Balão do ponto: monta elementos e usa textContent. Nada aqui vira HTML, mesmo que um
// valor do arquivo tenha caracteres estranhos.
function tooltipDoPonto(a, fusoHoras, rotulo) {
  const caixa = document.createElement('div');
  const linha = (negrito, texto) => {
    const div = document.createElement('div');
    if (negrito) {
      const b = document.createElement('b');
      b.textContent = `${negrito} `;
      div.appendChild(b);
    }
    div.appendChild(document.createTextNode(texto));
    caixa.appendChild(div);
  };
  if (a.t !== null && a.t !== undefined) linha('Horário:', formatarTempo(a.t, fusoHoras));
  linha('Distância:', a.dist >= 1000 ? (a.dist / 1000).toFixed(2) + ' km' : a.dist.toFixed(0) + ' m');
  linha('Temperatura:', `${formatarValor(a.temp, 1)} °C`);
  linha('Umidade:', `${formatarValor(a.umid, 1)} %`);
  linha('Orvalho:', `${formatarValor(a.orvalho, 1)} °C`);
  linha('Altitude:', `${formatarValor(a.alt, 0)} m`);
  const pequeno = document.createElement('small');
  pequeno.textContent = rotulo;
  caixa.appendChild(pequeno);
  return caixa;
}

const proximoQuadro = () => new Promise((resolver) => requestAnimationFrame(() => resolver()));

// Desenha a linha: cor pela variável, em blocos (cede a vez ao navegador entre os blocos).
// Segmentos que caem no mesmo pixel da tela no zoom atual viram um só traço: o visual é o mesmo,
// e os dados (mapa.cores, tabela, azulejos, figura) não mudam.
// Retorna { min, max }, ou null se um desenho mais novo cancelou este (opção vigia).
// opções:
//   aoPassar(i): ponteiro passa (ou toca) no segmento i, entre pontos[i] e pontos[i+1]
//   aoSair(): ponteiro deixa o segmento
//   progresso(fração 0..1)
//   vigia(): devolve false quando este desenho deve parar
export async function desenharTrajeto(mapa, pontos, variavel, fusoHoras, opcoes = {}) {
  const { enquadrar = false, aoPassar = null, aoSair = null, progresso = null, vigia = () => true } = opcoes;
  const { renderer, grupo } = mapa;
  grupo.clearLayers();
  mapa.destaque.clearLayers();
  mapa.cores = [];
  if (pontos.length < 2) return faixa(pontos, variavel);

  const { min, max } = faixa(pontos, variavel);
  const rotulo = VARIAVEIS[variavel].rotulo;
  const n = pontos.length - 1;

  // contorno escuro por baixo, para ler bem no satélite
  const coords = pontos.map((p) => [p.lat, p.lon]);
  mapa.contorno = L.polyline(coords, { color: corVar('--mapa-contorno'), weight: 8, opacity: 0.5, renderer, interactive: false });
  mapa.contorno.addTo(grupo);

  let ultimoX = NaN;
  let ultimoY = NaN;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % BLOCO_SEGMENTOS === 0) {
      if (progresso) progresso(i / n);
      await proximoQuadro();
      if (!vigia()) return null;
    }
    const a = pontos[i];
    const b = pontos[i + 1];
    const va = a[variavel];
    const vb = b[variavel];
    const valor = va !== null && vb !== null ? (va + vb) / 2 : null;
    const cor = corPara(variavel, valor, min, max);
    mapa.cores[i] = cor;

    const pb = mapa.mapa.latLngToContainerPoint([b.lat, b.lon]);
    const px = Math.round(pb.x);
    const py = Math.round(pb.y);
    if (px === ultimoX && py === ultimoY) continue; // mesmo pixel do traço anterior
    ultimoX = px;
    ultimoY = py;

    const seg = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
      color: cor,
      weight: 5,
      opacity: 1,
      renderer,
    });
    seg.bindTooltip(() => tooltipDoPonto(a, fusoHoras, rotulo), { sticky: true });
    if (aoPassar) {
      seg.on('mouseover', () => aoPassar(i));
      seg.on('click', () => aoPassar(i));
    }
    if (aoSair) seg.on('mouseout', () => aoSair());
    seg.addTo(grupo);
  }

  if (progresso) progresso(1);
  if (enquadrar) mapa.mapa.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });
  return { min, max };
}

// Troca de tema: recolore só o contorno da linha. Não refaz cruzamento, zoom nem seleção.
export function aplicarTemaMapa(mapa) {
  if (mapa && mapa.contorno) mapa.contorno.setStyle({ color: corVar('--mapa-contorno') });
}

// Anel de foco sobre a linha entre os pontos iIni e iFim (inclusive). Limpa com limparDestaque.
export function destacarTrecho(mapa, pontos, iIni, iFim) {
  mapa.destaque.clearLayers();
  const coords = pontos.slice(iIni, iFim + 1).map((p) => [p.lat, p.lon]);
  if (coords.length < 2) return;
  // anel cobalto, depois as cores do trecho por cima (o canvas desenha na ordem de inclusão)
  L.polyline(coords, { color: corVar('--mapa-destaque'), weight: 11, opacity: 1, renderer: mapa.renderer, interactive: false }).addTo(mapa.destaque);
  for (let i = iIni; i <= iFim && i < pontos.length - 1; i++) {
    const a = pontos[i];
    const b = pontos[i + 1];
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: mapa.cores[i] || CINZA, weight: 5, opacity: 1, renderer: mapa.renderer, interactive: false }).addTo(mapa.destaque);
  }
}

export function limparDestaque(mapa) {
  mapa.destaque.clearLayers();
}

// Enquadra o mapa no trecho entre iIni e iFim.
export function irParaTrecho(mapa, pontos, iIni, iFim) {
  const coords = pontos.slice(iIni, iFim + 1).map((p) => [p.lat, p.lon]);
  if (coords.length) mapa.mapa.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 17 });
}
