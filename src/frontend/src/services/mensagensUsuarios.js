// Mensagens de erro exibidas na alteração de usuários (RNF02): nada técnico
// aparece na tela. Para 400/404/409 o texto vem do back-end (campo `erro`).
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

// Textos do contrato do back-end (PUT/POST /usuarios — 409).
export const MENSAGEM_EMAIL_DUPLICADO = 'Já existe um usuário cadastrado com este e-mail.';
export const MENSAGEM_ALTERACAO_SIMULTANEA =
  'O usuário foi alterado por outra operação ao mesmo tempo. Tente novamente.';

const MENSAGEM_NAO_ENCONTRADO = 'Usuário não encontrado. Atualize a página e tente novamente.';
const MENSAGEM_CONFLITO =
  'Não foi possível salvar esta alteração agora. Atualize a página e tente novamente.';
const MENSAGEM_GENERICA = 'Não foi possível salvar a alteração agora. Tente novamente em instantes.';

/**
 * Converte a falha do PUT /usuarios/{id} em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @returns {string}
 */
export function mensagemErroAlteracaoUsuario(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 404, 409].includes(status) && falha?.doServidor && falha?.message) {
    return falha.message;
  }
  if (status === 404) return MENSAGEM_NAO_ENCONTRADO;
  if (status === 409) return MENSAGEM_CONFLITO;
  return MENSAGEM_GENERICA;
}

/** Indica se o 409 é de e-mail já cadastrado (a mensagem vai junto ao campo E-mail). */
export function ehConflitoDeEmail(falha) {
  return (
    falha?.status === 409 &&
    Boolean(falha?.doServidor) &&
    falha?.message === MENSAGEM_EMAIL_DUPLICADO
  );
}

/**
 * Indica se a lista na tela pode estar desatualizada: usuário não encontrado (404)
 * ou alterado ao mesmo tempo por outra operação (409). Nesses casos a página
 * recarrega a lista em segundo plano.
 */
export function listaPodeEstarDesatualizada(falha) {
  if (falha?.status === 404) return true;
  return falha?.status === 409 && falha?.message === MENSAGEM_ALTERACAO_SIMULTANEA;
}
