// Chamadas à API de turmas (RF15 — SSD, Seção 12).
// GET para todos os perfis (RN20); cadastrar e editar só Gestão.
// A proteção real é do back-end (403). Não há exclusão de turma (RN21).
// As chamadas são autenticadas: um 401 cai no tratamento central de sessão.
import { requisicaoAutenticada } from './auth.js';

/**
 * Lista as turmas cadastradas (GET /turmas), já ordenadas por ano letivo
 * (mais recente primeiro), etapa e nome.
 * @returns {Promise<Array<{ id: number, nome: string, etapa: string, anoLetivo: number }>>}
 */
export async function listarTurmas() {
  const dados = await requisicaoAutenticada('/turmas');
  return Array.isArray(dados) ? dados : [];
}

/**
 * Cadastra uma turma (POST /turmas — RF15, RN18).
 * @param {{ nome: string, etapa: string, anoLetivo: number }} dados - anoLetivo como número
 * @returns {Promise<{ id: number, nome: string, etapa: string, anoLetivo: number }>}
 */
export function criarTurma({ nome, etapa, anoLetivo }) {
  return requisicaoAutenticada('/turmas', {
    metodo: 'POST',
    corpo: { nome, etapa, anoLetivo },
  });
}

/**
 * Edita uma turma (PUT /turmas/{id} — RF15, RN18). Os três campos são obrigatórios.
 * @param {number} id
 * @param {{ nome: string, etapa: string, anoLetivo: number }} dados - anoLetivo como número
 * @returns {Promise<{ id: number, nome: string, etapa: string, anoLetivo: number }>}
 */
export function atualizarTurma(id, { nome, etapa, anoLetivo }) {
  return requisicaoAutenticada(`/turmas/${encodeURIComponent(id)}`, {
    metodo: 'PUT',
    corpo: { nome, etapa, anoLetivo },
  });
}
