// Log de auditoria básico (RNF04) — Sisto.
//
// Primeira gravação de LogAuditoria do projeto (Issue #18). Implementação
// mínima, reutilizável pelas próximas Issues:
// - usuario_id: quem executou a ação (opcional na Seção 11);
// - acao: texto curto e fixo que descreve a ação (constantes abaixo);
// - recurso: o alvo da ação no formato "<recurso-da-API>/<id>", ex.: "usuarios/6";
// - data_hora: preenchida pelo banco (@default(now())).
//
// RNF06 / RNF03: nunca grave senha, hash, token ou dados pessoais em `acao`
// ou `recurso` — só textos fixos e identificadores numéricos.
import prisma from '../lib/prisma.js';

/** Ações de auditoria registradas pelo sistema (textos fixos, sem dados pessoais). */
export const ACOES_AUDITORIA = Object.freeze({
  SENHA_REDEFINIDA_PELA_GESTAO: 'senha redefinida pela Gestão',
  SENHA_ALTERADA_PELO_USUARIO: 'senha alterada pelo usuário',
  CATEGORIA_CRIADA: 'categoria criada',
  CATEGORIA_EDITADA: 'categoria editada',
  TURMA_CRIADA: 'turma criada',
  TURMA_EDITADA: 'turma editada',
  ESTUDANTE_CRIADO: 'estudante criado',
  ESTUDANTE_EDITADO: 'estudante editado',
  OCORRENCIA_CRIADA: 'ocorrência criada',
});

/**
 * Monta o identificador do recurso auditado.
 * @param {string} tipo nome do recurso na API (ex.: "usuarios")
 * @param {number} id
 */
export function recursoAuditoria(tipo, id) {
  return `${tipo}/${id}`;
}

/**
 * Grava um registro de auditoria. Aceita o client de uma transação para que
 * o log seja gravado junto com a alteração auditada (tudo ou nada).
 * @param {{ usuarioId: number | null, acao: string, recurso: string }} dados
 * @param {object} [db] client Prisma ou client da transação
 */
export async function registrarAuditoria({ usuarioId, acao, recurso }, db = prisma) {
  await db.logAuditoria.create({
    data: { usuario_id: usuarioId ?? null, acao, recurso },
    select: { id: true },
  });
}
