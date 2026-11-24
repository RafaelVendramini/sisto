// Mensagens da tela de registro de ocorrência (UC01, RN06, RNF02) e das telas
// de lista e detalhe (UC03, RF05, RN19 — Issue #48): nada técnico aparece na
// tela. A mensagem do back-end (campo `erro`, 400/409) é exibida como veio.
//
// Desde a #129, as datas, as validações e os rótulos ficam em arquivos
// próprios; este arquivo continua reexportando tudo, para não quebrar as
// importações existentes.
import { CODIGOS_ERRO, codigoDaFalha } from './codigosErro.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';
import { DESTINATARIOS } from './rotulosOcorrencia.js';

export * from './dataHora.js';
export * from './rotulosOcorrencia.js';
export * from './validacoesOcorrencia.js';

// RN06: orientação exibida junto da descrição (o sistema não filtra o texto).
export const ORIENTACAO_REDACAO =
  'Escreva de forma objetiva e descritiva: conte o que aconteceu, sem opiniões. Não use ' +
  'linguagem ofensiva nem classificações que estigmatizem os estudantes.';

// RN06 e RN24 (SSD 1.18, Issue #152): orientação exibida junto da justificativa
// do encaminhamento ao psicólogo escolar, que é dado sensível.
export const ORIENTACAO_JUSTIFICATIVA_PSICOLOGO =
  'Explique de forma objetiva e descritiva o que você observou e por que o estudante precisa ' +
  'de acolhimento, sem opiniões. Não use linguagem ofensiva nem classificações que ' +
  'estigmatizem os estudantes, e inclua só os dados pessoais necessários.';

const MENSAGEM_GENERICA_REGISTRAR =
  'Não foi possível registrar a ocorrência agora. Tente novamente em instantes.';

// ---------------------------------------------------------------------------
// Consulta de ocorrências: lista e detalhe (UC03, RF05, RN19, RN20)
// ---------------------------------------------------------------------------

export const MENSAGEM_OCORRENCIA_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
export const MENSAGEM_SEM_OCORRENCIAS = 'Nenhuma ocorrência para mostrar.';
export const MENSAGEM_SEM_ENCAMINHAMENTOS = 'Nenhum encaminhamento registrado.';
export const MENSAGEM_SEM_COMUNICACOES = 'Nenhuma comunicação registrada.';
export const MENSAGEM_SEM_PROVIDENCIAS = 'Nenhuma providência registrada.';

// Filtros e paginação da lista (RF11 — Issue #87).
export const MENSAGEM_SEM_OCORRENCIAS_FILTRO = 'Nenhuma ocorrência encontrada com esses filtros.';
export const MENSAGEM_PERIODO_INVALIDO =
  'A data "De" não pode ser depois da data "Até". Corrija o período.';
export const MENSAGEM_FILTROS_INVALIDOS =
  'Não foi possível aplicar os filtros. Confira os valores escolhidos e tente novamente.';

const MENSAGEM_GENERICA_LISTA = 'Não foi possível carregar as ocorrências agora.';
const MENSAGEM_GENERICA_DETALHE = 'Não foi possível carregar a ocorrência agora.';

/**
 * Converte a falha do GET /ocorrencias em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * O 400 (filtro recusado pela API) não mostra o texto técnico do back-end.
 */
export function mensagemErroListaOcorrencias(falha) {
  if (falha?.status === 400) return MENSAGEM_FILTROS_INVALIDOS;
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_LISTA;
}

/**
 * Converte a falha do GET /ocorrencias/{id} em mensagem para a tela. O 404
 * (inexistente ou fora da visibilidade — RN19) e o 400 (id inválido na URL)
 * têm a mesma mensagem: para o usuário, a ocorrência não existe.
 */
export function mensagemErroDetalheOcorrencia(falha) {
  if ([400, 404].includes(falha?.status)) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_DETALHE;
}

/** Mensagem de sucesso (RF05): "Ocorrência nº 12 registrada com sucesso." */
export function mensagemOcorrenciaRegistrada(id) {
  return id === undefined || id === null
    ? 'Ocorrência registrada com sucesso.'
    : `Ocorrência nº ${id} registrada com sucesso.`;
}

// ---------------------------------------------------------------------------
// Usuários destinatários e tutores sugeridos (RN03, RN20)
// ---------------------------------------------------------------------------

/**
 * Usuários ativos de um perfil, só com { id, nome }. Quem não é Gestão já
 * recebe só ativos, sem o campo status; a Gestão recebe todos, com status.
 */
export function usuariosAtivosDoPerfil(usuarios, perfil) {
  return (usuarios ?? [])
    .filter((u) => u.perfil === perfil && (u.status === undefined || u.status === 'ATIVO'))
    .map(({ id, nome }) => ({ id, nome }));
}

/**
 * Separa os tutores ativos em "dos estudantes selecionados" (na ordem dos
 * estudantes) e "outros" (na ordem da API). Tutor de estudante que não está
 * entre os ativos não é sugerido (RN03).
 * @returns {{ sugeridos: Array<{id, nome}>, outros: Array<{id, nome}> }}
 */
export function agruparTutores(tutoresAtivos, estudantesSelecionados) {
  const idsSugeridos = [];
  for (const estudante of estudantesSelecionados ?? []) {
    const id = estudante?.tutor?.id;
    if (id !== undefined && id !== null && !idsSugeridos.includes(id)) idsSugeridos.push(id);
  }
  const porId = new Map((tutoresAtivos ?? []).map((t) => [t.id, t]));
  const sugeridos = idsSugeridos.filter((id) => porId.has(id)).map((id) => porId.get(id));
  const outros = (tutoresAtivos ?? []).filter((t) => !idsSugeridos.includes(t.id));
  return { sugeridos, outros };
}

/**
 * Converte a falha do POST /ocorrencias em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroRegistro(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 409].includes(status) && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA_REGISTRAR;
}

/** Usuários ativos de cada tipo de destinatário (RN03), só { id, nome }. */
export function separarUsuariosPorDestinatario(usuarios) {
  const porTipo = {};
  for (const { valor, perfilUsuario } of DESTINATARIOS) {
    porTipo[valor] = usuariosAtivosDoPerfil(usuarios, perfilUsuario);
  }
  return porTipo;
}

// ---------------------------------------------------------------------------
// Encaminhamento de ocorrência já registrada (UC02, RF08, RN03, RN15 — #50)
// ---------------------------------------------------------------------------

export const MENSAGEM_ENCAMINHAMENTO_REGISTRADO = 'Encaminhamento registrado.';
export const MENSAGEM_ENCAMINHAMENTO_CONFLITO =
  'A ocorrência foi encerrada ou alterada por outra pessoa. Atualize a ocorrência e tente novamente.';

const MENSAGEM_GENERICA_ENCAMINHAR =
  'Não foi possível registrar o encaminhamento agora. Tente novamente em instantes.';

/**
 * Pessoas que podem ser responsáveis pelo acompanhamento (RN15): ativas, com
 * perfil Tutor, Pedagógico ou Gestão, agrupadas por perfil. Os tutores dos
 * estudantes da ocorrência vêm primeiro (`tutoresSugeridos`).
 * @param {Array<object>} usuarios - resposta do GET /usuarios
 * @param {Array<object>} estudantesComTutor - estudantes da ocorrência com `tutor`
 * @returns {{ tutoresSugeridos: Array, outrosTutores: Array, pedagogicos: Array, gestao: Array }}
 */
export function agruparResponsaveis(usuarios, estudantesComTutor) {
  const { sugeridos, outros } = agruparTutores(
    usuariosAtivosDoPerfil(usuarios, 'TUTOR'),
    estudantesComTutor,
  );
  return {
    tutoresSugeridos: sugeridos,
    outrosTutores: outros,
    pedagogicos: usuariosAtivosDoPerfil(usuarios, 'PEDAGOGICO'),
    gestao: usuariosAtivosDoPerfil(usuarios, 'GESTAO'),
  };
}

/**
 * A falha do encaminhamento indica que a ocorrência mudou ou sumiu (409:
 * encerrada ou alterada ao mesmo tempo; 404: inexistente ou fora da
 * visibilidade): vale atualizar o detalhe.
 */
export function encaminhamentoPedeAtualizacao(falha) {
  return [404, 409].includes(falha?.status);
}

/**
 * Converte a falha do POST /ocorrencias/{id}/encaminhamentos em mensagem para
 * a tela. O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroEncaminhamento(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if (status === 409) return MENSAGEM_ENCAMINHAMENTO_CONFLITO;
  if (status === 404) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  if (status === 400 && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA_ENCAMINHAR;
}

// ---------------------------------------------------------------------------
// Registro de comunicação feita fora do sistema (RF09, RN16, RN17 — #52)
// ---------------------------------------------------------------------------

export const MENSAGEM_COMUNICACAO_REGISTRADA = 'Comunicação registrada.';
export const MENSAGEM_COMUNICACAO_CONFLITO = MENSAGEM_ENCAMINHAMENTO_CONFLITO;

// RN06/RN16: orientação exibida junto da descrição (o sistema não filtra o texto).
export const ORIENTACAO_COMUNICACAO =
  'Registre o que foi tratado no contato, de forma objetiva e sem opiniões. Não inclua ' +
  'mais dados pessoais do que o necessário.';

const MENSAGEM_GENERICA_COMUNICACAO =
  'Não foi possível registrar a comunicação agora. Tente novamente em instantes.';

/**
 * A falha do registro indica que a ocorrência mudou ou sumiu (409: encerrada
 * ou alterada ao mesmo tempo; 404: inexistente ou fora da visibilidade — RN19):
 * vale atualizar o detalhe.
 */
export function comunicacaoPedeAtualizacao(falha) {
  return [404, 409].includes(falha?.status);
}

/**
 * Converte a falha do POST /ocorrencias/{id}/comunicacoes em mensagem para a
 * tela. O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroComunicacao(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if (status === 409) return MENSAGEM_COMUNICACAO_CONFLITO;
  if (status === 404) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  if (status === 400 && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA_COMUNICACAO;
}

// ---------------------------------------------------------------------------
// Providência adotada e encerramento (UC04, RF10, RF12, RN04, RN22 — #84)
// ---------------------------------------------------------------------------

export const MENSAGEM_PROVIDENCIA_REGISTRADA = 'Providência registrada.';
export const MENSAGEM_OCORRENCIA_ENCERRADA = 'Ocorrência encerrada.';

/** RN04: orientação ao tentar encerrar sem nenhuma providência registrada. */
export const MENSAGEM_ENCERRAR_SEM_PROVIDENCIA =
  'Para encerrar a ocorrência, registre antes ao menos uma providência adotada. ' +
  'Use o botão "Registrar providência".';

/** Pergunta do diálogo de confirmação do encerramento (ação irreversível — RN04). */
export const PERGUNTA_ENCERRAMENTO =
  'Encerrar a ocorrência? Depois de encerrada, ela não recebe mais encaminhamentos, ' +
  'comunicações nem providências.';

/** Usado quando o 409 chega sem a mensagem do back-end. */
export const MENSAGEM_CONFLITO_OCORRENCIA = MENSAGEM_ENCAMINHAMENTO_CONFLITO;

const MENSAGEM_GENERICA_PROVIDENCIA =
  'Não foi possível registrar a providência agora. Tente novamente em instantes.';
const MENSAGEM_GENERICA_ENCERRAMENTO =
  'Não foi possível encerrar a ocorrência agora. Tente novamente em instantes.';

/** RN04: só encerra quem já tem ao menos uma providência registrada. */
export function temProvidencia(ocorrencia) {
  return (ocorrencia?.providencias ?? []).length > 0;
}

/**
 * A falha indica que a ocorrência mudou ou sumiu (409: status mudou, sem
 * providência ou conflito concorrente; 404: inexistente ou fora da
 * visibilidade — RN19): vale atualizar o detalhe.
 */
export function atualizacaoOcorrenciaPedeAtualizacao(falha) {
  return [404, 409].includes(falha?.status);
}

/**
 * Texto reserva do 409 da providência/encerramento quando a resposta vem sem
 * a mensagem do back-end: identificado pelo `codigo` (#72/D1). Sem providência
 * orienta a registrar uma; os demais (aberta, encerrada, concorrente ou sem
 * código) pedem para atualizar a ocorrência.
 */
export function mensagemReservaConflitoOcorrencia(falha) {
  if (codigoDaFalha(falha) === CODIGOS_ERRO.ENCERRAMENTO_SEM_PROVIDENCIA) {
    return MENSAGEM_ENCERRAR_SEM_PROVIDENCIA;
  }
  return MENSAGEM_CONFLITO_OCORRENCIA;
}

/** Mensagens comuns às falhas da providência e do encerramento. */
function mensagemErroAtualizacao(falha, generica) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if (status === 404) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  // 409: a mensagem do back-end explica o motivo (OCORRENCIA_ABERTA,
  // OCORRENCIA_ENCERRADA, ENCERRAMENTO_SEM_PROVIDENCIA ou CONFLITO_CONCORRENTE).
  // Sem a mensagem, o `codigo` (#72/D1) escolhe o texto reserva.
  if (status === 409) {
    if (falha?.doServidor && falha?.message) return falha.message;
    return mensagemReservaConflitoOcorrencia(falha);
  }
  if (status === 400 && falha?.doServidor && falha?.message) return falha.message;
  return generica;
}

/**
 * Converte a falha do POST /ocorrencias/{id}/providencias em mensagem para a
 * tela. O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroProvidencia(falha) {
  return mensagemErroAtualizacao(falha, MENSAGEM_GENERICA_PROVIDENCIA);
}

/**
 * Converte a falha do PATCH /ocorrencias/{id}/status em mensagem para a tela.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroEncerramento(falha) {
  return mensagemErroAtualizacao(falha, MENSAGEM_GENERICA_ENCERRAMENTO);
}

// ---------------------------------------------------------------------------
// Histórico de alterações no detalhe (RF12, RN08, RN17 — #85)
// ---------------------------------------------------------------------------

export const MENSAGEM_SEM_HISTORICO = 'Nenhuma alteração registrada.';

const MENSAGEM_GENERICA_HISTORICO = 'Não foi possível carregar o histórico agora.';

/**
 * A falha do histórico indica que a ocorrência não existe para o usuário (404:
 * inexistente ou fora da visibilidade — RN19; 400: id inválido): a tela mostra
 * o mesmo "não encontrada" do detalhe.
 */
export function historicoNaoEncontrado(falha) {
  return [400, 404].includes(falha?.status);
}

/**
 * Converte a falha do GET /ocorrencias/{id}/historico em mensagem para a
 * seção. O 401 não chega aqui na prática: o tratamento central leva ao login.
 */
export function mensagemErroHistorico(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_HISTORICO;
}
