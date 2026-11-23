// Turmas do ano letivo atual (SSD 1.13, Seção 10 — Front-end; Issue #134).
// No registro de ocorrência e na tela de estudantes, as listas de turmas
// mostram, por padrão, só as do ano letivo atual e dos anos seguintes, com a
// opção de ver também as dos anos anteriores. O filtro é só no front-end: o
// GET /turmas não muda e continua devolvendo todas as turmas.
import { agoraNoFusoDaEscola } from './mensagensOcorrencias.js';

/**
 * Ano de hoje no horário de São Paulo (RN17), e não no fuso do aparelho.
 * Ex.: 31/12/2026 às 22h em São Paulo (01/01/2027 01h UTC) ainda é 2026.
 * @param {number} [agoraMs] - instante (ms, UTC); padrão: agora
 * @returns {number}
 */
export function anoLetivoAtual(agoraMs = Date.now()) {
  return Number(agoraNoFusoDaEscola(agoraMs).slice(0, 4));
}

/**
 * Turmas que aparecem na lista de opções.
 *
 * Sem `mostrarAnteriores`, ficam só as turmas do ano atual em diante. As
 * turmas de `idsMantidos` (ex.: a turma já selecionada no formulário, ou a
 * turma atual do estudante em edição) continuam na lista mesmo que sejam de um
 * ano anterior, para não sumirem do campo nem perderem a seleção.
 *
 * @param {Array<{ id: number, anoLetivo: number }>} turmas - de GET /turmas (a ordem é mantida)
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.mostrarAnteriores=false]
 * @param {Array<string | number | null | undefined>} [opcoes.idsMantidos=[]]
 * @param {number} [opcoes.anoAtual] - padrão: anoLetivoAtual()
 * @returns {Array<object>}
 */
export function filtrarTurmasPorAnoLetivo(
  turmas,
  { mostrarAnteriores = false, idsMantidos = [], anoAtual = anoLetivoAtual() } = {},
) {
  const lista = Array.isArray(turmas) ? turmas : [];
  if (mostrarAnteriores) return lista;
  const mantidos = new Set(
    idsMantidos.filter((id) => id !== undefined && id !== null && id !== '').map(String),
  );
  return lista.filter(
    (turma) => !(Number(turma?.anoLetivo) < anoAtual) || mantidos.has(String(turma?.id)),
  );
}

/** Indica se há ao menos uma turma de ano anterior ao atual. */
export function temTurmasAnteriores(turmas, anoAtual = anoLetivoAtual()) {
  return Array.isArray(turmas) && turmas.some((turma) => Number(turma?.anoLetivo) < anoAtual);
}
