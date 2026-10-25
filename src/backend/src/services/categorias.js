// Cadastro, listagem e edição de categorias de ocorrência — Sisto (Issue #38).
//
// - RF07: criação e edição de categorias (Seção 12: GET, POST e PUT /categorias).
// - RN18: o nome é único, sem diferenciar maiúsculas/minúsculas e ignorando
//   espaços nas pontas. A checagem fica aqui no service (sem extensão citext
//   e sem índice no banco); duplicidade responde 409.
// - RN20: a listagem é a mesma para os 5 perfis (as restrições de perfil do
//   POST/PUT ficam nas rotas, com permitirPerfis).
// - RN21: categorias não são excluídas nem inativadas (não há DELETE).
// - RNF04: criação e edição gravam LogAuditoria com recurso "categorias/<id>",
//   na mesma transação da alteração, sem dados pessoais.
//
// Concorrência (RN18): a leitura dos nomes existentes, a checagem de
// duplicidade, a gravação e a auditoria rodam numa transação SERIALIZABLE,
// como em services/usuarios.js. Se dois cadastros (ou edições) simultâneos
// com o mesmo nome passarem pela checagem ao mesmo tempo, o PostgreSQL aborta
// um deles (SQLSTATE 40001, exposto pelo Prisma como P2034); ele é repetido,
// passa a enxergar o nome já gravado e responde 409. Esgotadas as tentativas,
// também 409, com mensagem para tentar de novo.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';

/** Nome do recurso na API, usado no LogAuditoria ("categorias/<id>"). */
export const RECURSO_CATEGORIAS = 'categorias';

/**
 * Limites TÉCNICOS defensivos (após trim), contra entradas abusivas, no mesmo
 * espírito do limite do nome de usuário (#12). Não são regras de negócio do SSD.
 */
export const TAMANHO_MAXIMO_NOME_CATEGORIA = 150;
export const TAMANHO_MAXIMO_DESCRICAO_CATEGORIA = 1000;

/** Maior valor de uma coluna Int do PostgreSQL (tipo do id, Seção 11). */
const MAIOR_ID = 2_147_483_647;

/** Tentativas da transação serializável antes de desistir com 409. */
const TENTATIVAS_TRANSACAO = 3;

export const MENSAGEM_CORPO_CATEGORIA_INVALIDO =
  'Envie um objeto JSON com nome e, opcionalmente, descricao.';
export const MENSAGEM_NOME_CATEGORIA_OBRIGATORIO = 'Informe nome (texto não vazio).';
export const MENSAGEM_NOME_CATEGORIA_LONGO = `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME_CATEGORIA} caracteres.`;
export const MENSAGEM_DESCRICAO_CATEGORIA_INVALIDA = 'A descrição deve ser um texto.';
export const MENSAGEM_DESCRICAO_CATEGORIA_LONGA = `A descrição deve ter no máximo ${TAMANHO_MAXIMO_DESCRICAO_CATEGORIA} caracteres.`;
export const MENSAGEM_CATEGORIA_DUPLICADA = 'Já existe uma categoria cadastrada com este nome.';
export const MENSAGEM_ID_CATEGORIA_INVALIDO = 'Identificador de categoria inválido.';
export const MENSAGEM_CATEGORIA_NAO_ENCONTRADA = 'Categoria não encontrada.';
export const MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA =
  'A categoria foi alterada por outra operação ao mesmo tempo. Tente novamente.';

/** Campos devolvidos ao cliente (Seção 11). */
export const SELECAO_CATEGORIA = Object.freeze({ id: true, nome: true, descricao: true });

/**
 * Chave de comparação do nome (RN18): sem espaços nas pontas e em minúsculas.
 * A normalização NFC faz o mesmo acento digitado de formas diferentes (ex.:
 * "ã" composto ou "a" + til) virar o mesmo texto.
 * @param {string} nome
 */
export function chaveNomeCategoria(nome) {
  return nome.normalize('NFC').trim().toLowerCase();
}

/**
 * Valida e normaliza o corpo do POST e do PUT /categorias ({ nome, descricao? }).
 * Outros campos (id etc.) são ignorados.
 * - nome: obrigatório, texto não vazio após trim; gravado sem espaços nas pontas.
 * - descricao: opcional; texto vazio (ou só espaços) ou null vira null. Ausente
 *   (undefined) é devolvido como undefined: no POST grava null; no PUT mantém
 *   a descrição atual.
 * @param {unknown} corpo
 * @returns {{ nome: string, descricao?: string | null }}
 * @throws {ErroHttp} 400
 */
export function validarCategoria(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_CATEGORIA_INVALIDO);
  }

  const { nome, descricao } = corpo;

  if (typeof nome !== 'string' || nome.trim() === '') {
    throw new ErroHttp(400, MENSAGEM_NOME_CATEGORIA_OBRIGATORIO);
  }
  const nomeLimpo = nome.normalize('NFC').trim();
  if (nomeLimpo.length > TAMANHO_MAXIMO_NOME_CATEGORIA) {
    throw new ErroHttp(400, MENSAGEM_NOME_CATEGORIA_LONGO);
  }

  const dados = { nome: nomeLimpo };

  if (descricao === null) {
    dados.descricao = null;
  } else if (descricao !== undefined) {
    if (typeof descricao !== 'string') {
      throw new ErroHttp(400, MENSAGEM_DESCRICAO_CATEGORIA_INVALIDA);
    }
    const descricaoLimpa = descricao.trim();
    if (descricaoLimpa.length > TAMANHO_MAXIMO_DESCRICAO_CATEGORIA) {
      throw new ErroHttp(400, MENSAGEM_DESCRICAO_CATEGORIA_LONGA);
    }
    dados.descricao = descricaoLimpa === '' ? null : descricaoLimpa;
  }

  return dados;
}

/**
 * Converte o id da URL. Aceita apenas inteiro positivo em notação decimal
 * simples, dentro do limite do Int do banco.
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function validarIdCategoria(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) {
    throw new ErroHttp(400, MENSAGEM_ID_CATEGORIA_INVALIDO);
  }
  const id = Number(valor);
  if (id > MAIOR_ID) {
    throw new ErroHttp(400, MENSAGEM_ID_CATEGORIA_INVALIDO);
  }
  return id;
}

/**
 * RN18: recusa (409) se outra categoria já usa o nome. A comparação é feita
 * aqui (trim + minúsculas dos dois lados), o que também cobre registros
 * gravados fora da API com espaços nas pontas. O volume de categorias de uma
 * escola é pequeno, então a leitura de todos os nomes é barata.
 * @param {object} tx client da transação
 * @param {string} nome nome já sem espaços nas pontas
 * @param {number} [idIgnorado] id da própria categoria (edição)
 */
async function garantirNomeDisponivel(tx, nome, idIgnorado) {
  const chave = chaveNomeCategoria(nome);
  const existentes = await tx.categoria.findMany({ select: { id: true, nome: true } });
  const duplicada = existentes.some(
    (categoria) => categoria.id !== idIgnorado && chaveNomeCategoria(categoria.nome) === chave,
  );
  if (duplicada) {
    throw new ErroHttp(409, MENSAGEM_CATEGORIA_DUPLICADA);
  }
}

/**
 * Executa a operação numa transação SERIALIZABLE, repetindo-a em conflito de
 * serialização (P2034). Esgotadas as tentativas, responde 409.
 */
async function emTransacaoSerializavel(db, operacao) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (erro instanceof ErroHttp) throw erro;
      if (erro?.code === 'P2034') {
        if (tentativa < TENTATIVAS_TRANSACAO) continue;
        throw new ErroHttp(409, MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA);
      }
      throw erro;
    }
  }
}

/**
 * Lista todas as categorias, ordenadas por nome e depois id (ordem estável).
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<Array<{ id: number, nome: string, descricao: string | null }>>}
 */
export async function listarCategorias({ db = prisma } = {}) {
  return db.categoria.findMany({
    select: SELECAO_CATEGORIA,
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Cria uma categoria (RF07, RN18) e registra a auditoria (RNF04).
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, descricao: string | null }>}
 * @throws {ErroHttp} 400 (dados inválidos) ou 409 (nome duplicado / conflito)
 */
export async function criarCategoria(corpo, solicitante, { db = prisma } = {}) {
  const { nome, descricao = null } = validarCategoria(corpo);

  return emTransacaoSerializavel(db, async (tx) => {
    await garantirNomeDisponivel(tx, nome);
    const categoria = await tx.categoria.create({
      data: { nome, descricao },
      select: SELECAO_CATEGORIA,
    });
    await registrarAuditoria(
      {
        usuarioId: solicitante?.id ?? null,
        acao: ACOES_AUDITORIA.CATEGORIA_CRIADA,
        recurso: recursoAuditoria(RECURSO_CATEGORIAS, categoria.id),
      },
      tx,
    );
    return categoria;
  });
}

/**
 * Edita o nome e/ou a descrição de uma categoria (RF07, RN18) e registra a
 * auditoria (RNF04). Manter o próprio nome (inclusive com outra caixa) não é
 * duplicidade.
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, descricao: string | null }>}
 * @throws {ErroHttp} 400 (id/dados inválidos), 404 (inexistente) ou 409 (duplicado / conflito)
 */
export async function atualizarCategoria(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdCategoria(idUrl);
  const dados = validarCategoria(corpo);

  try {
    return await editarEmTransacao(db, id, dados, solicitante);
  } catch (erro) {
    // Registro inexistente no update (ex.: removido direto no banco).
    if (erro?.code === 'P2025') throw new ErroHttp(404, MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    throw erro;
  }
}

function editarEmTransacao(db, id, dados, solicitante) {
  return emTransacaoSerializavel(db, async (tx) => {
    const atual = await tx.categoria.findUnique({ where: { id }, select: { id: true } });
    if (!atual) {
      throw new ErroHttp(404, MENSAGEM_CATEGORIA_NAO_ENCONTRADA);
    }
    await garantirNomeDisponivel(tx, dados.nome, id);
    const categoria = await tx.categoria.update({
      where: { id },
      data: dados,
      select: SELECAO_CATEGORIA,
    });
    await registrarAuditoria(
      {
        usuarioId: solicitante?.id ?? null,
        acao: ACOES_AUDITORIA.CATEGORIA_EDITADA,
        recurso: recursoAuditoria(RECURSO_CATEGORIAS, categoria.id),
      },
      tx,
    );
    return categoria;
  });
}
