// Rótulos das ocorrências na tela (RF05, RF10, RN03, RN08, RNF02): status,
// destinatários, ações do histórico e o texto de campo vazio. Separado de
// mensagensOcorrencias.js (#129), que continua reexportando tudo daqui.

// Destinatários do encaminhamento (Seção 11): valor técnico, rótulo na tela e
// perfil exigido do usuário destinatário (RN03).
export const DESTINATARIOS = Object.freeze([
  Object.freeze({ valor: 'TUTOR', rotulo: 'Tutor', perfilUsuario: 'TUTOR' }),
  Object.freeze({ valor: 'EQUIPE_PEDAGOGICA', rotulo: 'Equipe pedagógica', perfilUsuario: 'PEDAGOGICO' }),
  Object.freeze({ valor: 'GESTAO', rotulo: 'Gestão', perfilUsuario: 'GESTAO' }),
]);

/** Perfil do usuário exigido para o destinatário (ex.: EQUIPE_PEDAGOGICA -> PEDAGOGICO). */
export function perfilDoDestinatario(destinatarioPerfil) {
  return DESTINATARIOS.find((d) => d.valor === destinatarioPerfil)?.perfilUsuario ?? null;
}

/** Rótulo do destinatário na tela (ex.: 'Equipe pedagógica'). */
export function rotuloDestinatario(destinatarioPerfil) {
  return DESTINATARIOS.find((d) => d.valor === destinatarioPerfil)?.rotulo ?? '';
}

// Status da ocorrência (Seção 11, RF10): valor técnico e rótulo na tela.
export const STATUS_OCORRENCIA = Object.freeze([
  Object.freeze({ valor: 'ABERTO', rotulo: 'Aberto' }),
  Object.freeze({ valor: 'EM_ACOMPANHAMENTO', rotulo: 'Em acompanhamento' }),
  Object.freeze({ valor: 'ENCERRADO', rotulo: 'Encerrado' }),
]);

/** Rótulo do status na tela (ex.: 'Em acompanhamento'); vazio se desconhecido. */
export function rotuloStatusOcorrencia(status) {
  return STATUS_OCORRENCIA.find((s) => s.valor === status)?.rotulo ?? '';
}

/** Texto exibido no lugar de um campo opcional vazio. */
export const TEXTO_NAO_INFORMADO = 'Não informado';

/** Encaminhamento à equipe inteira (sem usuário destinatário — RN03). */
export const TEXTO_TODA_A_EQUIPE = 'Toda a equipe';

/** Texto opcional: o próprio texto ou "Não informado" quando vazio. */
export function textoOuNaoInformado(valor) {
  return valor === undefined || valor === null || String(valor).trim() === ''
    ? TEXTO_NAO_INFORMADO
    : valor;
}

/**
 * Ação do histórico como aparece na tela: o texto fixo da API (RN08), com a
 * primeira letra maiúscula (ex.: "Encaminhamento registrado").
 */
export function rotuloAcaoHistorico(acao) {
  const texto = String(acao ?? '').trim();
  return texto ? texto.charAt(0).toLocaleUpperCase('pt-BR') + texto.slice(1) : '';
}
