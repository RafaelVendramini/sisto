// Política de senha usada nas telas (RN10 e limite técnico do bcrypt no
// back-end). É só usabilidade: a validação definitiva é a do back-end (400).
export const TAMANHO_MINIMO_SENHA = 8; // RN10
export const TAMANHO_MAXIMO_SENHA_BYTES = 72; // limite do bcrypt no back-end

export function tamanhoEmBytes(texto) {
  return new TextEncoder().encode(texto).length;
}

/**
 * Valida uma senha nova ou temporária (já preenchida).
 * @param {string} senha
 * @returns {string} mensagem do problema, ou '' se a senha for aceita
 */
export function problemaNaSenha(senha) {
  if (String(senha ?? '').length < TAMANHO_MINIMO_SENHA) {
    return `A senha deve ter no mínimo ${TAMANHO_MINIMO_SENHA} caracteres.`;
  }
  if (tamanhoEmBytes(senha) > TAMANHO_MAXIMO_SENHA_BYTES) {
    return 'A senha está muito longa. Use no máximo 72 caracteres (letras acentuadas contam como 2).';
  }
  return '';
}
