// Rótulos das ocorrências na tela (RF05, RF10, RN03, RN08, RNF02): status,
// destinatários, ações do histórico e o texto de campo vazio. Separado de
// mensagensOcorrencias.js (#129), que continua reexportando tudo daqui.

// Destinatários do encaminhamento (Seção 11): valor técnico, rótulo na tela e
// perfil exigido do usuário destinatário (RN03). O Psicólogo escolar (v1.18,
// Issue #152) designa um usuário específico, como o Tutor.
export const DESTINATARIOS = Object.freeze([
  Object.freeze({ valor: 'TUTOR', rotulo: 'Tutor', perfilUsuario: 'TUTOR' }),
  Object.freeze({ valor: 'PSICOLOGO', rotulo: 'Psicólogo escolar', perfilUsuario: 'PSICOLOGO' }),
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

// Destinatários que exigem escolher um usuário (RN03): Tutor e Psicólogo escolar.
export const DESTINATARIOS_COM_USUARIO_OBRIGATORIO = Object.freeze(['TUTOR', 'PSICOLOGO']);

/** Indica se o destinatário exige escolher o usuário (Tutor e Psicólogo escolar — RN03). */
export function destinatarioExigeUsuario(destinatarioPerfil) {
  return DESTINATARIOS_COM_USUARIO_OBRIGATORIO.includes(destinatarioPerfil);
}

/** Indica se o destinatário exige a justificativa na observação (Psicólogo escolar — RN03, v1.18). */
export function destinatarioExigeJustificativa(destinatarioPerfil) {
  return destinatarioPerfil === 'PSICOLOGO';
}

/**
 * Indica se a troca do tipo de destinatário apaga a observação (RN24): ao sair
 * do Psicólogo escolar (a justificativa é dado sensível e não pode virar uma
 * observação comum, visível a todos que veem a ocorrência) ou ao entrar nele
 * (a observação escrita para outro destinatário não é a justificativa). Entre
 * Tutor, Equipe pedagógica e Gestão, a observação é mantida.
 */
export function trocaApagaObservacao(perfilAtual, novoPerfil) {
  return destinatarioExigeJustificativa(perfilAtual) !== destinatarioExigeJustificativa(novoPerfil);
}

/** Pergunta antes de apagar o texto digitado ao trocar o destinatário (RN24). */
export function perguntaTrocaDestinatario(perfilAtual) {
  return destinatarioExigeJustificativa(perfilAtual)
    ? 'A justificativa digitada será apagada. Deseja continuar?'
    : 'A observação digitada será apagada. Deseja continuar?';
}

// RN24 (v1.18): aviso de quem lê a justificativa ao psicólogo. Aparece junto do
// campo, no registro e no diálogo "Encaminhar", e no detalhe, no lugar do texto,
// quando a API devolve `observacao: null` nesse encaminhamento.
export const TEXTO_JUSTIFICATIVA_RESTRITA =
  'Justificativa visível somente para o psicólogo escolar, a Gestão e quem fez o encaminhamento';

/**
 * Indica se o encaminhamento é ao psicólogo e veio sem a justificativa: a API
 * devolve `observacao: null` a quem não pode lê-la (RN24).
 */
export function justificativaOculta(encaminhamento) {
  return (
    encaminhamento?.destinatarioPerfil === 'PSICOLOGO' &&
    (encaminhamento.observacao === null || encaminhamento.observacao === undefined)
  );
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
