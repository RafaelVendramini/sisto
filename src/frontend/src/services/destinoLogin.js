// Destino depois do login (Issue #128): quando a sessão vence, o app volta ao
// login guardando em `state.de` a tela de origem (caminho + busca). Depois de
// entrar, a pessoa volta para essa tela.
//
// Só são aceitos destinos internos: começam com "/" e não com "//" nem "/\"
// (que o navegador pode tratar como endereço de outro site). O próprio login
// também é recusado, para não voltar à mesma tela.

const ROTA_LOGIN = '/login';

/**
 * Valida o destino guardado em `state.de`.
 * @param {unknown} de
 * @returns {string | null} o destino, se for interno e diferente do login; senão null
 */
export function destinoInterno(de) {
  if (typeof de !== 'string' || !de.startsWith('/')) return null;
  if (de.startsWith('//') || de.startsWith('/\\')) return null;
  // Caracteres de controle (ex.: quebra de linha) não fazem parte de um caminho válido.
  if (/[\u0000-\u001f\u007f]/.test(de)) return null;
  // O roteador compara caminhos sem diferenciar maiúsculas de minúsculas.
  const caminho = de.split(/[?#]/)[0].toLowerCase();
  if (caminho === ROTA_LOGIN || caminho === `${ROTA_LOGIN}/`) return null;
  return de;
}

/**
 * Monta o `state` da navegação para o login a partir da tela atual.
 * @param {{ pathname: string, search?: string }} local - location do react-router
 * @returns {{ de: string } | undefined}
 */
export function estadoVoltarPara(local) {
  const de = destinoInterno(`${local?.pathname ?? ''}${local?.search ?? ''}`);
  return de ? { de } : undefined;
}
