// Mensagens e validação da tela de categorias (RF07, RN18, RNF02): nada
// técnico aparece na tela. Para 400/404/409 o texto vem do back-end (campo `erro`).
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

// Limites técnicos do back-end (Issue #38), após remover espaços nas pontas.
export const TAMANHO_MAXIMO_NOME_CATEGORIA = 150;
export const TAMANHO_MAXIMO_DESCRICAO_CATEGORIA = 1000;

// Textos do contrato do back-end (POST/PUT /categorias — 409).
export const MENSAGEM_CATEGORIA_DUPLICADA = 'Já existe uma categoria cadastrada com este nome.';
export const MENSAGEM_ALTERACAO_SIMULTANEA_CATEGORIA =
  'A categoria foi alterada por outra operação ao mesmo tempo. Tente novamente.';

const MENSAGEM_NAO_ENCONTRADA = 'Categoria não encontrada. Atualize a página e tente novamente.';
const MENSAGEM_GENERICA_CRIAR = 'Não foi possível cadastrar a categoria agora. Tente novamente em instantes.';
const MENSAGEM_GENERICA_EDITAR = 'Não foi possível salvar a alteração agora. Tente novamente em instantes.';

/** Texto como o back-end compara e grava: forma NFC, sem espaços nas pontas. */
export function limparTexto(valor) {
  return String(valor ?? '').normalize('NFC').trim();
}

/**
 * Valida nome (obrigatório) e descrição (opcional) antes do envio.
 * É só usabilidade: a validação definitiva é a do back-end (400).
 * @returns {{ nome?: string, descricao?: string }} mensagens por campo
 */
export function validarCategoria({ nome, descricao }) {
  const erros = {};
  const nomeLimpo = limparTexto(nome);
  const descricaoLimpa = limparTexto(descricao);

  if (!nomeLimpo) erros.nome = 'Informe o nome da categoria.';
  else if (nomeLimpo.length > TAMANHO_MAXIMO_NOME_CATEGORIA) {
    erros.nome = `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME_CATEGORIA} caracteres.`;
  }

  if (descricaoLimpa.length > TAMANHO_MAXIMO_DESCRICAO_CATEGORIA) {
    erros.descricao = `A descrição deve ter no máximo ${TAMANHO_MAXIMO_DESCRICAO_CATEGORIA} caracteres.`;
  }

  return erros;
}

/**
 * Indica se o 409 é de nome repetido (RN18): a mensagem vai junto ao campo Nome.
 * O outro 409 possível é o de alteração simultânea, exibido como erro geral.
 */
export function ehConflitoDeNome(falha) {
  return falha?.status === 409 && falha?.message !== MENSAGEM_ALTERACAO_SIMULTANEA_CATEGORIA;
}

/** Mensagem do 409 de nome repetido (texto do back-end, ou o mesmo texto fixo). */
export function mensagemNomeDuplicado(falha) {
  return falha?.doServidor && falha?.message ? falha.message : MENSAGEM_CATEGORIA_DUPLICADA;
}

/**
 * Indica se a lista na tela pode estar desatualizada: categoria não encontrada
 * (404) ou alterada ao mesmo tempo por outra operação (409). Nesses casos a
 * página recarrega a lista em segundo plano.
 */
export function listaPodeEstarDesatualizada(falha) {
  if (falha?.status === 404) return true;
  return falha?.status === 409 && falha?.message === MENSAGEM_ALTERACAO_SIMULTANEA_CATEGORIA;
}

/**
 * Converte a falha do POST/PUT /categorias em mensagem geral para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @param {'criar' | 'editar'} acao
 * @returns {string}
 */
export function mensagemErroCategoria(falha, acao) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 404, 409].includes(status) && falha?.doServidor && falha?.message) {
    return falha.message;
  }
  if (status === 404) return MENSAGEM_NAO_ENCONTRADA;
  return acao === 'editar' ? MENSAGEM_GENERICA_EDITAR : MENSAGEM_GENERICA_CRIAR;
}
