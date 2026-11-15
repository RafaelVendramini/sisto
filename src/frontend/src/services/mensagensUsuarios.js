// Mensagens de erro exibidas na alteração de usuários (RNF02): nada técnico
// aparece na tela. Para 400/404/409 o texto vem do back-end (campo `erro`).
import { CODIGOS_ERRO, falhaTemCodigo } from './codigosErro.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

// Textos do contrato do back-end (PUT/POST /usuarios — 409). O tipo do 409 é
// identificado pelo `codigo` (Issue #72); o texto só é reserva sem código.
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

/**
 * Indica se o 409 da edição é de e-mail já cadastrado (codigo EMAIL_DUPLICADO):
 * a mensagem vai junto ao campo E-mail. Sem código, vale a reserva pelo texto.
 */
export function ehConflitoDeEmail(falha) {
  return (
    falha?.status === 409 &&
    falhaTemCodigo(
      falha,
      CODIGOS_ERRO.EMAIL_DUPLICADO,
      (f) => Boolean(f.doServidor) && f.message === MENSAGEM_EMAIL_DUPLICADO,
    )
  );
}

/**
 * Indica se o 409 do cadastro (POST /usuarios) é de e-mail já cadastrado
 * (codigo EMAIL_DUPLICADO). Sem código, todo 409 do cadastro conta como e-mail
 * repetido (é o único 409 que o cadastro devolve).
 */
export function ehEmailDuplicadoNoCadastro(falha) {
  return (
    falha?.status === 409 && falhaTemCodigo(falha, CODIGOS_ERRO.EMAIL_DUPLICADO, () => true)
  );
}

/**
 * Indica se a lista na tela pode estar desatualizada: usuário não encontrado (404)
 * ou alterado ao mesmo tempo por outra operação (409). Nesses casos a página
 * recarrega a lista em segundo plano.
 */
export function listaPodeEstarDesatualizada(falha) {
  if (falha?.status === 404) return true;
  return (
    falha?.status === 409 &&
    falhaTemCodigo(
      falha,
      CODIGOS_ERRO.CONFLITO_CONCORRENTE,
      (f) => f.message === MENSAGEM_ALTERACAO_SIMULTANEA,
    )
  );
}

const MENSAGEM_PROPRIA_SENHA =
  'Você não pode redefinir a sua própria senha por aqui. Use a opção "Alterar minha senha".';
const MENSAGEM_GENERICA_SENHA =
  'Não foi possível redefinir a senha agora. Tente novamente em instantes.';

/**
 * Converte a falha do PUT /usuarios/{id}/senha em mensagem para a tela (RF03).
 * Para 400/404/409 o texto vem do back-end; os demais têm texto fixo.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @returns {string}
 */
export function mensagemErroRedefinicaoSenha(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 404, 409].includes(status) && falha?.doServidor && falha?.message) {
    return falha.message;
  }
  if (status === 404) return MENSAGEM_NAO_ENCONTRADO;
  if (status === 409) return MENSAGEM_PROPRIA_SENHA;
  return MENSAGEM_GENERICA_SENHA;
}
