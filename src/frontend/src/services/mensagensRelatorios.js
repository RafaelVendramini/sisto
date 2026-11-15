// Mensagens, validação e formatação da tela de relatórios (UC05, RF13,
// RNF02): nada técnico aparece na tela. Para 400 o texto vem do back-end
// (campo `erro`).
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';

export const MENSAGEM_RELATORIO_VAZIO = 'Nenhuma ocorrência no período.';
const MENSAGEM_GENERICA = 'Não foi possível gerar o relatório agora. Tente novamente em instantes.';

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Indica se o texto é uma data real no formato AAAA-MM-DD. */
function ehDataValida(valor) {
  const partes = FORMATO_DATA.exec(String(valor ?? ''));
  if (!partes) return false;
  const [, ano, mes, dia] = partes.map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
  );
}

/**
 * Valida o período antes do envio: as duas datas são obrigatórias e o início
 * não pode ser posterior ao fim. É só usabilidade: a validação definitiva é a
 * do back-end (400).
 * @param {{ dataInicio: string, dataFim: string }} filtro - datas AAAA-MM-DD
 * @returns {{ dataInicio?: string, dataFim?: string }} mensagens por campo
 */
export function validarFiltroRelatorio({ dataInicio, dataFim }) {
  const erros = {};

  if (!dataInicio) erros.dataInicio = 'Informe a data inicial do período.';
  else if (!ehDataValida(dataInicio)) erros.dataInicio = 'Informe uma data inicial válida.';

  if (!dataFim) erros.dataFim = 'Informe a data final do período.';
  else if (!ehDataValida(dataFim)) erros.dataFim = 'Informe uma data final válida.';

  // AAAA-MM-DD: a comparação de texto segue a ordem das datas.
  if (!erros.dataInicio && !erros.dataFim && dataInicio > dataFim) {
    erros.dataFim = 'A data final não pode ser anterior à data inicial.';
  }

  return erros;
}

/**
 * Converte AAAA-MM-DD em dd/mm/aaaa, sem passar por Date (evita mudança de
 * dia por fuso horário).
 * @param {string} data - ex.: '2026-10-01'
 * @returns {string} ex.: '01/10/2026' (ou o próprio texto se fora do formato)
 */
export function formatarDataRelatorio(data) {
  const partes = FORMATO_DATA.exec(String(data ?? ''));
  if (!partes) return String(data ?? '');
  const [, ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

/**
 * Converte a falha do GET /relatorios em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 * @returns {string}
 */
export function mensagemErroRelatorio(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if (status === 400 && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA;
}
