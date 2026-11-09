// Tema claro ou escuro. Script comum e síncrono, no head, antes do CSS: aplica o tema
// antes da primeira pintura (a CSP não aceita script inline).
//
// Regra: a escolha salva vale; sem escolha, segue o sistema (prefers-color-scheme) e
// acompanha quando o sistema muda. Só grava a chave "tema", com "claro" ou "escuro".
// Se o armazenamento falhar (modo privado, bloqueado), o site funciona e só não lembra.
(function () {
  var CHAVE = 'tema';
  var raiz = document.documentElement;
  var sistema = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function lerEscolha() {
    try {
      var v = window.localStorage.getItem(CHAVE);
      return v === 'claro' || v === 'escuro' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function gravarEscolha(v) {
    try {
      window.localStorage.setItem(CHAVE, v);
    } catch (e) {
      // sem armazenamento: o tema vale só nesta página
    }
  }

  function escuroDoSistema() {
    return !!(sistema && sistema.matches);
  }

  function aplicar(tema) {
    raiz.setAttribute('data-theme', tema === 'escuro' ? 'dark' : 'light');
    atualizarBotoes();
  }

  function atualizarBotoes() {
    var escuro = raiz.getAttribute('data-theme') === 'dark';
    var rotulo = escuro ? 'Ativar modo claro' : 'Ativar modo escuro';
    var botoes = document.querySelectorAll('[data-tema-alternar]');
    for (var i = 0; i < botoes.length; i++) botoes[i].setAttribute('aria-label', rotulo);
  }

  var escolhido = lerEscolha();
  aplicar(escolhido || (escuroDoSistema() ? 'escuro' : 'claro'));

  document.addEventListener('DOMContentLoaded', atualizarBotoes);

  // clique no botão de tema (em qualquer página)
  document.addEventListener('click', function (e) {
    var alvo = e.target && e.target.closest ? e.target.closest('[data-tema-alternar]') : null;
    if (!alvo) return;
    var proximo = raiz.getAttribute('data-theme') === 'dark' ? 'claro' : 'escuro';
    gravarEscolha(proximo);
    aplicar(proximo);
    document.dispatchEvent(new CustomEvent('tema-mudou'));
  });

  // sem escolha salva, acompanha o sistema
  if (sistema) {
    var mudou = function () {
      if (lerEscolha()) return;
      aplicar(escuroDoSistema() ? 'escuro' : 'claro');
      document.dispatchEvent(new CustomEvent('tema-mudou'));
    };
    if (sistema.addEventListener) sistema.addEventListener('change', mudou);
    else if (sistema.addListener) sistema.addListener(mudou);
  }
})();
