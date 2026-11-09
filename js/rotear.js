// Decide para onde vai cada arquivo solto ou escolhido, pela extensão. Sem DOM.

const TERMO = new Set(['csv', 'txt', 'tsv', 'xlsx', 'xls']);
const TRAJETO = new Set(['kml', 'kmz', 'gpx']);

// 'termo' para tabela do termohigrômetro, 'trajeto' para KML/KMZ/GPX, null para o resto.
// Não diferencia maiúsculas: ARQUIVO.CSV é tabela.
export function tipoDoArquivo(nome) {
  if (typeof nome !== 'string') return null;
  const i = nome.lastIndexOf('.');
  if (i < 0 || i === nome.length - 1) return null;
  const ext = nome.slice(i + 1).toLowerCase();
  if (TERMO.has(ext)) return 'termo';
  if (TRAJETO.has(ext)) return 'trajeto';
  return null;
}
