// Regra de período compartilhada — Sisto (Issues #86 e #88, Seção 12 do SSD).
//
// `dataInicio` e `dataFim` chegam pela query no formato AAAA-MM-DD e valem
// como DIAS INTEIROS no fuso de São Paulo (`America/Sao_Paulo` — RN17), com as
// duas pontas incluídas: o intervalo vai de 00:00:00.000 de `dataInicio` a
// 23:59:59.999 de `dataFim`, horário de São Paulo, convertidos para UTC (as
// datas são gravadas em UTC — RN17). Ex.: 23h30 de 10/10 em São Paulo é
// 02h30 UTC de 11/10 e entra no dia 10/10.
//
// O fuso é calculado com Intl (sem dependência nova), consultando o
// deslocamento real de cada instante; assim a regra continua certa se o
// horário de verão voltar a existir (o início do dia é o primeiro instante
// daquele dia em São Paulo, e o fim é o instante anterior ao início do dia
// seguinte).
//
// Anos aceitos: 0001 a 9999 (faixa técnica da Seção 11).
import { ErroHttp } from '../lib/erros.js';

export const FUSO_PERIODO = 'America/Sao_Paulo';

/** Mensagens dos 400 da regra de período. */
export const MENSAGENS_PERIODO = Object.freeze({
  dataInicioObrigatoria: 'Informe dataInicio no formato AAAA-MM-DD.',
  dataFimObrigatoria: 'Informe dataFim no formato AAAA-MM-DD.',
  dataInicioInvalida: 'Informe dataInicio como uma data válida no formato AAAA-MM-DD.',
  dataFimInvalida: 'Informe dataFim como uma data válida no formato AAAA-MM-DD.',
  intervaloInvalido: 'A dataInicio não pode ser posterior à dataFim.',
});

const REGEX_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const UM_DIA_MS = 24 * 60 * 60 * 1000;

// Maior instante gravável (fim do ano 9999 em UTC — faixa técnica da Seção
// 11). O fim de 31/12/9999 em São Paulo cai no ano 10000 em UTC, que nem
// todo serializador de data aceita; limitar a este valor não muda o
// resultado, porque nenhuma data gravada passa dele.
const MAIOR_INSTANTE_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const FORMATADOR_SP = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_PERIODO,
  hourCycle: 'h23',
  era: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Milissegundos UTC de uma data/hora "de parede" (aceita anos < 100). */
function paredeMs(ano, mes, dia, hora = 0, minuto = 0, segundo = 0) {
  const data = new Date(Date.UTC(2000, 0, 1, hora, minuto, segundo));
  data.setUTCFullYear(ano, mes - 1, dia);
  return data.getTime();
}

/** Data/hora de parede em São Paulo (em ms "como se fosse UTC") de um instante, sem os ms. */
function paredeEmSaoPaulo(instanteMs) {
  const partes = Object.fromEntries(
    FORMATADOR_SP.formatToParts(new Date(instanteMs)).map(({ type, value }) => [type, value]),
  );
  const anoEra = Number(partes.year);
  const ano = partes.era === 'BC' || partes.era === 'B' ? 1 - anoEra : anoEra;
  return paredeMs(
    ano,
    Number(partes.month),
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
}

/** Deslocamento (ms) de São Paulo em relação ao UTC no instante dado (ex.: -3h). */
function deslocamentoSaoPaulo(instanteMs) {
  const semMs = instanteMs - (((instanteMs % 1000) + 1000) % 1000);
  return paredeEmSaoPaulo(semMs) - semMs;
}

/**
 * Primeiro instante (UTC, ms) do dia informado em São Paulo. Testa os
 * deslocamentos de um dia antes e de um dia depois (cobre uma eventual troca
 * de horário naquele dia): fica com o menor candidato cuja hora em São Paulo
 * seja 00:00:00; se a meia-noite não existir (início do horário de verão),
 * o dia começa no instante da troca.
 */
function inicioDoDiaEmSaoPaulo(ano, mes, dia) {
  const parede = paredeMs(ano, mes, dia);
  const antes = parede - deslocamentoSaoPaulo(parede - UM_DIA_MS);
  const depois = parede - deslocamentoSaoPaulo(parede + UM_DIA_MS);
  const validos = [antes, depois].filter((c) => paredeEmSaoPaulo(c) === parede);
  return validos.length > 0 ? Math.min(...validos) : antes;
}

/**
 * Valida uma data AAAA-MM-DD (formato e existência) e devolve as partes.
 * @returns {{ ano: number, mes: number, dia: number } | null} null se inválida
 */
function lerData(valor) {
  if (typeof valor !== 'string') return null;
  const partes = REGEX_DATA.exec(valor);
  if (!partes) return null;
  const [ano, mes, dia] = partes.slice(1).map(Number);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return null;
  const ultimoDia = new Date(paredeMs(ano, mes + 1, 0)).getUTCDate();
  if (dia > ultimoDia) return null;
  return { ano, mes, dia };
}

const ausente = (valor) => valor === undefined || valor === null;

/**
 * Interpreta o período (`dataInicio`/`dataFim`, AAAA-MM-DD, dias inteiros em
 * São Paulo, pontas incluídas).
 *
 * Ausente = `undefined`/`null` (parâmetro não enviado). Qualquer outro valor
 * precisa ser uma data válida: vazio, repetido na query (array), fora do
 * formato ou inexistente (ex.: 2026-02-30) responde 400.
 *
 * @param {{ dataInicio?: unknown, dataFim?: unknown }} parametros normalmente req.query
 * @param {{ obrigatorio?: boolean }} [opcoes] obrigatorio: as duas datas são exigidas
 * @returns {{ inicio: Date | null, fim: Date | null }} limites em UTC
 *   (inicio = 00:00:00.000 de dataInicio e fim = 23:59:59.999 de dataFim, em São Paulo);
 *   null na ponta ausente (só quando não é obrigatório)
 * @throws {ErroHttp} 400 com uma das MENSAGENS_PERIODO
 */
export function interpretarPeriodo({ dataInicio, dataFim } = {}, { obrigatorio = false } = {}) {
  let inicio = null;
  let fim = null;
  let dataInicioLida = null;
  let dataFimLida = null;

  if (ausente(dataInicio)) {
    if (obrigatorio) throw new ErroHttp(400, MENSAGENS_PERIODO.dataInicioObrigatoria);
  } else {
    dataInicioLida = lerData(dataInicio);
    if (!dataInicioLida) throw new ErroHttp(400, MENSAGENS_PERIODO.dataInicioInvalida);
  }

  if (ausente(dataFim)) {
    if (obrigatorio) throw new ErroHttp(400, MENSAGENS_PERIODO.dataFimObrigatoria);
  } else {
    dataFimLida = lerData(dataFim);
    if (!dataFimLida) throw new ErroHttp(400, MENSAGENS_PERIODO.dataFimInvalida);
  }

  // Mesmo formato fixo: a comparação de texto equivale à de datas.
  if (dataInicioLida && dataFimLida && dataInicio > dataFim) {
    throw new ErroHttp(400, MENSAGENS_PERIODO.intervaloInvalido);
  }

  if (dataInicioLida) {
    const { ano, mes, dia } = dataInicioLida;
    inicio = new Date(inicioDoDiaEmSaoPaulo(ano, mes, dia));
  }
  if (dataFimLida) {
    const { ano, mes, dia } = dataFimLida;
    // Fim do dia = instante anterior ao início do dia seguinte (paredeMs
    // normaliza o dia 32, 13º mês etc.).
    const seguinte = new Date(paredeMs(ano, mes, dia + 1));
    const fimMs =
      inicioDoDiaEmSaoPaulo(seguinte.getUTCFullYear(), seguinte.getUTCMonth() + 1, seguinte.getUTCDate()) - 1;
    fim = new Date(Math.min(fimMs, MAIOR_INSTANTE_MS));
  }

  return { inicio, fim };
}
