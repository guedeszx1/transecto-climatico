// Cruzamento entre leituras do termohigrômetro e pontos do trajeto.
// Sem DOM: roda no navegador e no Node.

const A = 17.625;
const B = 243.04;
const RAIO_TERRA = 6371000; // metros
const MINUTO = 60000;
const HORA = 3600000;
const TOLERANCIA_PADRAO_MIN = 5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Ponto de orvalho pela fórmula de Magnus. Sem arredondar.
export function pontoOrvalho(temp, umid) {
  if (!isNum(temp) || !isNum(umid) || umid <= 0) return null;
  const gamma = Math.log(umid / 100) + (A * temp) / (B + temp);
  return (B * gamma) / (A - gamma);
}

// Distância em metros entre dois pontos (haversine).
export function haversine(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Primeiro índice com arr[i] >= x (arr ordenado).
function menorIndiceNaoMenor(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (arr[meio] < x) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

// Quantos instantes de `tsPontos` (deslocados por `deslocamento`) têm leitura a até `tol`.
function contarCasados(tsLeituras, tsPontos, deslocamento, tol) {
  let n = 0;
  for (const t of tsPontos) {
    const x = t + deslocamento;
    const j = menorIndiceNaoMenor(tsLeituras, x);
    let melhor = Infinity;
    if (j < tsLeituras.length) melhor = Math.min(melhor, tsLeituras[j] - x);
    if (j > 0) melhor = Math.min(melhor, x - tsLeituras[j - 1]);
    if (melhor <= tol) n++;
  }
  return n;
}

// Fuso (hora inteira, -14 a 14) com maior sobreposição de tempo.
// Empate: prefere o mais perto de -3 (Brasília). Sem tempo nos pontos: null.
export function detectarFuso(leituras, pontos) {
  const tsP = (pontos || []).map((p) => p.t).filter(isNum).sort((a, b) => a - b);
  const tsL = (leituras || []).map((l) => l.t).filter(isNum).sort((a, b) => a - b);
  if (!tsP.length || !tsL.length) return null;

  const minL = tsL[0];
  const maxL = tsL[tsL.length - 1];
  const minP = tsP[0];
  const maxP = tsP[tsP.length - 1];

  const ordem = [];
  for (let h = -14; h <= 14; h++) ordem.push(h);
  ordem.sort((a, b) => Math.abs(a + 3) - Math.abs(b + 3) || a - b);

  let melhorFuso = -3;
  let melhorSobra = -1;
  let melhorCont = -1;
  for (const h of ordem) {
    const s = h * HORA;
    const ini = Math.max(minL, minP + s);
    const fim = Math.min(maxL, maxP + s);
    const sobra = Math.max(0, fim - ini);
    if (sobra < melhorSobra) continue;
    const cont = sobra > 0 ? contarCasados(tsL, tsP, s, TOLERANCIA_PADRAO_MIN * MINUTO) : 0;
    if (sobra > melhorSobra || (sobra === melhorSobra && cont > melhorCont)) {
      melhorFuso = h;
      melhorSobra = sobra;
      melhorCont = cont;
    }
  }
  return melhorFuso;
}

// Interpola um campo entre a leitura anterior (a) e a posterior (b).
// Se faltar um dos dois valores, usa o da leitura mais próxima.
function valorEntre(a, b, f, campo, maisProxima) {
  const va = a ? a[campo] : null;
  const vb = b ? b[campo] : null;
  if (isNum(va) && isNum(vb)) return va + (vb - va) * f;
  return isNum(maisProxima[campo]) ? maisProxima[campo] : null;
}

// Opções do modo distância (trajeto sem horário):
//   inicioMs, fimMs: só as leituras entre os dois instantes valem; sem eles, o resultado é o de sempre.
//   inverter: percorre a linha do fim para o começo.
export function cruzar(leituras, pontos, { fusoHoras = 0, toleranciaMin = TOLERANCIA_PADRAO_MIN, inicioMs, fimMs, inverter = false } = {}) {
  const avisos = [];
  const fuso = Number(fusoHoras) || 0;
  const tol = toleranciaMin * MINUTO;
  const pts = pontos || [];
  const todasLeituras = leituras || [];

  // distância acumulada (m)
  const dist = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) dist[i] = 0;
    else
      dist[i] =
        dist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }

  const temTempo = pts.some((p) => isNum(p.t));
  const modo = temTempo ? 'tempo' : 'distancia';
  if (modo === 'distancia' && (inicioMs !== undefined || fimMs !== undefined)) {
    return cruzarPorIntervalo(pts, dist, todasLeituras, { inicioMs, fimMs, inverter });
  }
  const saida = [];
  let semDado = 0;

  if (modo === 'tempo') {
    const lt = todasLeituras.filter((l) => isNum(l.t)).sort((a, b) => a.t - b.t);
    if (!lt.length) avisos.push('Nenhuma leitura com horário: nada foi cruzado.');
    const deslocamento = fuso * HORA;
    const tsL = lt.map((l) => l.t);
    let casados = 0;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const base = {
        lat: p.lat,
        lon: p.lon,
        t: isNum(p.t) ? p.t : null,
        dist: dist[i],
        temp: null,
        umid: null,
        orvalho: null,
        alt: isNum(p.ele) ? p.ele : null,
      };
      if (!isNum(p.t) || !lt.length) {
        semDado++;
        saida.push(base);
        continue;
      }
      const x = p.t + deslocamento;
      const j = menorIndiceNaoMenor(tsL, x);
      const ia = j - 1 >= 0 ? lt[j - 1] : null;
      const ib = j < lt.length ? lt[j] : null;
      let maisProx = null;
      let difMin = Infinity;
      if (ia && x - ia.t < difMin) {
        difMin = x - ia.t;
        maisProx = ia;
      }
      if (ib && ib.t - x < difMin) {
        difMin = ib.t - x;
        maisProx = ib;
      }
      if (!maisProx || difMin > tol) {
        semDado++;
        saida.push(base);
        continue;
      }
      casados++;
      const f = ia && ib ? (x - ia.t) / (ib.t - ia.t) : 0;
      base.temp = valorEntre(ia, ib, f, 'temp', maisProx);
      base.umid = valorEntre(ia, ib, f, 'umid', maisProx);
      const orv = valorEntre(ia, ib, f, 'orvalho', maisProx);
      base.orvalho = isNum(orv) ? orv : pontoOrvalho(base.temp, base.umid);
      if (base.alt === null) {
        const alt = valorEntre(ia, ib, f, 'alt', maisProx);
        base.alt = isNum(alt) ? alt : null;
      }
      saida.push(base);
    }

    if (lt.length && pts.length && casados === 0) {
      avisos.push(
        'Sem sobreposição de horário entre o termohigrômetro e o trajeto. Confira o fuso do aparelho.'
      );
    } else if (semDado > 0) {
      avisos.push(
        `${semDado} ponto(s) sem leitura a até ${toleranciaMin} min: ficaram sem dado (cinza no mapa).`
      );
    }
  } else {
    // trajeto sem horário: leituras distribuídas ao longo da linha
    const lt = todasLeituras.some((l) => isNum(l.t))
      ? todasLeituras.filter((l) => isNum(l.t)).sort((a, b) => a.t - b.t)
      : todasLeituras.slice();
    const N = lt.length;
    const total = pts.length ? dist[pts.length - 1] : 0;
    if (!N) avisos.push('Nenhuma leitura: nada foi cruzado.');
    avisos.push(
      AVISO_SEM_HORARIO
    );

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const base = {
        lat: p.lat,
        lon: p.lon,
        t: null,
        dist: dist[i],
        temp: null,
        umid: null,
        orvalho: null,
        alt: isNum(p.ele) ? p.ele : null,
      };
      if (N) {
        let frac = total > 0 ? dist[i] / total : 0;
        if (inverter) frac = 1 - frac;
        const pos = frac * (N - 1);
        const k = Math.min(Math.floor(pos), Math.max(N - 1, 0));
        const f = N > 1 ? pos - k : 0;
        const a = lt[k];
        const b = lt[Math.min(k + 1, N - 1)];
        const prox = f >= 0.5 ? b : a;
        base.temp = valorEntre(a, b, f, 'temp', prox);
        base.umid = valorEntre(a, b, f, 'umid', prox);
        const orv = valorEntre(a, b, f, 'orvalho', prox);
        base.orvalho = isNum(orv) ? orv : pontoOrvalho(base.temp, base.umid);
        if (base.alt === null) {
          const alt = valorEntre(a, b, f, 'alt', prox);
          base.alt = isNum(alt) ? alt : null;
        }
      } else {
        semDado++;
      }
      saida.push(base);
    }
  }

  return { pontos: saida, modo, semDado, avisos };
}

const AVISO_SEM_HORARIO = 'Trajeto sem horário: as leituras foram distribuídas pela distância. Veja "Trajeto sem horário" em Ajustes.';

// Modo distância com intervalo: a leitura no instante t cai na fração (t − início)/(fim − início)
// da distância total. Os valores de cada ponto saem por interpolação entre as leituras vizinhas
// nessa posição; antes da primeira ou depois da última usada, vale a mais próxima.
function cruzarPorIntervalo(pts, dist, todas, { inicioMs, fimMs, inverter }) {
  const lt = todas.filter((l) => isNum(l.t)).sort((a, b) => a.t - b.t);
  const ini = isNum(inicioMs) ? inicioMs : (lt.length ? lt[0].t : 0);
  const fim = isNum(fimMs) ? fimMs : (lt.length ? lt[lt.length - 1].t : 0);
  const usadas = lt.filter((l) => l.t >= ini && l.t <= fim);
  const N = usadas.length;
  const tsL = usadas.map((l) => l.t);
  const dur = fim - ini;
  const total = pts.length ? dist[pts.length - 1] : 0;
  const avisos = [AVISO_SEM_HORARIO];
  const saida = [];
  let semDado = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const base = {
      lat: p.lat,
      lon: p.lon,
      t: null,
      dist: dist[i],
      temp: null,
      umid: null,
      orvalho: null,
      alt: isNum(p.ele) ? p.ele : null,
    };
    if (!N || !(dur > 0)) {
      semDado++;
      saida.push(base);
      continue;
    }
    let g = total > 0 ? dist[i] / total : 0;
    if (inverter) g = 1 - g;
    const tau = ini + g * dur;
    const j = menorIndiceNaoMenor(tsL, tau);
    const ia = j - 1 >= 0 ? usadas[j - 1] : null;
    const ib = j < N ? usadas[j] : null;
    const f = ia && ib && ib.t !== ia.t ? (tau - ia.t) / (ib.t - ia.t) : 0;
    const prox = ia && (!ib || f < 0.5) ? ia : ib;
    base.temp = valorEntre(ia, ib, f, 'temp', prox);
    base.umid = valorEntre(ia, ib, f, 'umid', prox);
    const orv = valorEntre(ia, ib, f, 'orvalho', prox);
    base.orvalho = isNum(orv) ? orv : pontoOrvalho(base.temp, base.umid);
    if (base.alt === null) {
      const alt = valorEntre(ia, ib, f, 'alt', prox);
      base.alt = isNum(alt) ? alt : null;
    }
    saida.push(base);
  }

  return {
    pontos: saida,
    modo: 'distancia',
    semDado,
    avisos,
    info: {
      inicioMs: ini,
      fimMs: fim,
      nUsadas: N,
      velocidadeMs: dur > 0 && total > 0 ? total / (dur / 1000) : null,
      metrosPorLeitura: N ? total / N : null,
    },
  };
}

// Tamanho de trecho (m) para o relatório: o menor da lista que dá no máximo 40 trechos.
// Se nem o de 1000 m couber (trajeto > 40 km), usa 1000 m.
const TAMANHOS_TRECHO = [50, 100, 200, 250, 500, 1000];
const MAX_TRECHOS = 40;

export function tamanhoTrecho(distTotalM) {
  const total = isNum(distTotalM) && distTotalM > 0 ? distTotalM : 0;
  for (const m of TAMANHOS_TRECHO) {
    if (Math.ceil(total / m) <= MAX_TRECHOS) return m;
  }
  return TAMANHOS_TRECHO[TAMANHOS_TRECHO.length - 1];
}

// Divide o trajeto em trechos de `metros` pela distância acumulada (p.dist; se faltar,
// calcula pelo haversine). Devolve um trecho por faixa, do início ao fim da linha:
// trecho sem ponto tem iIni/iFim null e médias null. Médias ignoram null.
export function trechos(pontos, metros) {
  if (!(metros > 0)) throw new Error('trechos: metros precisa ser maior que zero');
  const pts = pontos || [];
  const dist = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    if (isNum(pts[i].dist)) dist[i] = pts[i].dist;
    else if (i === 0) dist[i] = 0;
    else dist[i] = dist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  }
  const total = pts.length ? dist[pts.length - 1] : 0;
  const n = Math.max(1, Math.ceil(total / metros));
  const campos = ['temp', 'umid', 'orvalho', 'alt'];

  const saida = [];
  for (let k = 0; k < n; k++) {
    saida.push({
      indice: k,
      distIni: k * metros,
      distFim: Math.min((k + 1) * metros, total),
      iIni: null,
      iFim: null,
      medias: Object.fromEntries(campos.map((c) => [c, null])),
    });
  }

  const somas = saida.map(() => Object.fromEntries(campos.map((c) => [c, { soma: 0, n: 0 }])));
  for (let i = 0; i < pts.length; i++) {
    const k = Math.min(Math.floor(dist[i] / metros), n - 1);
    const tr = saida[k];
    if (tr.iIni === null) tr.iIni = i;
    tr.iFim = i;
    for (const c of campos) {
      const v = pts[i][c];
      if (!isNum(v)) continue;
      somas[k][c].soma += v;
      somas[k][c].n++;
    }
  }
  saida.forEach((tr, k) => {
    for (const c of campos) {
      const s = somas[k][c];
      tr.medias[c] = s.n ? s.soma / s.n : null;
    }
  });
  return saida;
}

// Média centrada na janela (em metros ou segundos). Valor null continua null.
// opts.progresso(fração 0..1), opcional: avisa o andamento a cada 5000 pontos.
export function mediaMovel(pontos, { tipo = 'metros', valor = 0, progresso = null } = {}, variaveis = ['temp', 'umid', 'orvalho', 'alt']) {
  const saida = pontos.map((p) => ({ ...p }));
  if (!valor) return saida;

  const meia = valor / 2;
  // chave monotônica: distância (m) ou tempo (s)
  const chave = tipo === 'segundos'
    ? (p) => (isNum(p.t) ? p.t / 1000 : null)
    : (p) => (isNum(p.dist) ? p.dist : null);
  const chaves = pontos.map(chave);
  const n = pontos.length;

  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    if (progresso && i % 5000 === 0) progresso(i / n);
    const k = chaves[i];
    if (!isNum(k)) continue;
    while (lo < i && (!isNum(chaves[lo]) || chaves[lo] < k - meia)) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && isNum(chaves[hi + 1]) && chaves[hi + 1] <= k + meia) hi++;

    for (const v of variaveis) {
      if (pontos[i][v] === null || pontos[i][v] === undefined) continue;
      let soma = 0;
      let cont = 0;
      for (let j = lo; j <= hi; j++) {
        const val = pontos[j][v];
        if (!isNum(val) || !isNum(chaves[j]) || Math.abs(chaves[j] - k) > meia) continue;
        soma += val;
        cont++;
      }
      saida[i][v] = cont ? soma / cont : null;
    }
  }
  return saida;
}

// Média, mínimo, máximo e contagem, ignorando null.
export function estatisticas(pontos, variavel) {
  const vals = pontos.map((p) => p[variavel]).filter(isNum);
  if (!vals.length) return { media: null, min: null, max: null, n: 0 };
  let soma = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    soma += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { media: soma / vals.length, min, max, n: vals.length };
}

const fmt = (v, casas) => (isNum(v) ? v.toFixed(casas) : '');
const arred = (v, casas) => (isNum(v) ? Number(v.toFixed(casas)) : null);

// Horário do aparelho ("AAAA-MM-DD HH:MM:SS"): t do trajeto (UTC) + fuso.
export function horarioAparelho(t, fusoHoras = 0) {
  if (!isNum(t)) return '';
  const d = new Date(t + fusoHoras * HORA);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function paraCsv(pontos, { fusoHoras = 0 } = {}) {
  const cab = ['timestamp', 'distancia_m', 'latitude', 'longitude', 'altitude', 'temp_C', 'umidade_RH', 'p_orvalho'];
  const linhas = pontos.map((p) =>
    [
      horarioAparelho(p.t, fusoHoras),
      fmt(p.dist, 1),
      fmt(p.lat, 6),
      fmt(p.lon, 6),
      fmt(p.alt, 1),
      fmt(p.temp, 2),
      fmt(p.umid, 2),
      fmt(p.orvalho, 1),
    ].join(';')
  );
  return '﻿' + [cab.join(';'), ...linhas].join('\r\n') + '\r\n';
}

export function paraGeoJson(pontos, { fusoHoras = 0 } = {}) {
  return {
    type: 'FeatureCollection',
    features: pontos.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        timestamp: isNum(p.t) ? horarioAparelho(p.t, fusoHoras) : null,
        distancia_m: arred(p.dist, 1),
        latitude: arred(p.lat, 6),
        longitude: arred(p.lon, 6),
        altitude: arred(p.alt, 1),
        temp_C: arred(p.temp, 2),
        umidade_RH: arred(p.umid, 2),
        p_orvalho: arred(p.orvalho, 1),
      },
    })),
  };
}
