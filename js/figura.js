// Figura de relatório: PNG 2400x1600 com fundo de mapa, linha colorida por variável,
// título, resumo, legenda, barra de escala, norte e atribuição.
// Só navegador (canvas, Image, FontFace). Sem dependências.

const LARG = 2400;
const ALT = 1600;
const CABECALHO = 240;          // faixa do título e do resumo
const RODAPE_Y = 1470;          // faixa da legenda
const MAPA_ALT = RODAPE_Y - CABECALHO;
const MARGEM = 60;
const TILE = 256;
const ZOOM_MAX = 18;
const TIMEOUT_TILE_MS = 15000;
const COR_FUNDO_LISO = '#dfe3e8';
const COR_SEM_DADO = '#7c8590';
const FAMILIA = 'Archivo, "Helvetica Neue", Arial, sans-serif';
const FONTE_URL = new URL('../vendor/fontes/archivo-latin-wdth-normal.woff2', import.meta.url).href;

const FUNDOS = {
  osm: {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    credito: '© OpenStreetMap contributors',
  },
  satelite: {
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    credito: 'Imagens © Esri, Maxar, Earthstar Geographics',
  },
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Fonte
// ---------------------------------------------------------------------------

let fonteCarregada = null;
function carregarFonte() {
  if (!fonteCarregada) {
    fonteCarregada = (async () => {
      try {
        const face = new FontFace('Archivo', `url(${FONTE_URL})`, { weight: '100 900' });
        await face.load();
        document.fonts.add(face);
      } catch {
        // sem a fonte, usa a do sistema (a figura continua saindo)
      }
    })();
  }
  return fonteCarregada;
}

// ---------------------------------------------------------------------------
// Projeção Web Mercator (mesma dos tiles OSM/Esri)
// ---------------------------------------------------------------------------

const latLimpa = (lat) => Math.max(-85, Math.min(85, lat));
const mundoX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
function mundoY(lat, z) {
  const r = (latLimpa(lat) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
}

// Zoom fracionário em que o trajeto ocupa 84 % da área do mapa (margem de 8 % de cada lado)
// na dimensão que limita primeiro. Os pixels escalam com 2^z, então isto é logaritmo direto.
const FOLGA = 0.84; // fração da área que o trajeto pode ocupar
export function escolherZoom(coords) {
  const lats = coords.map((c) => c.lat);
  const lons = coords.map((c) => c.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  // extensão em pixels de mundo no zoom 0
  const w0 = mundoX(maxLon, 0) - mundoX(minLon, 0);
  const h0 = mundoY(minLat, 0) - mundoY(maxLat, 0);
  const zf = Math.log2(Math.min(LARG * FOLGA / w0, MAPA_ALT * FOLGA / h0));
  return Math.min(ZOOM_MAX, Math.max(1, Number.isFinite(zf) ? zf : ZOOM_MAX));
}

// Data(s) da medição, dd/mm/aaaa, no fuso indicado (padrão: Brasília, -3).
const pad2 = (n) => String(n).padStart(2, '0');
export function datasDaMedicao(pontos, fusoHoras = -3) {
  const ts = (pontos || []).map((p) => p.t).filter(isNum);
  if (!ts.length) return null;
  const fmt = (ms) => {
    const d = new Date(ms + fusoHoras * 3600000);
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  };
  const ini = fmt(Math.min(...ts));
  const fim = fmt(Math.max(...ts));
  return ini === fim ? ini : `${ini} a ${fim}`;
}

// ---------------------------------------------------------------------------
// Texto: quebra por palavra e encolhe até caber (nada é cortado)
// ---------------------------------------------------------------------------

function quebrarLinhas(ctx, texto, largura) {
  const linhas = [];
  for (const paragrafo of String(texto).split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const teste = atual ? `${atual} ${palavra}` : palavra;
      if (atual && ctx.measureText(teste).width > largura) {
        linhas.push(atual);
        atual = palavra;
      } else {
        atual = teste;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

function ajustarTexto(ctx, texto, { largura, altura, tamanho, minimo = 16, peso = '700', lh = 1.2 }) {
  for (let t = tamanho; t >= minimo; t -= 2) {
    ctx.font = `${peso} ${t}px ${FAMILIA}`;
    const linhas = quebrarLinhas(ctx, texto, largura);
    if (linhas.length * t * lh <= altura) return { linhas, tamanho: t, lh };
  }
  ctx.font = `${peso} ${minimo}px ${FAMILIA}`;
  console.warn('figura: texto não coube na faixa; usei o tamanho mínimo.');
  return { linhas: quebrarLinhas(ctx, texto, largura), tamanho: minimo, lh };
}

function desenharBloco(ctx, bloco, x, y, peso, cor) {
  ctx.font = `${peso} ${bloco.tamanho}px ${FAMILIA}`;
  ctx.fillStyle = cor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  bloco.linhas.forEach((linha, i) => {
    ctx.fillText(linha, x, y + i * bloco.tamanho * bloco.lh);
  });
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function carregarImagem(url) {
  return new Promise((ok) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.src = ''; ok(null); }, TIMEOUT_TILE_MS);
    img.onload = () => { clearTimeout(timer); ok(img); };
    img.onerror = () => { clearTimeout(timer); ok(null); };
    img.src = url;
  });
}

// Tiles que cobrem a área visível. Devolve [{tx, ty, img|null}].
// `larg` e `alt` são a área visível em pixels de mundo (já divididos pela escala).
async function carregarTiles(fundo, z, ox, oy, larg, alt) {
  const n = 2 ** z;
  const txIni = Math.floor(ox / TILE);
  const txFim = Math.floor((ox + larg) / TILE);
  const tyIni = Math.max(0, Math.floor(oy / TILE));
  const tyFim = Math.min(n - 1, Math.floor((oy + alt) / TILE));
  const pedidos = [];
  for (let ty = tyIni; ty <= tyFim; ty++) {
    for (let tx = txIni; tx <= txFim; tx++) {
      const xw = ((tx % n) + n) % n;
      pedidos.push(carregarImagem(fundo.url(z, xw, ty)).then((img) => ({ tx, ty, img })));
    }
  }
  return Promise.all(pedidos);
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

// Tiles no zoom de tiles (zt), desenhados com escala s (<= 1) e centrados em (cx, cy).
function desenharMapa(ctx, tiles, semFundo, cx, cy, s) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, CABECALHO, LARG, MAPA_ALT);
  ctx.clip();
  ctx.fillStyle = COR_FUNDO_LISO;
  ctx.fillRect(0, CABECALHO, LARG, MAPA_ALT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const t of tiles) {
    if (!t.img) continue;
    const x = (t.tx * TILE - cx) * s + LARG / 2;
    const y = (t.ty * TILE - cy) * s + MAPA_ALT / 2 + CABECALHO;
    ctx.drawImage(t.img, x, y, TILE * s, TILE * s);
  }
  ctx.restore();
  if (semFundo) {
    ctx.font = `600 44px ${FAMILIA}`;
    ctx.fillStyle = '#5b6370';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('mapa de fundo indisponível', LARG / 2, CABECALHO + MAPA_ALT / 2);
  }
}

function desenharLinha(ctx, pts, corDe) {
  if (pts.length < 2) return;
  const cor = (p) => (p.v === null ? COR_SEM_DADO : corDe(p.v));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // contorno branco do trajeto inteiro
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 18;
  ctx.stroke();
  // cada trecho com a cor do valor do ponto final
  for (let i = 1; i < pts.length; i++) {
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].sx, pts[i - 1].sy);
    ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.strokeStyle = cor(pts[i]);
    ctx.lineWidth = 10;
    ctx.stroke();
  }
  desenharMarcador(ctx, pts[0], 'Início', '#1a7f37');
  desenharMarcador(ctx, pts[pts.length - 1], 'Fim', '#b42318');
}

// Ponto com cor própria e rótulo em caixa colorida ao lado.
function desenharMarcador(ctx, p, rotulo, cor) {
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 11, 0, Math.PI * 2);
  ctx.fillStyle = cor;
  ctx.fill();
  ctx.font = `700 26px ${FAMILIA}`;
  const largura = ctx.measureText(rotulo).width;
  const x = p.sx + 22;
  const y = p.sy - 58;
  ctx.fillStyle = cor;
  ctx.fillRect(x, y, largura + 24, 40);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(rotulo, x + 12, y + 21);
}

function desenharEscala(ctx, z, latCentro) {
  const mPorPx = (156543.03392 * Math.cos((latCentro * Math.PI) / 180)) / 2 ** z;
  const alvos = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  let m = 50;
  for (const a of alvos) if (a / mPorPx <= 360) m = a;
  const len = m / mPorPx;
  const x = MARGEM;
  const y = RODAPE_Y - 70;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 16, y - 50, len + 32, 86);
  ctx.font = `700 26px ${FAMILIA}`;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(m < 1000 ? `${m} m` : `${m / 1000} km`, x, y - 16);
  ctx.fillRect(x, y, len / 2, 14);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, len, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + len / 2, y, len / 2, 14);
}

function desenharNorte(ctx) {
  const cx = LARG - 120;
  const cy = CABECALHO + 110;
  ctx.beginPath();
  ctx.arc(cx, cy, 46, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy - 36);
  ctx.lineTo(cx - 16, cy + 22);
  ctx.lineTo(cx + 16, cy + 22);
  ctx.closePath();
  ctx.fillStyle = '#111111';
  ctx.fill();
  ctx.font = `800 28px ${FAMILIA}`;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', cx, cy + 56);
}

function desenharLegenda(ctx, { rotulo, unidade, corDe, min, max }) {
  const x0 = MARGEM;
  const x1 = 1000;
  const yBarra = RODAPE_Y + 56;
  const titulo = unidade ? `${rotulo} (${unidade})` : rotulo;
  const bloco = ajustarTexto(ctx, titulo, { largura: LARG - 2 * MARGEM, altura: 40, tamanho: 30, minimo: 20, peso: '700', lh: 1.1 });
  desenharBloco(ctx, bloco, MARGEM, RODAPE_Y + 12, '700', '#111111');

  const N = 60;
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= N; i++) {
    const v = min + ((max - min) * i) / N;
    grad.addColorStop(i / N, corDe(v));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x0, yBarra, x1 - x0, 22);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, yBarra, x1 - x0, 22);

  ctx.font = `500 24px ${FAMILIA}`;
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  // sempre uma casa decimal, para a legenda ficar uniforme (19,0 e 18,4, não 19 e 18,4)
  const fmt = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    const txt = fmt(v);
    ctx.textAlign = k === 0 ? 'left' : k === 4 ? 'right' : 'center';
    const xt = x0 + ((x1 - x0) * k) / 4;
    ctx.fillText(txt, xt, yBarra + 34);
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {Array<{lat:number, lon:number}>} o.pontos pontos já cruzados (com a variável)
 * @param {string} o.variavel nome do campo no ponto, ex.: 'temp'
 * @param {string} o.rotulo ex.: 'Temperatura'
 * @param {string} o.unidade ex.: '°C'
 * @param {(valor:number) => string} o.corDe cor CSS para um valor
 * @param {number} o.min valor da extremidade fria da legenda
 * @param {number} o.max valor da extremidade quente da legenda
 * @param {string} o.titulo
 * @param {string} o.resumo
 * @param {'osm'|'satelite'} [o.base='osm']
 * @returns {Promise<Blob>} PNG 2400x1600
 */
export async function gerarFigura({
  pontos, variavel, rotulo, unidade, corDe, min, max, titulo, resumo, base = 'osm', fusoHoras = -3,
}) {
  const fundo = FUNDOS[base] || FUNDOS.osm;
  const coords = (pontos || []).filter((p) => isNum(p.lat) && isNum(p.lon));
  if (!coords.length) throw new Error('gerarFigura: nenhum ponto com coordenadas');

  await carregarFonte();

  // zf: zoom fracionário da figura. Os tiles vêm do zoom inteiro seguinte (zt, mais nítido)
  // e são desenhados com escala s = 2^(zf - zt) <= 1, então a figura fica no zoom zf.
  const zf = escolherZoom(coords);
  const zt = Math.min(ZOOM_MAX, Math.ceil(zf));
  const s = 2 ** (zf - zt);
  const minLat = Math.min(...coords.map((c) => c.lat));
  const maxLat = Math.max(...coords.map((c) => c.lat));
  const minLon = Math.min(...coords.map((c) => c.lon));
  const maxLon = Math.max(...coords.map((c) => c.lon));
  const cx = (mundoX(minLon, zt) + mundoX(maxLon, zt)) / 2;
  const cy = (mundoY(maxLat, zt) + mundoY(minLat, zt)) / 2;
  const ox = cx - LARG / (2 * s);
  const oy = cy - MAPA_ALT / (2 * s);

  const tiles = await carregarTiles(fundo, zt, ox, oy, LARG / s, MAPA_ALT / s);
  const semFundo = tiles.every((t) => !t.img);

  const canvas = document.createElement('canvas');
  canvas.width = LARG;
  canvas.height = ALT;
  const ctx = canvas.getContext('2d');

  desenharMapa(ctx, tiles, semFundo, cx, cy, s);

  const pts = coords.map((p) => ({
    sx: (mundoX(p.lon, zt) - cx) * s + LARG / 2,
    sy: (mundoY(p.lat, zt) - cy) * s + MAPA_ALT / 2 + CABECALHO,
    v: isNum(p[variavel]) ? p[variavel] : null,
  }));
  desenharLinha(ctx, pts, corDe);
  desenharEscala(ctx, zf, (minLat + maxLat) / 2);
  desenharNorte(ctx);

  // cabeçalho: título e resumo
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(0, 0, LARG, CABECALHO);
  if (titulo) {
    const bt = ajustarTexto(ctx, titulo, { largura: LARG - 2 * MARGEM, altura: 100, tamanho: 64, minimo: 30, peso: '800', lh: 1.15 });
    desenharBloco(ctx, bt, MARGEM, 28, '800', '#111111');
  }
  const topoResumo = titulo ? 136 : 40;
  const data = datasDaMedicao(pontos, fusoHoras);
  const LARG_DATA = 560; // espaço reservado à direita do resumo para a data
  if (resumo) {
    const alturaResumo = CABECALHO - topoResumo - 12;
    const larguraResumo = LARG - 2 * MARGEM - (data ? LARG_DATA : 0);
    const br = ajustarTexto(ctx, resumo, { largura: larguraResumo, altura: alturaResumo, tamanho: 30, minimo: 18, peso: '400', lh: 1.25 });
    desenharBloco(ctx, br, MARGEM, topoResumo, '400', '#333333');
  }
  if (data) {
    ctx.font = `700 30px ${FAMILIA}`;
    ctx.fillStyle = '#111111';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`Data: ${data}`, LARG - MARGEM, topoResumo);
  }

  // rodapé: legenda e atribuição
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, RODAPE_Y, LARG, ALT - RODAPE_Y);
  desenharLegenda(ctx, { rotulo, unidade, corDe, min, max });
  ctx.font = `400 24px ${FAMILIA}`;
  ctx.fillStyle = '#444444';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  // crédito da fonte dos dados: sempre, mesmo sem mapa de fundo; acima da atribuição do mapa
  ctx.font = `600 26px ${FAMILIA}`;
  ctx.fillStyle = '#222222';
  ctx.fillText('Fonte: Transecto Climático, LCGEA/UnB', LARG - MARGEM, ALT - 64);
  ctx.font = `400 24px ${FAMILIA}`;
  ctx.fillStyle = '#444444';
  ctx.fillText(semFundo ? `Fundo indisponível · ${fundo.credito}` : fundo.credito, LARG - MARGEM, ALT - 30);

  return new Promise((ok, falha) => {
    try {
      canvas.toBlob((b) => (b ? ok(b) : falha(new Error('não consegui gerar o PNG'))), 'image/png');
    } catch (e) {
      falha(e);
    }
  });
}
