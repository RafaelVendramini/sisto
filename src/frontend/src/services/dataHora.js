// Data e hora no horário de São Paulo (RN17): exibição em formato brasileiro,
// sugestão do campo datetime-local e conversão para o envio à API. Separado
// de mensagensOcorrencias.js (#129), que continua reexportando tudo daqui.

/** RN17: as datas são exibidas no horário de São Paulo. */
export const FUSO_ESCOLA = 'America/Sao_Paulo';

const formatadorFuso = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_ESCOLA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Partes da data/hora de um instante, como aparecem no relógio de São Paulo. */
function partesNoFuso(instanteMs) {
  const partes = {};
  for (const { type, value } of formatadorFuso.formatToParts(new Date(instanteMs))) {
    partes[type] = value;
  }
  return partes;
}

/** Instante (ms, UTC) de uma data/hora "de parede", como se estivesse em UTC. */
function paredeComoUtc(ano, mes, dia, hora, minuto, segundo) {
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia);
  data.setUTCHours(hora, minuto, segundo, 0);
  return data.getTime();
}

/** Deslocamento de São Paulo em relação ao UTC, em minutos (ex.: -180), no instante dado. */
function deslocamentoMinutos(instanteMs) {
  const p = partesNoFuso(instanteMs);
  const parede = paredeComoUtc(
    Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second),
  );
  const instanteEmSegundos = Math.floor(instanteMs / 1000) * 1000;
  return Math.round((parede - instanteEmSegundos) / 60000);
}

/**
 * Data e hora de um instante (ISO vindo da API, em UTC) no horário de São
 * Paulo, em formato brasileiro legível (RN17, RNF02).
 * @param {string | number | Date} valor - ex.: "2026-10-30T12:39:00.000Z"
 * @returns {string} ex.: "30/10/2026 às 09:39" (vazio quando ausente ou inválido)
 */
export function formatarDataHora(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  const instanteMs = new Date(valor).getTime();
  if (Number.isNaN(instanteMs)) return '';
  const p = partesNoFuso(instanteMs);
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

/**
 * Data e hora de agora no horário de São Paulo, no formato do campo
 * datetime-local ("2026-10-30T08:00"). Usada como sugestão no formulário.
 */
export function agoraNoFusoDaEscola(agoraMs = Date.now()) {
  const p = partesNoFuso(agoraMs);
  return `${p.year.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const REGEX_DATA_HORA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

function doisDigitos(numero) {
  return String(numero).padStart(2, '0');
}

/**
 * Converte o valor do campo datetime-local (horário de São Paulo) em ISO 8601
 * com o deslocamento correto daquele momento, calculado pelo Intl (não fixo).
 * @param {string} valor - ex.: "2026-10-30T08:00"
 * @returns {{ iso: string, instanteMs: number } | null} null quando vazio ou inválido
 *   (ex.: { iso: "2026-10-30T08:00:00-03:00", instanteMs: ... })
 */
export function dataHoraParaEnvio(valor) {
  const partes = REGEX_DATA_HORA_LOCAL.exec(String(valor ?? ''));
  if (!partes) return null;
  const [, ano, mes, dia, hora, minuto, segundo = '00'] = partes;
  const parede = paredeComoUtc(
    Number(ano), Number(mes), Number(dia), Number(hora), Number(minuto), Number(segundo),
  );
  if (Number.isNaN(parede)) return null;

  // Duas passadas: o deslocamento é o do instante resultante (vale também se
  // um dia voltar o horário de verão).
  let deslocamento = deslocamentoMinutos(parede);
  deslocamento = deslocamentoMinutos(parede - deslocamento * 60000);
  const instanteMs = parede - deslocamento * 60000;
  if (Number.isNaN(instanteMs)) return null;

  const sinal = deslocamento < 0 ? '-' : '+';
  const absoluto = Math.abs(deslocamento);
  const fuso = `${sinal}${doisDigitos(Math.floor(absoluto / 60))}:${doisDigitos(absoluto % 60)}`;
  return { iso: `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${fuso}`, instanteMs };
}
