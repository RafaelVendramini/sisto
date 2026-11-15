// Códigos estáveis do corpo de erro da API (SSD v1.8, Seção 12 — Issue #72, D1).
// Espelham CODIGOS_ERRO do back-end (src/backend/src/lib/erros.js): todo 409
// traz um destes códigos em `codigo`, e o 403 da troca de senha obrigatória
// pendente (RN10) traz TROCA_SENHA_OBRIGATORIA. O front-end identifica o caso
// pelo código, não pelo texto da mensagem; o texto só serve de reserva quando
// a resposta vem sem código.
export const CODIGOS_ERRO = Object.freeze({
  CONFLITO_CONCORRENTE: 'CONFLITO_CONCORRENTE',
  EMAIL_DUPLICADO: 'EMAIL_DUPLICADO',
  CATEGORIA_DUPLICADA: 'CATEGORIA_DUPLICADA',
  TURMA_DUPLICADA: 'TURMA_DUPLICADA',
  CODIGO_ESCOLAR_DUPLICADO: 'CODIGO_ESCOLAR_DUPLICADO',
  GESTAO_ATIVA_MINIMA: 'GESTAO_ATIVA_MINIMA',
  ALTERAR_PROPRIO_ACESSO: 'ALTERAR_PROPRIO_ACESSO',
  REDEFINIR_PROPRIA_SENHA: 'REDEFINIR_PROPRIA_SENHA',
  TUTOR_COM_TUTORADOS: 'TUTOR_COM_TUTORADOS',
  OCORRENCIA_ENCERRADA: 'OCORRENCIA_ENCERRADA',
  OCORRENCIA_ABERTA: 'OCORRENCIA_ABERTA',
  ENCERRAMENTO_SEM_PROVIDENCIA: 'ENCERRAMENTO_SEM_PROVIDENCIA',
  TROCA_SENHA_OBRIGATORIA: 'TROCA_SENHA_OBRIGATORIA',
});

/**
 * Código da falha (campo `codigo` do corpo de erro), ou null quando não veio.
 * @param {{ codigo?: unknown } | null | undefined} falha
 * @returns {string | null}
 */
export function codigoDaFalha(falha) {
  return typeof falha?.codigo === 'string' && falha.codigo ? falha.codigo : null;
}

/**
 * Indica se a falha é do tipo `codigo`. Com código na resposta, só ele decide;
 * sem código, decide a função de reserva (em geral, pelo texto da mensagem).
 * @param {object} falha
 * @param {string} codigo - um valor de CODIGOS_ERRO
 * @param {(falha: object) => boolean} [reserva]
 * @returns {boolean}
 */
export function falhaTemCodigo(falha, codigo, reserva) {
  const recebido = codigoDaFalha(falha);
  if (recebido) return recebido === codigo;
  return Boolean(reserva?.(falha));
}
