// Filtros e paginação da lista de ocorrências na URL (RF11, UC03 — Issue #87).
// Os filtros aplicados ficam na query string da página (/ocorrencias?...), para
// que voltar do detalhe preserve a busca. Os nomes são os mesmos parâmetros do
// GET /ocorrencias (Issue #86), mais `turmaEstudanteId`, que é só da tela: a
// turma usada para escolher o estudante (não vai para a API).
// Valores inválidos na URL (editada à mão) são ignorados aqui, antes do envio:
// a API recusaria com 400.
import { STATUS_OCORRENCIA } from './mensagensOcorrencias.js';

/** Maior id aceito pela API (Int do PostgreSQL). */
const MAIOR_ID = 2147483647;

/** Filtros vazios: todos os valores são texto, como nos campos do formulário. */
export const FILTROS_VAZIOS = Object.freeze({
  turmaId: '',
  categoriaId: '',
  status: '',
  turmaEstudanteId: '',
  estudanteId: '',
  dataInicio: '',
  dataFim: '',
  profissionalResponsavelId: '',
});

// Ordem dos parâmetros na URL da página.
const CAMPOS = Object.freeze(Object.keys(FILTROS_VAZIOS));

const CAMPOS_ID = Object.freeze([
  'turmaId',
  'categoriaId',
  'turmaEstudanteId',
  'estudanteId',
  'profissionalResponsavelId',
]);

/** Campos que filtram a lista (a turma do estudante é só auxiliar). */
const CAMPOS_FILTRO = Object.freeze(CAMPOS.filter((campo) => campo !== 'turmaEstudanteId'));

/** Id no formato aceito pela API: inteiro positivo, sem sinal nem zeros à esquerda. */
export function idValido(valor) {
  return typeof valor === 'string' && /^[1-9][0-9]{0,9}$/.test(valor) && Number(valor) <= MAIOR_ID;
}

/** Data AAAA-MM-DD que existe no calendário (ex.: 2026-02-30 não existe). */
export function dataValida(valor) {
  if (typeof valor !== 'string') return false;
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return false;
  const [ano, mes, dia] = partes.slice(1).map(Number);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  const ultimoDia = new Date(Date.UTC(2000, mes, 0)).getUTCDate();
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  return dia <= (mes === 2 ? (bissexto ? 29 : 28) : ultimoDia);
}

/**
 * Período com início depois do fim (mesmo formato fixo: comparar o texto
 * equivale a comparar as datas). Uma ponta vazia não é erro.
 */
export function periodoInvalido({ dataInicio, dataFim }) {
  return Boolean(dataInicio && dataFim && dataInicio > dataFim);
}

/**
 * Lê os filtros e a página da query string da tela.
 * @param {URLSearchParams} params
 * @param {{ permitirProfissional?: boolean }} [opcoes] o filtro de
 *   profissional só vale para a Gestão; para os demais perfis é descartado
 * @returns {{ filtros: typeof FILTROS_VAZIOS, pagina: number }}
 */
export function lerBuscaOcorrencias(params, { permitirProfissional = false } = {}) {
  const filtros = { ...FILTROS_VAZIOS };
  for (const campo of CAMPOS) {
    const valor = params.get(campo);
    if (valor === null) continue;
    if (CAMPOS_ID.includes(campo)) {
      if (idValido(valor)) filtros[campo] = valor;
    } else if (campo === 'status') {
      if (STATUS_OCORRENCIA.some((s) => s.valor === valor)) filtros.status = valor;
    } else if (dataValida(valor)) {
      filtros[campo] = valor;
    }
  }
  if (!permitirProfissional) filtros.profissionalResponsavelId = '';
  if (periodoInvalido(filtros)) {
    filtros.dataInicio = '';
    filtros.dataFim = '';
  }
  const textoPagina = params.get('pagina');
  const pagina = idValido(textoPagina ?? '') ? Number(textoPagina) : 1;
  return { filtros, pagina };
}

/**
 * Monta a query string da TELA (filtros preenchidos e página > 1).
 * @returns {URLSearchParams}
 */
export function montarBuscaOcorrencias(filtros, pagina = 1) {
  const params = new URLSearchParams();
  for (const campo of CAMPOS) {
    const valor = filtros?.[campo];
    if (valor) params.set(campo, valor);
  }
  if (pagina > 1) params.set('pagina', String(pagina));
  return params;
}

/** Filtros para o GET /ocorrencias: sem a turma auxiliar e sem os vazios. */
export function filtrosParaApi(filtros) {
  const resultado = {};
  for (const campo of CAMPOS_FILTRO) {
    if (filtros?.[campo]) resultado[campo] = filtros[campo];
  }
  return resultado;
}

/** Quantos filtros estão aplicados (a turma auxiliar não conta). */
export function contarFiltrosAtivos(filtros) {
  return CAMPOS_FILTRO.filter((campo) => Boolean(filtros?.[campo])).length;
}

/** Total de páginas (no mínimo 1). */
export function totalDePaginas(total, tamanhoPagina) {
  if (!total || !tamanhoPagina) return 1;
  return Math.max(1, Math.ceil(total / tamanhoPagina));
}

/** "1 ocorrência encontrada" / "45 ocorrências encontradas". */
export function textoTotalOcorrencias(total) {
  return total === 1 ? '1 ocorrência encontrada' : `${total} ocorrências encontradas`;
}
