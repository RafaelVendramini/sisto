// Chamadas à API de ocorrências (UC01, RF05, RF06 — SSD, Seção 12).
// Registrar ocorrência é permitido aos 5 perfis; o profissional responsável é
// sempre o usuário logado (RN02), definido pelo back-end, nunca pelo corpo.
// As chamadas são autenticadas: um 401 cai no tratamento central de sessão.
import { requisicaoAutenticada } from './auth.js';

/**
 * Registra uma ocorrência com os estudantes e o encaminhamento inicial
 * (POST /ocorrencias — UC01, RN02, RN03, RN14, RN17). Envia só os campos do
 * contrato; a validação definitiva é do back-end (400).
 * @param {{ dataHora: string, local: string, turmaId: number, categoriaId: number,
 *   descricao: string, estudanteIds: number[], demaisEnvolvidos: string | null,
 *   testemunhas: string | null, providenciasImediatas: string | null,
 *   observacoes: string | null,
 *   encaminhamentos: Array<{ destinatarioPerfil: string, destinatarioUsuarioId: number | null,
 *     observacao: string | null }> }} dados - dataHora em ISO 8601 com fuso
 * @returns {Promise<{ id: number, status: string }>} ocorrência criada (201)
 */
export function registrarOcorrencia({
  dataHora,
  local,
  turmaId,
  categoriaId,
  descricao,
  estudanteIds,
  demaisEnvolvidos,
  testemunhas,
  providenciasImediatas,
  observacoes,
  encaminhamentos,
}) {
  return requisicaoAutenticada('/ocorrencias', {
    metodo: 'POST',
    corpo: {
      dataHora,
      local,
      turmaId,
      categoriaId,
      descricao,
      estudanteIds,
      demaisEnvolvidos: demaisEnvolvidos ?? null,
      testemunhas: testemunhas ?? null,
      providenciasImediatas: providenciasImediatas ?? null,
      observacoes: observacoes ?? null,
      encaminhamentos: encaminhamentos.map(({ destinatarioPerfil, destinatarioUsuarioId, observacao }) => ({
        destinatarioPerfil,
        destinatarioUsuarioId: destinatarioUsuarioId ?? null,
        observacao: observacao ?? null,
      })),
    },
  });
}

/**
 * Lista as ocorrências que o usuário pode ver (GET /ocorrencias — UC03, RN19).
 * A visibilidade é decidida pelo back-end; a lista já vem resumida e ordenada
 * da mais recente para a mais antiga. Sem filtros nesta versão (Sprint 3).
 * @returns {Promise<Array<{ id: number, dataHora: string, local: string, status: string,
 *   turma: { id: number, nome: string, etapa: string, anoLetivo: number },
 *   categoria: { id: number, nome: string },
 *   profissionalResponsavel: { id: number, nome: string },
 *   estudantes: Array<{ id: number, nomeCompleto: string }> }>>}
 */
export async function listarOcorrencias() {
  const dados = await requisicaoAutenticada('/ocorrencias');
  return Array.isArray(dados) ? dados : [];
}

/**
 * Consulta o detalhe de uma ocorrência (GET /ocorrencias/{id} — RF05, RN19,
 * RN20). Fora da visibilidade do usuário ou inexistente: 404; id inválido: 400.
 * O código escolar dos estudantes só vem para a Gestão (RN20).
 * @param {number | string} id - como veio da URL
 * @returns {Promise<object>} detalhe com estudantes, encaminhamentos,
 *   comunicações e providências
 */
export function obterOcorrencia(id) {
  return requisicaoAutenticada(`/ocorrencias/${encodeURIComponent(String(id))}`);
}
