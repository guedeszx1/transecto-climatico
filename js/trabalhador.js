// Cálculo pesado fora da página: cruzar, suavizar e montar os trechos.
// Módulo de Worker (type: 'module'), sem dependências, compatível com CSP script-src 'self'.
// A função processar() não usa DOM nem Worker: os testes a chamam direto no Node.

import { cruzar, mediaMovel, trechos, tamanhoTrecho } from './cruzar.js';

// entrada: { leituras, pontos, fuso, media: { tipo, valor }, ritmo: { inicioMs, fimMs, inverter } | null }
// ritmo só vale no modo distância (trajeto sem horário); null mantém o cálculo de sempre.
// progresso(passo, pct): passo em palavras simples, pct de 0 a 100.
export function processar({ leituras, pontos, fuso, media, ritmo = null }, progresso = () => {}) {
  progresso('Cruzando os horários', 0);
  const cruzado = cruzar(leituras, pontos, { fusoHoras: fuso, ...(ritmo || {}) });

  progresso('Suavizando a linha', 20);
  const exibidos = mediaMovel(cruzado.pontos, {
    ...media,
    progresso: (f) => progresso('Suavizando a linha', 20 + Math.round(f * 70)),
  });

  progresso('Montando os trechos', 90);
  const total = exibidos.length ? exibidos[exibidos.length - 1].dist : 0;
  const lista = exibidos.length >= 2 ? trechos(exibidos, tamanhoTrecho(total)) : [];

  progresso('Pronto', 100);
  // os pontos cruzados não voltam: a página só precisa do resumo do cruzamento
  return {
    cruzado: {
      modo: cruzado.modo,
      semDado: cruzado.semDado,
      avisos: cruzado.avisos,
      ...(cruzado.info ? { info: cruzado.info } : {}),
    },
    exibidos,
    lista,
  };
}

// Dentro do Worker: responde a cada pedido com progresso e o resultado (ou erro).
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    try {
      const r = processar(e.data, (passo, pct) => self.postMessage({ tipo: 'progresso', passo, pct }));
      self.postMessage({ tipo: 'ok', ...r });
    } catch (err) {
      self.postMessage({ tipo: 'erro', mensagem: err && err.message ? err.message : String(err) });
    }
  };
}
