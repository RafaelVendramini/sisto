// Cadastro, listagem e edição de turmas — Sisto (Issue #40).
//
// - RF15: cadastro e edição de turmas (Seção 12: GET, POST e PUT /turmas).
// - Contrato (Seção 12): POST e PUT recebem { nome, etapa, anoLetivo }, todos
//   obrigatórios; anoLetivo é inteiro de 4 dígitos. A API usa camelCase
//   (anoLetivo) e o banco snake_case (ano_letivo, Seção 11).
// - RN18: o trio (nome, etapa, ano letivo) é único; os textos são comparados
//   sem diferenciar maiúsculas/minúsculas e ignorando espaços nas pontas. A
//   checagem fica aqui no service (sem índice no banco); duplicidade: 409.
//   A mesma turma (nome e etapa) em outro ano letivo é aceita.
// - RN20: a listagem é a mesma para os 5 perfis (as restrições de perfil do
//   POST/PUT ficam nas rotas, com permitirPerfis).
// - RN21: turmas não são excluídas nem inativadas (não há DELETE).
// - RNF04: criação e edição gravam LogAuditoria com recurso "turmas/<id>",
//   na mesma transação da alteração, sem dados pessoais.
//
// Concorrência (RN18): como em services/categorias.js, leitura, checagem,
// gravação e auditoria rodam numa transação SERIALIZABLE; conflito de
// serialização (P2034) é repetido e, esgotadas as tentativas, responde 409.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';

/** Nome do recurso na API, usado no LogAuditoria ("turmas/<id>"). */
export const RECURSO_TURMAS = 'turmas';

/**
 * Limites TÉCNICOS defensivos (após trim), contra entradas abusivas, no mesmo
 * espírito dos limites de categorias (#38). Não são regras de negócio do SSD.
 */
export const TAMANHO_MAXIMO_NOME_TURMA = 150;
export const TAMANHO_MAXIMO_ETAPA_TURMA = 150;

/** "Inteiro de 4 dígitos" (Seção 12): de 1000 a 9999. */
export const MENOR_ANO_LETIVO = 1000;
export const MAIOR_ANO_LETIVO = 9999;

/** Maior valor de uma coluna Int do PostgreSQL (tipo do id, Seção 11). */
const MAIOR_ID = 2_147_483_647;

/** Tentativas da transação serializável antes de desistir com 409. */
const TENTATIVAS_TRANSACAO = 3;

export const MENSAGEM_CORPO_TURMA_INVALIDO =
  'Envie um objeto JSON com nome, etapa e anoLetivo.';
export const MENSAGEM_NOME_TURMA_OBRIGATORIO = 'Informe nome (texto não vazio).';
export const MENSAGEM_NOME_TURMA_LONGO = `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME_TURMA} caracteres.`;
export const MENSAGEM_ETAPA_TURMA_OBRIGATORIA = 'Informe etapa (texto não vazio).';
export const MENSAGEM_ETAPA_TURMA_LONGA = `A etapa deve ter no máximo ${TAMANHO_MAXIMO_ETAPA_TURMA} caracteres.`;
export const MENSAGEM_ANO_LETIVO_INVALIDO =
  'Informe anoLetivo como número inteiro de 4 dígitos (ex.: 2026).';
export const MENSAGEM_TURMA_DUPLICADA =
  'Já existe uma turma cadastrada com este nome e esta etapa neste ano letivo.';
export const MENSAGEM_ID_TURMA_INVALIDO = 'Identificador de turma inválido.';
export const MENSAGEM_TURMA_NAO_ENCONTRADA = 'Turma não encontrada.';
export const MENSAGEM_CONFLITO_CONCORRENTE_TURMA =
  'A turma foi alterada por outra operação ao mesmo tempo. Tente novamente.';

/** Campos lidos do banco (Seção 11). */
const SELECAO_TURMA = Object.freeze({ id: true, nome: true, etapa: true, ano_letivo: true });

/**
 * Converte o registro do banco (snake_case) para a resposta da API (camelCase).
 * @param {{ id: number, nome: string, etapa: string, ano_letivo: number }} turma
 * @returns {{ id: number, nome: string, etapa: string, anoLetivo: number }}
 */
export function paraRespostaTurma({ id, nome, etapa, ano_letivo }) {
  return { id, nome, etapa, anoLetivo: ano_letivo };
}

/**
 * Chave de comparação de um texto (RN18): NFC, sem espaços nas pontas e em
 * minúsculas.
 * @param {string} texto
 */
export function chaveTextoTurma(texto) {
  return texto.normalize('NFC').trim().toLowerCase();
}

/**
 * Chave do trio (nome, etapa, ano letivo) usada na checagem da RN18.
 * @param {{ nome: string, etapa: string, anoLetivo: number }} turma
 */
export function chaveTurma({ nome, etapa, anoLetivo }) {
  return JSON.stringify([chaveTextoTurma(nome), chaveTextoTurma(etapa), anoLetivo]);
}

function validarTexto(valor, maximo, mensagemObrigatorio, mensagemLongo) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroHttp(400, mensagemObrigatorio);
  }
  const limpo = valor.normalize('NFC').trim();
  if (limpo.length > maximo) {
    throw new ErroHttp(400, mensagemLongo);
  }
  return limpo;
}

/**
 * Valida e normaliza o corpo do POST e do PUT /turmas ({ nome, etapa, anoLetivo }).
 * Os três campos são obrigatórios nas duas operações (Seção 12). Outros campos
 * (id etc.) são ignorados.
 * - nome e etapa: texto não vazio após trim; gravados sem espaços nas pontas.
 * - anoLetivo: número inteiro de 4 dígitos (1000 a 9999). Texto (ex.: "2026")
 *   não é aceito.
 * @param {unknown} corpo
 * @returns {{ nome: string, etapa: string, anoLetivo: number }}
 * @throws {ErroHttp} 400
 */
export function validarTurma(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_TURMA_INVALIDO);
  }

  const { nome, etapa, anoLetivo } = corpo;

  const nomeLimpo = validarTexto(
    nome,
    TAMANHO_MAXIMO_NOME_TURMA,
    MENSAGEM_NOME_TURMA_OBRIGATORIO,
    MENSAGEM_NOME_TURMA_LONGO,
  );
  const etapaLimpa = validarTexto(
    etapa,
    TAMANHO_MAXIMO_ETAPA_TURMA,
    MENSAGEM_ETAPA_TURMA_OBRIGATORIA,
    MENSAGEM_ETAPA_TURMA_LONGA,
  );

  if (
    !Number.isInteger(anoLetivo) ||
    anoLetivo < MENOR_ANO_LETIVO ||
    anoLetivo > MAIOR_ANO_LETIVO
  ) {
    throw new ErroHttp(400, MENSAGEM_ANO_LETIVO_INVALIDO);
  }

  return { nome: nomeLimpo, etapa: etapaLimpa, anoLetivo };
}

/**
 * Converte o id da URL. Aceita apenas inteiro positivo em notação decimal
 * simples, dentro do limite do Int do banco.
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function validarIdTurma(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) {
    throw new ErroHttp(400, MENSAGEM_ID_TURMA_INVALIDO);
  }
  const id = Number(valor);
  if (id > MAIOR_ID) {
    throw new ErroHttp(400, MENSAGEM_ID_TURMA_INVALIDO);
  }
  return id;
}

/**
 * RN18: recusa (409) se outra turma já usa o mesmo trio. Só as turmas do mesmo
 * ano letivo são lidas; a comparação dos textos é feita aqui (trim + NFC +
 * minúsculas dos dois lados), o que também cobre registros gravados fora da
 * API com espaços nas pontas.
 * @param {object} tx client da transação
 * @param {{ nome: string, etapa: string, anoLetivo: number }} dados
 * @param {number} [idIgnorado] id da própria turma (edição)
 */
async function garantirTurmaDisponivel(tx, dados, idIgnorado) {
  const chave = chaveTurma(dados);
  const doMesmoAno = await tx.turma.findMany({
    where: { ano_letivo: dados.anoLetivo },
    select: SELECAO_TURMA,
  });
  const duplicada = doMesmoAno.some(
    (turma) =>
      turma.id !== idIgnorado &&
      chaveTurma({ nome: turma.nome, etapa: turma.etapa, anoLetivo: turma.ano_letivo }) === chave,
  );
  if (duplicada) {
    throw new ErroHttp(409, MENSAGEM_TURMA_DUPLICADA);
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
        throw new ErroHttp(409, MENSAGEM_CONFLITO_CONCORRENTE_TURMA);
      }
      throw erro;
    }
  }
}

/**
 * Lista todas as turmas: ano letivo mais recente primeiro, depois etapa, nome
 * e id (ordem estável).
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<Array<{ id: number, nome: string, etapa: string, anoLetivo: number }>>}
 */
export async function listarTurmas({ db = prisma } = {}) {
  const turmas = await db.turma.findMany({
    select: SELECAO_TURMA,
    orderBy: [{ ano_letivo: 'desc' }, { etapa: 'asc' }, { nome: 'asc' }, { id: 'asc' }],
  });
  return turmas.map(paraRespostaTurma);
}

/**
 * Cadastra uma turma (RF15, RN18) e registra a auditoria (RNF04).
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, etapa: string, anoLetivo: number }>}
 * @throws {ErroHttp} 400 (dados inválidos) ou 409 (duplicada / conflito)
 */
export async function criarTurma(corpo, solicitante, { db = prisma } = {}) {
  const dados = validarTurma(corpo);

  return emTransacaoSerializavel(db, async (tx) => {
    await garantirTurmaDisponivel(tx, dados);
    const turma = await tx.turma.create({
      data: { nome: dados.nome, etapa: dados.etapa, ano_letivo: dados.anoLetivo },
      select: SELECAO_TURMA,
    });
    await registrarAuditoria(
      {
        usuarioId: solicitante?.id ?? null,
        acao: ACOES_AUDITORIA.TURMA_CRIADA,
        recurso: recursoAuditoria(RECURSO_TURMAS, turma.id),
      },
      tx,
    );
    return paraRespostaTurma(turma);
  });
}

/**
 * Edita nome, etapa e ano letivo de uma turma (RF15, RN18) e registra a
 * auditoria (RNF04). Manter o próprio trio (inclusive com outra caixa) não é
 * duplicidade.
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, etapa: string, anoLetivo: number }>}
 * @throws {ErroHttp} 400 (id/dados inválidos), 404 (inexistente) ou 409 (duplicada / conflito)
 */
export async function atualizarTurma(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdTurma(idUrl);
  const dados = validarTurma(corpo);

  try {
    return await editarEmTransacao(db, id, dados, solicitante);
  } catch (erro) {
    // Registro inexistente no update (ex.: removido direto no banco).
    if (erro?.code === 'P2025') throw new ErroHttp(404, MENSAGEM_TURMA_NAO_ENCONTRADA);
    throw erro;
  }
}

function editarEmTransacao(db, id, dados, solicitante) {
  return emTransacaoSerializavel(db, async (tx) => {
    const atual = await tx.turma.findUnique({ where: { id }, select: { id: true } });
    if (!atual) {
      throw new ErroHttp(404, MENSAGEM_TURMA_NAO_ENCONTRADA);
    }
    await garantirTurmaDisponivel(tx, dados, id);
    const turma = await tx.turma.update({
      where: { id },
      data: { nome: dados.nome, etapa: dados.etapa, ano_letivo: dados.anoLetivo },
      select: SELECAO_TURMA,
    });
    await registrarAuditoria(
      {
        usuarioId: solicitante?.id ?? null,
        acao: ACOES_AUDITORIA.TURMA_EDITADA,
        recurso: recursoAuditoria(RECURSO_TURMAS, turma.id),
      },
      tx,
    );
    return paraRespostaTurma(turma);
  });
}
