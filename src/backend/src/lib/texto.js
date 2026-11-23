// Verificações de texto compartilhadas entre os services — Sisto (Issue #127).
//
// O PostgreSQL não grava o caractere nulo (U+0000) em colunas de texto: o
// banco recusa com o erro 22021 e, sem esta checagem, a API responderia 500.
// Os services recusam o caractere antes de qualquer consulta, com 400.
import { ErroHttp } from './erros.js';

/** O PostgreSQL não grava U+0000 em colunas de texto (erro 22021 → 500). */
export const MENSAGEM_TEXTO_CARACTERE_INVALIDO =
  'O texto contém um caractere inválido. Remova-o e tente novamente.';

/**
 * Indica se o texto contém o caractere nulo (U+0000).
 * @param {string} texto
 * @returns {boolean}
 */
export function contemCaractereNulo(texto) {
  return texto.includes('\u0000');
}

/**
 * Recusa o caractere nulo, que o PostgreSQL não aceita em texto (400, não 500).
 * @param {string} texto
 * @throws {ErroHttp} 400
 */
export function garantirSemCaractereNulo(texto) {
  if (contemCaractereNulo(texto)) throw new ErroHttp(400, MENSAGEM_TEXTO_CARACTERE_INVALIDO);
}
