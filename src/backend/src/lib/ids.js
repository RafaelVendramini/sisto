// Validação de identificadores compartilhada entre os services — Sisto (Issue #129).
//
// Todo `id` e toda FK `*_id` são Int no PostgreSQL (Seção 11). Os ids chegam
// de dois jeitos:
// - na URL e na query string, como TEXTO ("42"): aceito só em notação decimal
//   simples (sem sinal, zeros à esquerda, espaços ou expoente);
// - no corpo JSON, como NÚMERO (texto é recusado — Seção 12).
// Nos dois casos, o valor precisa caber num Int (até MAIOR_ID); acima disso o
// banco recusaria a consulta e a API responderia 500 em vez de 400.
import { ErroHttp } from './erros.js';

/** Maior valor de uma coluna Int do PostgreSQL (tipo dos ids, Seção 11). */
export const MAIOR_ID = 2_147_483_647;

/** Inteiro positivo em texto decimal simples, com até 10 dígitos. */
const REGEX_ID_TEXTO = /^[1-9][0-9]{0,9}$/;

/**
 * Indica se o texto é um id válido (inteiro positivo, decimal simples, até MAIOR_ID).
 * @param {unknown} valor
 * @returns {boolean}
 */
export function ehIdTexto(valor) {
  return typeof valor === 'string' && REGEX_ID_TEXTO.test(valor) && Number(valor) <= MAIOR_ID;
}

/**
 * Converte um id recebido como texto (URL ou query string).
 * @param {unknown} valor ex.: req.params.id
 * @param {string} mensagem mensagem do 400 (própria de cada recurso)
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function converterIdTexto(valor, mensagem) {
  if (!ehIdTexto(valor)) throw new ErroHttp(400, mensagem);
  return Number(valor);
}

/**
 * Indica se o valor é um id numérico válido do corpo JSON (inteiro de 1 a MAIOR_ID).
 * @param {unknown} valor
 * @returns {boolean}
 */
export function ehIdNumerico(valor) {
  return Number.isInteger(valor) && valor >= 1 && valor <= MAIOR_ID;
}
