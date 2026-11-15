// Política e hash de senhas — Sisto.
// Reutilizável pelo seed (#9), login (#10) e cadastro de usuários (#12).
//
// - RN10: senha com no mínimo 8 caracteres.
// - RNF03: senhas armazenadas somente como hash bcrypt (nunca em texto).
import bcrypt from 'bcrypt';

/** RN10: tamanho mínimo da senha. */
export const TAMANHO_MINIMO_SENHA = 8;

/**
 * Limite TÉCNICO do bcrypt (não é regra de negócio): o algoritmo só considera
 * os primeiros 72 bytes da senha e ignora o resto em silêncio. Recusamos
 * senhas maiores para que dois valores diferentes com o mesmo prefixo de 72
 * bytes não sejam aceitos como a mesma senha. O limite é em bytes UTF-8, não
 * em caracteres: letras acentuadas ocupam 2 bytes.
 */
export const TAMANHO_MAXIMO_BYTES_SENHA = 72;

/**
 * Custo padrão (salt rounds) do bcrypt: 12 => 2^12 iterações. Fica acima do
 * mínimo de 10 recomendado pela OWASP e custa da ordem de centenas de
 * milissegundos por hash — aceitável para login/cadastro (operações pouco
 * frequentes) e caro o bastante para dificultar força bruta se os hashes vazarem.
 */
export const CUSTO_BCRYPT = 12;

/**
 * Retorna a mensagem do problema da senha, ou null se ela for aceita.
 * A mensagem nunca contém a senha.
 * @param {unknown} senha
 * @returns {string | null}
 */
export function mensagemPoliticaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < TAMANHO_MINIMO_SENHA) {
    return `A senha deve ter no mínimo ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  if (Buffer.byteLength(senha, 'utf8') > TAMANHO_MAXIMO_BYTES_SENHA) {
    return `A senha deve ter no máximo ${TAMANHO_MAXIMO_BYTES_SENHA} bytes (letras acentuadas contam 2 bytes).`;
  }
  return null;
}

/**
 * Verifica se a senha atende à política (RN10) e ao limite técnico do bcrypt.
 * @param {unknown} senha
 * @returns {boolean}
 */
export function validarPoliticaSenha(senha) {
  return mensagemPoliticaSenha(senha) === null;
}

/**
 * Gera o hash bcrypt de uma senha válida.
 * Lança erro (sem expor a senha) se a senha não for aceita.
 * @param {string} senha
 * @param {number} [custo] salt rounds; padrão CUSTO_BCRYPT. Valores menores só em testes.
 * @returns {Promise<string>}
 */
export async function gerarHashSenha(senha, custo = CUSTO_BCRYPT) {
  const problema = mensagemPoliticaSenha(senha);
  if (problema) {
    throw new Error(problema);
  }
  return bcrypt.hash(senha, custo);
}
