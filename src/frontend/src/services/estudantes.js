// Chamadas à API de estudantes (RF15, RF16 — SSD, Seção 12).
// A tela de estudantes é só da Gestão, que recebe os dados completos (RN20).
// Cadastrar e editar só Gestão; a proteção real é do back-end (403).
// Não há exclusão de estudante (RN21).
// As chamadas são autenticadas: um 401 cai no tratamento central de sessão.
import { requisicaoAutenticada } from './auth.js';

/**
 * Lista os estudantes (GET /estudantes[?turmaId=]), já ordenados por nome.
 * @param {{ turmaId?: number | string | null }} [filtro] - sem turmaId: todas as turmas
 * @returns {Promise<Array<{ id: number, nomeCompleto: string, codigoEscolar: string | null,
 *   turma: { id: number, nome: string, etapa: string, anoLetivo: number },
 *   tutor: { id: number, nome: string, email: string, status: string } | null }>>}
 */
export async function listarEstudantes({ turmaId } = {}) {
  const temFiltro = turmaId !== undefined && turmaId !== null && turmaId !== '';
  const caminho = temFiltro
    ? `/estudantes?turmaId=${encodeURIComponent(turmaId)}`
    : '/estudantes';
  const dados = await requisicaoAutenticada(caminho);
  return Array.isArray(dados) ? dados : [];
}

/**
 * Monta o corpo do POST/PUT sempre com os quatro campos. No PUT, codigoEscolar
 * e tutorId omitidos MANTÊM o valor atual no back-end; por isso a tela envia
 * os dois explicitamente (null = sem código / sem tutor).
 */
function corpoEstudante({ nomeCompleto, codigoEscolar, turmaId, tutorId }) {
  return {
    nomeCompleto,
    codigoEscolar: codigoEscolar ?? null,
    turmaId,
    tutorId: tutorId ?? null,
  };
}

/**
 * Cadastra um estudante (POST /estudantes — RF15, RF16, RN13, RN18).
 * @param {{ nomeCompleto: string, codigoEscolar: string | null, turmaId: number, tutorId: number | null }} dados
 */
export function criarEstudante(dados) {
  return requisicaoAutenticada('/estudantes', {
    metodo: 'POST',
    corpo: corpoEstudante(dados),
  });
}

/**
 * Edita um estudante (PUT /estudantes/{id} — RF15, RF16, RN13, RN14, RN18).
 * `tutorId: null` desvincula o tutor; `codigoEscolar: null` limpa o código.
 * @param {number} id
 * @param {{ nomeCompleto: string, codigoEscolar: string | null, turmaId: number, tutorId: number | null }} dados
 */
export function atualizarEstudante(id, dados) {
  return requisicaoAutenticada(`/estudantes/${encodeURIComponent(id)}`, {
    metodo: 'PUT',
    corpo: corpoEstudante(dados),
  });
}
