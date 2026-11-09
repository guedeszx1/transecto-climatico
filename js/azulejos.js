// Faixa de azulejos: um azulejo por trecho, cor pela média da variável.
// O azulejo mostra o valor escrito; a cor do texto é escolhida pelo contraste.

const TINTA = '#14213d';
const BRANCO = '#ffffff';

function hexParaRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminancia(hex) {
  const canais = hexParaRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function razaoContraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

// Texto escuro ou branco, o que tiver mais contraste sobre a cor de fundo.
export function corTexto(fundo) {
  return razaoContraste(fundo, TINTA) >= razaoContraste(fundo, BRANCO) ? TINTA : BRANCO;
}

function formatar(v, casas) {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(casas).replace('.', ',');
}

function formatarKm(metros) {
  return (metros / 1000).toFixed(1).replace('.', ',');
}

// elemento: contêiner da faixa. lista: saída de trechos().
// opcoes: { variavel, min, max, casas, cor(valor) -> hex, aoTocar(i), aoPassar(i), aoSair() }
// Devolve { destacar(i), limpar() } para o sincronismo com a linha do mapa.
export function desenharAzulejos(elemento, lista, opcoes) {
  const { variavel, casas, cor, aoTocar, aoPassar, aoSair } = opcoes;
  elemento.replaceChildren();
  const botoes = [];

  lista.forEach((t, i) => {
    const valor = t.medias ? t.medias[variavel] : null;
    const fundo = cor(valor);
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'azulejo';
    botao.style.background = fundo;
    botao.style.color = corTexto(fundo);
    botao.dataset.i = String(i);
    const texto = formatar(valor, casas);
    botao.setAttribute(
      'aria-label',
      `Trecho de ${formatarKm(t.distIni)} a ${formatarKm(t.distFim)} km: ${texto}`
    );

    const km = document.createElement('span');
    km.className = 'azulejo-km';
    km.textContent = `km ${formatarKm(t.distIni)}`;
    const val = document.createElement('span');
    val.className = 'azulejo-valor';
    val.textContent = texto;
    botao.append(km, val);

    const marcar = () => {
      botoes.forEach((b, k) => b.classList.toggle('ativo', k === i));
      aoPassar(i);
    };
    const soltar = () => {
      botoes.forEach((b) => b.classList.remove('ativo'));
      aoSair();
    };
    botao.addEventListener('click', () => aoTocar(i));
    botao.addEventListener('mouseenter', marcar);
    botao.addEventListener('focus', marcar);
    botao.addEventListener('mouseleave', soltar);
    botao.addEventListener('blur', soltar);
    elemento.appendChild(botao);
    botoes.push(botao);
  });

  return {
    destacar(i) {
      botoes.forEach((b, k) => b.classList.toggle('ativo', k === i));
      const alvo = botoes[i];
      if (alvo && alvo.scrollIntoView) {
        const suave = !globalThis.matchMedia || !matchMedia('(prefers-reduced-motion: reduce)').matches;
        alvo.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: suave ? 'smooth' : 'auto' });
      }
    },
    limpar() {
      botoes.forEach((b) => b.classList.remove('ativo'));
    },
    // índice do azulejo que cobre o segmento i da linha
    doSegmento(seg) {
      return lista.findIndex((t) => t.iIni !== null && seg >= t.iIni && seg <= t.iFim);
    },
  };
}
