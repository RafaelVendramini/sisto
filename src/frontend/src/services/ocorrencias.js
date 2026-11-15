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

/** Tamanho fixo da página da lista (SSD, Seção 12 — Issue #86). */
export const TAMANHO_PAGINA_OCORRENCIAS = 20;

// Parâmetros aceitos pelo GET /ocorrencias (Issue #86), na ordem em que vão
// para a query string.
const PARAMETROS_LISTA = Object.freeze([
  'turmaId',
  'categoriaId',
  'status',
  'estudanteId',
  'dataInicio',
  'dataFim',
  'profissionalResponsavelId',
]);

/**
 * Monta a query string do GET /ocorrencias. A API recusa parâmetro vazio
 * (400): filtros não preenchidos ficam FORA da query. A página 1 também é
 * omitida (é o padrão da API).
 * @returns {string} ex.: '?turmaId=1&pagina=2' ou '' sem nada
 */
export function montarQueryListaOcorrencias(filtros = {}) {
  const params = new URLSearchParams();
  for (const nome of PARAMETROS_LISTA) {
    const valor = filtros[nome];
    if (valor === undefined || valor === null) continue;
    const texto = String(valor).trim();
    if (texto) params.set(nome, texto);
  }
  const pagina = Number(filtros.pagina);
  if (Number.isInteger(pagina) && pagina > 1) params.set('pagina', String(pagina));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Lista uma página das ocorrências que o usuário pode ver (GET /ocorrencias —
 * UC03, RF11, RN19). A visibilidade é decidida pelo back-end: os filtros
 * nunca ampliam o que o perfil vê. A lista vem resumida, da mais recente para
 * a mais antiga, 20 por página (Issue #86).
 * @param {{ turmaId?: number | string, categoriaId?: number | string, status?: string,
 *   estudanteId?: number | string, dataInicio?: string, dataFim?: string,
 *   profissionalResponsavelId?: number | string, pagina?: number }} [filtros]
 *   ids inteiros, status com o valor técnico e datas AAAA-MM-DD; vazios são omitidos
 * @returns {Promise<{ itens: Array<{ id: number, dataHora: string, local: string, status: string,
 *   turma: { id: number, nome: string, etapa: string, anoLetivo: number },
 *   categoria: { id: number, nome: string },
 *   profissionalResponsavel: { id: number, nome: string },
 *   estudantes: Array<{ id: number, nomeCompleto: string }> }>,
 *   total: number, pagina: number, tamanhoPagina: number }>}
 */
export async function listarOcorrencias(filtros = {}) {
  const dados = await requisicaoAutenticada(`/ocorrencias${montarQueryListaOcorrencias(filtros)}`);
  // Resposta fora do formato paginado não quebra a tela: vira lista vazia.
  const itens = Array.isArray(dados?.itens) ? dados.itens : [];
  const inteiro = (valor, padrao) => (Number.isInteger(valor) && valor >= 0 ? valor : padrao);
  const paginaPedida = Number(filtros.pagina) > 1 ? Number(filtros.pagina) : 1;
  return {
    itens,
    total: inteiro(dados?.total, itens.length),
    pagina: inteiro(dados?.pagina, paginaPedida) || paginaPedida,
    tamanhoPagina: inteiro(dados?.tamanhoPagina, TAMANHO_PAGINA_OCORRENCIAS) || TAMANHO_PAGINA_OCORRENCIAS,
  };
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

/**
 * Registra um encaminhamento numa ocorrência já registrada
 * (POST /ocorrencias/{id}/encaminhamentos — UC02, RF08, RN03, RN15). Só Gestão
 * e Pedagógico (403 para os demais). Envia só os campos do contrato;
 * `responsavelAcompanhamentoId` só vai no corpo quando informado (ausente =
 * mantém o responsável atual numa ocorrência "Em acompanhamento").
 * @param {number | string} id
 * @param {{ destinatarioPerfil: string, destinatarioUsuarioId?: number | null,
 *   observacao?: string | null, responsavelAcompanhamentoId?: number | null }} dados
 * @returns {Promise<object>} detalhe completo da ocorrência (201), no formato do GET /ocorrencias/{id}
 */
export function encaminharOcorrencia(
  id,
  { destinatarioPerfil, destinatarioUsuarioId, observacao, responsavelAcompanhamentoId },
) {
  const corpo = {
    destinatarioPerfil,
    destinatarioUsuarioId: destinatarioUsuarioId ?? null,
    observacao: observacao ?? null,
  };
  if (responsavelAcompanhamentoId !== undefined && responsavelAcompanhamentoId !== null) {
    corpo.responsavelAcompanhamentoId = responsavelAcompanhamentoId;
  }
  return requisicaoAutenticada(`/ocorrencias/${encodeURIComponent(String(id))}/encaminhamentos`, {
    metodo: 'POST',
    corpo,
  });
}

/**
 * Registra uma comunicação feita fora do sistema numa ocorrência
 * (POST /ocorrencias/{id}/comunicacoes — RF09, RN16, RN17). Só Tutor, Gestão e
 * Pedagógico (403 para os demais); ocorrência encerrada: 409. O sistema não
 * envia notificações: só registra o contato. Envia só os campos do contrato;
 * a normalização (trim) e a validação definitiva são do back-end (400).
 * @param {number | string} id
 * @param {{ destinatario: string, meio: string, descricao: string,
 *   dataHora: string }} dados - dataHora em ISO 8601 com fuso
 * @returns {Promise<object>} detalhe completo da ocorrência (201), no formato do GET /ocorrencias/{id}
 */
export function registrarComunicacao(id, { destinatario, meio, descricao, dataHora }) {
  return requisicaoAutenticada(`/ocorrencias/${encodeURIComponent(String(id))}/comunicacoes`, {
    metodo: 'POST',
    corpo: { destinatario, meio, descricao, dataHora },
  });
}

/**
 * Registra uma providência adotada numa ocorrência em acompanhamento
 * (POST /ocorrencias/{id}/providencias — UC04, RF12, RN04, RN22). Gestão,
 * Pedagógico e o responsável pelo acompanhamento (403 para os demais);
 * ocorrência "Aberto" ou "Encerrado": 409. Envia só o campo do contrato; a
 * normalização (trim) e a validação definitiva são do back-end (400).
 * @param {number | string} id
 * @param {{ descricao: string }} dados
 * @returns {Promise<object>} detalhe completo da ocorrência (201), no formato do GET /ocorrencias/{id}
 */
export function registrarProvidencia(id, { descricao }) {
  return requisicaoAutenticada(`/ocorrencias/${encodeURIComponent(String(id))}/providencias`, {
    metodo: 'POST',
    corpo: { descricao },
  });
}

/**
 * Encerra a ocorrência (PATCH /ocorrencias/{id}/status — UC04, RF10, RN04,
 * RN22). Aceita somente `ENCERRADO`, sem justificativa; sem providência
 * registrada ou fora de "Em acompanhamento": 409.
 * @param {number | string} id
 * @returns {Promise<object>} detalhe completo da ocorrência (200), já com
 *   `status: "ENCERRADO"` e `dataEncerramento`
 */
export function encerrarOcorrencia(id) {
  return requisicaoAutenticada(`/ocorrencias/${encodeURIComponent(String(id))}/status`, {
    metodo: 'PATCH',
    corpo: { status: 'ENCERRADO' },
  });
}

/**
 * Histórico de alterações de uma ocorrência (GET /ocorrencias/{id}/historico —
 * RF12, RN08, RN19). Os 5 perfis, limitados à visibilidade: inexistente ou
 * fora da visibilidade respondem 404, como o detalhe; id inválido: 400.
 * @param {number | string} id - como veio da URL
 * @returns {Promise<Array<{ id: number, acao: string, descricao: string | null,
 *   dataHora: string, usuario: { id: number, nome: string } }>>} do mais antigo
 *   para o mais novo, na ordem da API
 */
export async function listarHistoricoOcorrencia(id) {
  const dados = await requisicaoAutenticada(
    `/ocorrencias/${encodeURIComponent(String(id))}/historico`,
  );
  return Array.isArray(dados) ? dados : [];
}
