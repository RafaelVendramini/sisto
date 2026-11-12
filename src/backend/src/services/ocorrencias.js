// Registro de ocorrência com vários estudantes e encaminhamento inicial —
// Sisto (Issue #45, UC01).
//
// - Contrato (Seção 12): POST /ocorrencias recebe
//   { dataHora, local, turmaId, categoriaId, descricao, estudanteIds[],
//     demaisEnvolvidos?, testemunhas?, providenciasImediatas?, observacoes?,
//     encaminhamentos[] } e responde 201. A API usa camelCase e o banco
//   snake_case (Seção 11). Ids chegam como número JSON (texto é recusado),
//   no mesmo padrão de /turmas e /estudantes. Campos fora do contrato
//   (ex.: profissionalResponsavelId, status) são ignorados.
// - RN02: ao menos um estudante; o profissional responsável é SEMPRE o
//   usuário logado (req.usuario.id), nunca um valor do corpo.
// - RF06: vários estudantes; ids repetidos contam uma vez (a PK composta de
//   OcorrenciaEstudante também impede repetir).
// - RN14: turmaId é a turma de referência; os estudantes podem ser de outras
//   turmas. Valida-se só que turma, categoria e estudantes existem (400).
// - RN17: dataHora (momento do fato) não pode ser futura; aceita até 5
//   minutos à frente do relógio do servidor. A data/hora do encaminhamento é
//   preenchida pelo banco (@default(now()) — momento do registro).
// - RN03: ao menos um encaminhamento. TUTOR exige destinatarioUsuarioId de um
//   usuário TUTOR ATIVO; EQUIPE_PEDAGOGICA/GESTAO aceitam usuário opcional,
//   que, se informado, precisa ser PEDAGOGICO/GESTAO (respectivamente) e
//   ATIVO. O encaminhamento inicial não muda o status: nasce ABERTO.
// - Decisões do Rafael (Issue #45): até 50 estudantes distintos e até 10
//   encaminhamentos; encaminhamentos repetidos (mesmo perfil e mesmo usuário,
//   null incluído) são recusados; local até 150 caracteres e textos longos até
//   5000. Tudo validado antes de qualquer consulta ao banco (400).
// - RN06: a API não filtra o texto.
// - RN08: histórico "ocorrência registrada" e um "encaminhamento registrado"
//   por encaminhamento, com ação em texto fixo, sem dados pessoais.
// - RNF04/RNF06: LogAuditoria "ocorrência criada", recurso "ocorrencias/<id>",
//   sem dados pessoais.
//
// Transação: ocorrência, estudantes, encaminhamentos, histórico e auditoria
// são gravados numa ÚNICA transação (tudo ou nada — RN03). Ela é SERIALIZABLE,
// no padrão de services/estudantes.js: as checagens de estado (destinatário
// com o perfil certo e ATIVO — RN03) e as gravações enxergam um único
// snapshot consistente, e um conflito com outra operação serializável
// (ex.: PUT /usuarios bloqueando o destinatário ao mesmo tempo) aborta uma
// delas (P2034), que é repetida; esgotadas as tentativas, responde 409.
//
// Consulta (Issue #47, UC02 passo 1): GET /ocorrencias (lista resumida, sem
// filtros do RF11 nem paginação) e GET /ocorrencias/{id} (detalhe), ambos
// limitados pela visibilidade da RN19 — ver filtroVisibilidadeOcorrencias,
// a ÚNICA função que define o que cada usuário pode ver. Ocorrência fora da
// visibilidade responde 404 igual à inexistente (não revela que existe).
// RN20: no detalhe, o código escolar dos estudantes só vai para a Gestão.
// Leitura não grava histórico nem auditoria (mesmo padrão dos outros GETs).
//
// Encaminhamento (Issue #49, UC02): POST /ocorrencias/{id}/encaminhamentos —
// ver a seção "Encaminhamento" no fim do arquivo.
//
// Comunicação (Issue #51, UC02): POST /ocorrencias/{id}/comunicacoes — ver a
// seção "Comunicação" no fim do arquivo.
//
// Providência (Issue #81, UC04 passo 2): POST /ocorrencias/{id}/providencias —
// ver a seção "Providência" no fim do arquivo.
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { ErroHttp } from '../lib/erros.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';
import { paraRespostaTurma } from './turmas.js';

/** Nome do recurso na API, usado no LogAuditoria ("ocorrencias/<id>"). */
export const RECURSO_OCORRENCIAS = 'ocorrencias';

/**
 * Limites TÉCNICOS defensivos (após trim). Textos curtos seguem a decisão do
 * Rafael (150 caracteres); o limite dos textos longos (5000) também é decisão
 * do Rafael na Issue #45 (o SSD não define).
 */
export const TAMANHO_MAXIMO_LOCAL = 150;
export const TAMANHO_MAXIMO_TEXTO_LONGO = 5000;

/** RN17: tolerância para relógios adiantados em relação ao servidor. */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** Quantidades máximas por ocorrência (decisão do Rafael na Issue #45). */
export const MAXIMO_ESTUDANTES = 50; // contados depois de remover ids repetidos
export const MAXIMO_ENCAMINHAMENTOS = 10;

/**
 * Faixa de anos (em UTC) que o PostgreSQL TIMESTAMP(3) consegue gravar pelo
 * Prisma 7 (adapter-pg). Medido no banco: 0001-01-01T00:00:00.000Z e
 * 9999-12-31T23:59:59.999Z gravam e relêem iguais; o ano 0000 (1 a.C.) dá
 * erro 22008, anos negativos dão 22007 e o ano 10000 dá "Invalid time value".
 * É um limite TÉCNICO do tipo, não uma data mínima de negócio.
 */
const ANO_MINIMO_GRAVAVEL = 1;
const ANO_MAXIMO_GRAVAVEL = 9999;

/** Maior valor de uma coluna Int do PostgreSQL (tipo dos ids, Seção 11). */
const MAIOR_ID = 2_147_483_647;

/** Tentativas da transação serializável antes de desistir com 409. */
const TENTATIVAS_TRANSACAO = 3;

/** Valores técnicos do destinatário (Seção 11) e o perfil exigido do usuário. */
export const PERFIL_DO_DESTINATARIO = Object.freeze({
  TUTOR: 'TUTOR',
  EQUIPE_PEDAGOGICA: 'PEDAGOGICO',
  GESTAO: 'GESTAO',
});
export const DESTINATARIOS_VALIDOS = Object.freeze(Object.keys(PERFIL_DO_DESTINATARIO));

/** Ações do histórico (RN08): textos fixos, sem dados pessoais. */
export const ACOES_HISTORICO = Object.freeze({
  OCORRENCIA_REGISTRADA: 'ocorrência registrada',
  ENCAMINHAMENTO_REGISTRADO: 'encaminhamento registrado',
  // Issue #49 (RN15): mudança de status e definição/troca do responsável.
  STATUS_ALTERADO: 'status alterado',
  RESPONSAVEL_DEFINIDO: 'responsável pelo acompanhamento definido',
  RESPONSAVEL_ALTERADO: 'responsável pelo acompanhamento alterado',
  // Issue #51 (RN08/RN16): sem o conteúdo da comunicação.
  COMUNICACAO_REGISTRADA: 'comunicação registrada',
  // Issue #81 (RN04/RN08): descrição nula, sem o conteúdo da providência.
  PROVIDENCIA_REGISTRADA: 'providência registrada',
});

/** Descrição fixa do histórico da mudança de status feita pelo encaminhamento (RN15). */
export const DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO = 'De aberto para em acompanhamento';

/** Descrição fixa do histórico de cada encaminhamento (sem nome do usuário). */
const DESCRICAO_HISTORICO_DESTINATARIO = Object.freeze({
  TUTOR: 'Destinatário: tutor',
  EQUIPE_PEDAGOGICA: 'Destinatário: equipe pedagógica',
  GESTAO: 'Destinatário: gestão',
});

const ROTULO_PERFIL_DESTINATARIO = Object.freeze({
  TUTOR: 'Tutor',
  EQUIPE_PEDAGOGICA: 'Pedagógico',
  GESTAO: 'Gestão',
});

export const MENSAGEM_CORPO_OCORRENCIA_INVALIDO =
  'Envie um objeto JSON com dataHora, local, turmaId, categoriaId, descricao, estudanteIds e encaminhamentos.';
export const MENSAGEM_DATA_HORA_INVALIDA =
  'Informe dataHora no formato ISO 8601 com fuso horário (ex.: 2026-10-20T14:30:00-03:00).';
export const MENSAGEM_DATA_HORA_FUTURA = 'A data e hora da ocorrência não pode estar no futuro.';
export const MENSAGEM_LOCAL_OBRIGATORIO = 'Informe local (texto não vazio).';
export const MENSAGEM_LOCAL_LONGO = `O local deve ter no máximo ${TAMANHO_MAXIMO_LOCAL} caracteres.`;
export const MENSAGEM_TURMA_ID_INVALIDO = 'Informe turmaId como número inteiro positivo.';
export const MENSAGEM_CATEGORIA_ID_INVALIDO = 'Informe categoriaId como número inteiro positivo.';
export const MENSAGEM_DESCRICAO_OBRIGATORIA = 'Informe descricao (texto não vazio).';
export const MENSAGEM_ESTUDANTES_OBRIGATORIOS =
  'Informe estudanteIds com ao menos um estudante envolvido.';
export const MENSAGEM_ESTUDANTE_ID_INVALIDO =
  'Cada item de estudanteIds deve ser um número inteiro positivo.';
export const MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS =
  'Informe encaminhamentos com ao menos um destinatário (tutor, equipe pedagógica ou gestão).';
export const MENSAGEM_ESTUDANTES_EXCEDIDOS = `Informe no máximo ${MAXIMO_ESTUDANTES} estudantes por ocorrência.`;
export const MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS = `Informe no máximo ${MAXIMO_ENCAMINHAMENTOS} encaminhamentos por ocorrência.`;
export const MENSAGEM_TURMA_INEXISTENTE = 'A turma informada não existe.';
export const MENSAGEM_CATEGORIA_INEXISTENTE = 'A categoria informada não existe.';
export const MENSAGEM_ESTUDANTE_INEXISTENTE = 'Um ou mais estudantes informados não existem.';
export const MENSAGEM_CONFLITO_CONCORRENTE_OCORRENCIA =
  'Não foi possível registrar a ocorrência por causa de outra operação ao mesmo tempo. Tente novamente.';

/** O PostgreSQL não grava U+0000 em colunas de texto (erro 22021 → 500). */
export const MENSAGEM_TEXTO_CARACTERE_INVALIDO =
  'O texto contém um caractere inválido. Remova-o e tente novamente.';

/** Mensagem de texto longo opcional/obrigatório acima do limite. */
export function mensagemTextoLongo(campo) {
  return `O campo ${campo} deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;
}
export function mensagemTextoInvalido(campo) {
  return `Informe ${campo} como texto (ou null).`;
}
export function mensagemEncaminhamentoInvalido(posicao) {
  return `O encaminhamento ${posicao} deve ser um objeto com destinatarioPerfil e, opcionalmente, destinatarioUsuarioId e observacao.`;
}
export function mensagemDestinatarioPerfilInvalido(posicao) {
  return `No encaminhamento ${posicao}, destinatarioPerfil deve ser um dos valores: ${DESTINATARIOS_VALIDOS.join(', ')}.`;
}
export function mensagemDestinatarioUsuarioIdInvalido(posicao) {
  return `No encaminhamento ${posicao}, informe destinatarioUsuarioId como número inteiro positivo (ou null).`;
}
export function mensagemEncaminhamentoRepetido(primeira, repetida) {
  return `Os encaminhamentos ${primeira} e ${repetida} têm o mesmo destinatário. Remova o repetido.`;
}
export function mensagemTutorObrigatorio(posicao) {
  return `No encaminhamento ${posicao}, o destinatário tutor exige destinatarioUsuarioId.`;
}
export function mensagemDestinatarioInvalido(posicao, destinatarioPerfil) {
  return `No encaminhamento ${posicao}, o usuário destinatário precisa ter perfil ${ROTULO_PERFIL_DESTINATARIO[destinatarioPerfil]} e status ativo.`;
}

// Leitura da resposta em consultas SEQUENCIAIS na mesma transação. Com muitas
// relações num único findUnique (medido: 3 ou mais), o Prisma 7 (adapter-pg)
// dispara consultas em paralelo na conexão da transação e o pg emite
// DeprecationWarning ("client is already executing a query"); por isso cada
// consulta abaixo carrega no máximo duas relações.
const SELECAO_TURMA_RESUMO = Object.freeze({ id: true, nome: true, etapa: true, ano_letivo: true });

const SELECAO_OCORRENCIA_RESPOSTA = Object.freeze({
  id: true,
  data_hora: true,
  local: true,
  descricao: true,
  demais_envolvidos: true,
  testemunhas: true,
  providencias_imediatas: true,
  observacoes: true,
  status: true,
  data_encerramento: true,
  turma: { select: SELECAO_TURMA_RESUMO },
  categoria: { select: { id: true, nome: true } },
});

const SELECAO_RESPONSAVEIS_RESPOSTA = Object.freeze({
  profissional_responsavel: { select: { id: true, nome: true } },
  responsavel_acompanhamento: { select: { id: true, nome: true } },
});

// Sem código escolar: é a seleção do 201 do POST (igual para todos os perfis)
// e a do detalhe para quem não é Gestão (RN20 — o campo nem é lido do banco).
const SELECAO_ESTUDANTES_RESPOSTA = Object.freeze({
  estudante: { select: { id: true, nome_completo: true, turma: { select: SELECAO_TURMA_RESUMO } } },
});

// Detalhe consultado pela Gestão (RN20): inclui o código escolar.
const SELECAO_ESTUDANTES_RESPOSTA_GESTAO = Object.freeze({
  estudante: {
    select: { id: true, nome_completo: true, codigo_escolar: true, turma: { select: SELECAO_TURMA_RESUMO } },
  },
});

const SELECAO_ENCAMINHAMENTO_RESPOSTA = Object.freeze({
  id: true,
  destinatario_perfil: true,
  destinatario_usuario: { select: { id: true, nome: true, perfil: true } },
  registrado_por: { select: { id: true, nome: true } },
  data_hora: true,
  observacao: true,
});

/**
 * Lê a ocorrência, com estudantes e encaminhamentos, para a resposta.
 * @param {object} tx client Prisma (transação)
 * @param {number} id
 * @param {{ codigoEscolar?: boolean }} [opcoes] codigoEscolar: lê o código
 *   escolar dos estudantes (só no detalhe consultado pela Gestão — RN20)
 */
async function lerOcorrenciaParaResposta(tx, id, { codigoEscolar = false } = {}) {
  const ocorrencia = await tx.ocorrencia.findUnique({
    where: { id },
    select: SELECAO_OCORRENCIA_RESPOSTA,
  });
  const responsaveis = await tx.ocorrencia.findUnique({
    where: { id },
    select: SELECAO_RESPONSAVEIS_RESPOSTA,
  });
  const estudantes = await tx.ocorrenciaEstudante.findMany({
    where: { ocorrencia_id: id },
    select: codigoEscolar ? SELECAO_ESTUDANTES_RESPOSTA_GESTAO : SELECAO_ESTUDANTES_RESPOSTA,
    orderBy: [{ estudante: { nome_completo: 'asc' } }, { estudante_id: 'asc' }],
  });
  const encaminhamentos = await tx.encaminhamento.findMany({
    where: { ocorrencia_id: id },
    select: SELECAO_ENCAMINHAMENTO_RESPOSTA,
    orderBy: { id: 'asc' },
  });
  return { ...ocorrencia, ...responsaveis, estudantes, encaminhamentos };
}

function ehIdNumerico(valor) {
  return Number.isInteger(valor) && valor >= 1 && valor <= MAIOR_ID;
}

// ISO 8601 com data, hora (minutos obrigatórios; segundos e fração opcionais)
// e fuso OBRIGATÓRIO (Z ou ±hh:mm). Sem fuso, a hora seria interpretada no
// fuso do servidor, o que é ambíguo (RN17: gravação em UTC).
const REGEX_DATA_HORA =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Converte dataHora (ISO 8601 com fuso) em Date, recusando datas inexistentes
 * (ex.: 2026-02-30) e componentes fora da faixa.
 * @param {unknown} valor
 * @returns {Date}
 * @throws {ErroHttp} 400
 */
export function converterDataHora(valor) {
  const partes = typeof valor === 'string' ? REGEX_DATA_HORA.exec(valor) : null;
  if (!partes) throw new ErroHttp(400, MENSAGEM_DATA_HORA_INVALIDA);

  const [, ano, mes, dia, hora, minuto, segundo = '0', fracao = '0', zulu, sinal, fusoH, fusoM] =
    partes;
  const n = (texto) => Number(texto);
  if (
    n(mes) < 1 || n(mes) > 12 ||
    n(dia) < 1 || n(hora) > 23 || n(minuto) > 59 || n(segundo) > 59 ||
    (zulu !== 'Z' && (n(fusoH) > 23 || n(fusoM) > 59))
  ) {
    throw new ErroHttp(400, MENSAGEM_DATA_HORA_INVALIDA);
  }
  const diasNoMes = new Date(Date.UTC(2000, n(mes), 0)).getUTCDate();
  const bissexto = (n(ano) % 4 === 0 && n(ano) % 100 !== 0) || n(ano) % 400 === 0;
  const limiteDia = n(mes) === 2 ? (bissexto ? 29 : 28) : diasNoMes;
  if (n(dia) > limiteDia) throw new ErroHttp(400, MENSAGEM_DATA_HORA_INVALIDA);

  const data = new Date(0);
  data.setUTCFullYear(n(ano), n(mes) - 1, n(dia));
  data.setUTCHours(n(hora), n(minuto), n(segundo), Math.floor(n(`0.${fracao}`) * 1000));
  if (zulu !== 'Z') {
    const deslocamentoMin = (n(fusoH) * 60 + n(fusoM)) * (sinal === '+' ? 1 : -1);
    data.setTime(data.getTime() - deslocamentoMin * 60 * 1000);
  }
  // Limite técnico do TIMESTAMP(3) via Prisma (ver ANO_MINIMO_GRAVAVEL): sem
  // isso, ex.: 0000-01-01T00:00Z ou 0001-01-01T00:00+14:00 (= ano 0 em UTC)
  // virariam erro 500 na gravação.
  if (
    Number.isNaN(data.getTime()) ||
    data.getUTCFullYear() < ANO_MINIMO_GRAVAVEL ||
    data.getUTCFullYear() > ANO_MAXIMO_GRAVAVEL
  ) {
    throw new ErroHttp(400, MENSAGEM_DATA_HORA_INVALIDA);
  }
  return data;
}

/**
 * RN17: a data/hora informada pode estar no máximo TOLERANCIA_FUTURO_MS à
 * frente do relógio do servidor; acima disso, 400 com a mensagem recebida.
 * Compartilhada pelo POST /ocorrencias e pelo POST /ocorrencias/{id}/comunicacoes.
 * @param {Date} dataHora
 * @param {() => Date} agora relógio do servidor
 * @param {string} mensagem
 * @throws {ErroHttp} 400
 */
function garantirNaoFutura(dataHora, agora, mensagem) {
  if (dataHora.getTime() > agora().getTime() + TOLERANCIA_FUTURO_MS) {
    throw new ErroHttp(400, mensagem);
  }
}

/**
 * Executa `operacao` numa transação SERIALIZABLE, repetindo-a quando o banco
 * aborta por conflito de serialização (P2034); esgotadas as tentativas,
 * responde 409 com `mensagemConflito`. ErroHttp lançado dentro da operação
 * sobe sem repetição. Compartilhada pelas gravações de ocorrências.
 * @param {object} db client Prisma
 * @param {(tx: object) => Promise<any>} operacao
 * @param {string} mensagemConflito
 * @throws {ErroHttp} 409 (conflito concorrente) ou o erro da operação
 */
async function executarSerializavel(db, operacao, mensagemConflito) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction(operacao, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (erro instanceof ErroHttp) throw erro;
      if (erro?.code === 'P2034') {
        if (tentativa < TENTATIVAS_TRANSACAO) continue;
        throw new ErroHttp(409, mensagemConflito);
      }
      throw erro;
    }
  }
}

/** Recusa o caractere nulo, que o PostgreSQL não aceita em texto (400, não 500). */
function garantirSemCaractereNulo(texto) {
  if (texto.includes('\u0000')) throw new ErroHttp(400, MENSAGEM_TEXTO_CARACTERE_INVALIDO);
}

/** Texto obrigatório: NFC, sem espaços nas pontas, não vazio, até `maximo`. */
function textoObrigatorio(valor, maximo, mensagemObrigatorio, mensagemLongo) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroHttp(400, mensagemObrigatorio);
  }
  garantirSemCaractereNulo(valor);
  const limpo = valor.normalize('NFC').trim();
  if (limpo.length > maximo) throw new ErroHttp(400, mensagemLongo);
  return limpo;
}

/**
 * Texto longo opcional: ausente, null ou vazio/só espaços -> null; texto ->
 * NFC, sem espaços nas pontas, até o limite.
 */
function textoOpcional(valor, campo) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErroHttp(400, mensagemTextoInvalido(campo));
  garantirSemCaractereNulo(valor);
  const limpo = valor.normalize('NFC').trim();
  if (limpo.length > TAMANHO_MAXIMO_TEXTO_LONGO) throw new ErroHttp(400, mensagemTextoLongo(campo));
  return limpo === '' ? null : limpo;
}

function validarEstudanteIds(valor) {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErroHttp(400, MENSAGEM_ESTUDANTES_OBRIGATORIOS);
  }
  for (const id of valor) {
    if (!ehIdNumerico(id)) throw new ErroHttp(400, MENSAGEM_ESTUDANTE_ID_INVALIDO);
  }
  // RF06: ids repetidos contam uma vez (mantém a ordem da primeira ocorrência).
  const distintos = [...new Set(valor)];
  if (distintos.length > MAXIMO_ESTUDANTES) {
    throw new ErroHttp(400, MENSAGEM_ESTUDANTES_EXCEDIDOS);
  }
  return distintos;
}

/**
 * RN03 — valida e normaliza destinatarioPerfil, destinatarioUsuarioId e
 * observacao de UM encaminhamento (sem acessar o banco). Compartilhada pelo
 * POST /ocorrencias (mensagens com a posição na lista) e pelo
 * POST /ocorrencias/{id}/encaminhamentos (mensagens sem posição).
 * @param {object} item objeto do encaminhamento (já conferido como objeto)
 * @param {{ perfilInvalido: string, usuarioIdInvalido: string, tutorObrigatorio: string, campoObservacao: string }} mensagens
 * @throws {ErroHttp} 400
 */
function normalizarDestinatario(item, mensagens) {
  const { destinatarioPerfil, destinatarioUsuarioId, observacao } = item;
  if (typeof destinatarioPerfil !== 'string' || !DESTINATARIOS_VALIDOS.includes(destinatarioPerfil)) {
    throw new ErroHttp(400, mensagens.perfilInvalido);
  }
  let usuarioId = null;
  if (destinatarioUsuarioId !== undefined && destinatarioUsuarioId !== null) {
    if (!ehIdNumerico(destinatarioUsuarioId)) {
      throw new ErroHttp(400, mensagens.usuarioIdInvalido);
    }
    usuarioId = destinatarioUsuarioId;
  }
  if (destinatarioPerfil === 'TUTOR' && usuarioId === null) {
    throw new ErroHttp(400, mensagens.tutorObrigatorio);
  }
  return {
    destinatarioPerfil,
    destinatarioUsuarioId: usuarioId,
    observacao: textoOpcional(observacao, mensagens.campoObservacao),
  };
}

function validarEncaminhamentos(valor) {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErroHttp(400, MENSAGEM_ENCAMINHAMENTOS_OBRIGATORIOS);
  }
  if (valor.length > MAXIMO_ENCAMINHAMENTOS) {
    throw new ErroHttp(400, MENSAGEM_ENCAMINHAMENTOS_EXCEDIDOS);
  }
  const encaminhamentos = valor.map((item, indice) => {
    const posicao = indice + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ErroHttp(400, mensagemEncaminhamentoInvalido(posicao));
    }
    return normalizarDestinatario(item, {
      perfilInvalido: mensagemDestinatarioPerfilInvalido(posicao),
      usuarioIdInvalido: mensagemDestinatarioUsuarioIdInvalido(posicao),
      tutorObrigatorio: mensagemTutorObrigatorio(posicao),
      campoObservacao: `observacao do encaminhamento ${posicao}`,
    });
  });

  // Decisão do Rafael: encaminhamentos repetidos são recusados. Repetido =
  // mesmo destinatarioPerfil e mesmo destinatarioUsuarioId (null conta como
  // valor). A mensagem cita só as posições, sem ids nem nomes.
  const primeiraPosicao = new Map();
  encaminhamentos.forEach(({ destinatarioPerfil, destinatarioUsuarioId }, indice) => {
    const chave = `${destinatarioPerfil}|${destinatarioUsuarioId ?? 'sem-usuario'}`;
    if (primeiraPosicao.has(chave)) {
      throw new ErroHttp(400, mensagemEncaminhamentoRepetido(primeiraPosicao.get(chave), indice + 1));
    }
    primeiraPosicao.set(chave, indice + 1);
  });
  return encaminhamentos;
}

/**
 * Valida e normaliza o corpo do POST /ocorrencias. Não acessa o banco.
 * @param {unknown} corpo
 * @param {object} [opcoes]
 * @param {() => Date} [opcoes.agora] relógio do servidor (injetável em testes)
 * @throws {ErroHttp} 400
 */
export function validarOcorrencia(corpo, { agora = () => new Date() } = {}) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_OCORRENCIA_INVALIDO);
  }

  const dataHora = converterDataHora(corpo.dataHora);
  // RN17: até 5 minutos à frente do relógio do servidor; acima disso, recusa.
  garantirNaoFutura(dataHora, agora, MENSAGEM_DATA_HORA_FUTURA);

  const local = textoObrigatorio(
    corpo.local,
    TAMANHO_MAXIMO_LOCAL,
    MENSAGEM_LOCAL_OBRIGATORIO,
    MENSAGEM_LOCAL_LONGO,
  );
  if (!ehIdNumerico(corpo.turmaId)) throw new ErroHttp(400, MENSAGEM_TURMA_ID_INVALIDO);
  if (!ehIdNumerico(corpo.categoriaId)) throw new ErroHttp(400, MENSAGEM_CATEGORIA_ID_INVALIDO);
  const descricao = textoObrigatorio(
    corpo.descricao,
    TAMANHO_MAXIMO_TEXTO_LONGO,
    MENSAGEM_DESCRICAO_OBRIGATORIA,
    mensagemTextoLongo('descricao'),
  );
  const estudanteIds = validarEstudanteIds(corpo.estudanteIds);

  return {
    dataHora,
    local,
    turmaId: corpo.turmaId,
    categoriaId: corpo.categoriaId,
    descricao,
    estudanteIds,
    demaisEnvolvidos: textoOpcional(corpo.demaisEnvolvidos, 'demaisEnvolvidos'),
    testemunhas: textoOpcional(corpo.testemunhas, 'testemunhas'),
    providenciasImediatas: textoOpcional(corpo.providenciasImediatas, 'providenciasImediatas'),
    observacoes: textoOpcional(corpo.observacoes, 'observacoes'),
    encaminhamentos: validarEncaminhamentos(corpo.encaminhamentos),
  };
}

/** Converte a ocorrência lida do banco para o formato da API (camelCase). */
export function paraRespostaOcorrencia(o) {
  return {
    id: o.id,
    dataHora: o.data_hora,
    local: o.local,
    turma: paraRespostaTurma(o.turma),
    categoria: { id: o.categoria.id, nome: o.categoria.nome },
    descricao: o.descricao,
    demaisEnvolvidos: o.demais_envolvidos,
    testemunhas: o.testemunhas,
    providenciasImediatas: o.providencias_imediatas,
    observacoes: o.observacoes,
    status: o.status,
    dataEncerramento: o.data_encerramento,
    profissionalResponsavel: { id: o.profissional_responsavel.id, nome: o.profissional_responsavel.nome },
    responsavelAcompanhamento: o.responsavel_acompanhamento
      ? { id: o.responsavel_acompanhamento.id, nome: o.responsavel_acompanhamento.nome }
      : null,
    estudantes: o.estudantes.map(({ estudante }) => ({
      id: estudante.id,
      nomeCompleto: estudante.nome_completo,
      turma: paraRespostaTurma(estudante.turma),
    })),
    encaminhamentos: o.encaminhamentos.map((e) => ({
      id: e.id,
      destinatarioPerfil: e.destinatario_perfil,
      destinatarioUsuario: e.destinatario_usuario
        ? { id: e.destinatario_usuario.id, nome: e.destinatario_usuario.nome, perfil: e.destinatario_usuario.perfil }
        : null,
      registradoPor: { id: e.registrado_por.id, nome: e.registrado_por.nome },
      dataHora: e.data_hora,
      observacao: e.observacao,
    })),
  };
}

/** RN14: turma, categoria e estudantes precisam existir (400). */
async function garantirReferenciasExistem(tx, dados) {
  const turma = await tx.turma.findUnique({ where: { id: dados.turmaId }, select: { id: true } });
  if (!turma) throw new ErroHttp(400, MENSAGEM_TURMA_INEXISTENTE);

  const categoria = await tx.categoria.findUnique({
    where: { id: dados.categoriaId },
    select: { id: true },
  });
  if (!categoria) throw new ErroHttp(400, MENSAGEM_CATEGORIA_INEXISTENTE);

  const encontrados = await tx.estudante.findMany({
    where: { id: { in: dados.estudanteIds } },
    select: { id: true },
  });
  if (encontrados.length !== dados.estudanteIds.length) {
    throw new ErroHttp(400, MENSAGEM_ESTUDANTE_INEXISTENTE);
  }
}

/**
 * RN03: o usuário destinatário, quando informado, tem o perfil certo e está ATIVO.
 * @param {(posicao: number, destinatarioPerfil: string) => string} [mensagem]
 *   mensagem do 400 (padrão: com a posição na lista do POST /ocorrencias)
 */
async function garantirDestinatariosValidos(tx, encaminhamentos, mensagem = mensagemDestinatarioInvalido) {
  const ids = [
    ...new Set(encaminhamentos.map((e) => e.destinatarioUsuarioId).filter((id) => id !== null)),
  ];
  if (ids.length === 0) return;
  const usuarios = await tx.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, perfil: true, status: true },
  });
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  encaminhamentos.forEach((encaminhamento, indice) => {
    if (encaminhamento.destinatarioUsuarioId === null) return;
    const usuario = porId.get(encaminhamento.destinatarioUsuarioId);
    const perfilExigido = PERFIL_DO_DESTINATARIO[encaminhamento.destinatarioPerfil];
    if (!usuario || usuario.perfil !== perfilExigido || usuario.status !== 'ATIVO') {
      throw new ErroHttp(400, mensagem(indice + 1, encaminhamento.destinatarioPerfil));
    }
  });
}

/** Grava tudo (ocorrência, estudantes, encaminhamentos, histórico, auditoria). */
async function gravarOcorrencia(tx, dados, usuarioId) {
  await garantirReferenciasExistem(tx, dados);
  await garantirDestinatariosValidos(tx, dados.encaminhamentos);

  const ocorrencia = await tx.ocorrencia.create({
    data: {
      data_hora: dados.dataHora,
      local: dados.local,
      turma_id: dados.turmaId,
      categoria_id: dados.categoriaId,
      descricao: dados.descricao,
      demais_envolvidos: dados.demaisEnvolvidos,
      testemunhas: dados.testemunhas,
      providencias_imediatas: dados.providenciasImediatas,
      observacoes: dados.observacoes,
      // RN02: sempre o usuário logado.
      profissional_responsavel_id: usuarioId,
      // RN03/RN04: o encaminhamento inicial não muda o status.
      status: 'ABERTO',
    },
    select: { id: true },
  });

  await tx.ocorrenciaEstudante.createMany({
    data: dados.estudanteIds.map((estudanteId) => ({
      ocorrencia_id: ocorrencia.id,
      estudante_id: estudanteId,
    })),
  });

  // Um por vez, na ordem recebida (ids crescentes na mesma ordem do corpo).
  // data_hora vem do banco (@default(now()) — RN17).
  for (const encaminhamento of dados.encaminhamentos) {
    await tx.encaminhamento.create({
      data: {
        ocorrencia_id: ocorrencia.id,
        destinatario_perfil: encaminhamento.destinatarioPerfil,
        destinatario_usuario_id: encaminhamento.destinatarioUsuarioId,
        registrado_por_id: usuarioId,
        observacao: encaminhamento.observacao,
      },
      select: { id: true },
    });
  }

  // RN08: textos fixos, sem dados pessoais nem conteúdo do registro.
  await tx.historicoOcorrencia.createMany({
    data: [
      { ocorrencia_id: ocorrencia.id, usuario_id: usuarioId, acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA },
      ...dados.encaminhamentos.map((encaminhamento) => ({
        ocorrencia_id: ocorrencia.id,
        usuario_id: usuarioId,
        acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO,
        descricao: DESCRICAO_HISTORICO_DESTINATARIO[encaminhamento.destinatarioPerfil],
      })),
    ],
  });

  await registrarAuditoria(
    {
      usuarioId,
      acao: ACOES_AUDITORIA.OCORRENCIA_CRIADA,
      recurso: recursoAuditoria(RECURSO_OCORRENCIAS, ocorrencia.id),
    },
    tx,
  );

  return paraRespostaOcorrencia(await lerOcorrenciaParaResposta(tx, ocorrencia.id));
}

/**
 * Registra uma ocorrência com seus estudantes e o encaminhamento inicial
 * (UC01, RF05, RF06, RN02, RN03, RN08, RN14, RN17, RNF04).
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {() => Date} [deps.agora] relógio do servidor (injetável em testes)
 * @throws {ErroHttp} 400 (dados/referências inválidos) ou 409 (conflito concorrente)
 */
export async function registrarOcorrencia(
  corpo,
  solicitante,
  { db = prisma, agora = () => new Date() } = {},
) {
  const dados = validarOcorrencia(corpo, { agora });
  const usuarioId = solicitante.id;

  return executarSerializavel(
    db,
    (tx) => gravarOcorrencia(tx, dados, usuarioId),
    MENSAGEM_CONFLITO_CONCORRENTE_OCORRENCIA,
  );
}

// ---------------------------------------------------------------------------
// Consulta: GET /ocorrencias e GET /ocorrencias/{id} (Issue #47)
// ---------------------------------------------------------------------------

export const MENSAGEM_ID_OCORRENCIA_INVALIDO = 'Identificador de ocorrência inválido.';
/** Mesma mensagem para inexistente e fora da visibilidade (RN19). */
export const MENSAGEM_OCORRENCIA_NAO_ENCONTRADA = 'Ocorrência não encontrada.';

/** Perfis que visualizam todas as ocorrências (RN19). */
export const PERFIS_VISIBILIDADE_TOTAL = Object.freeze(['GESTAO', 'PEDAGOGICO']);

/** Perfil que recebe o código escolar dos estudantes no detalhe (RN20). */
const PERFIL_DADOS_COMPLETOS = 'GESTAO';

/**
 * Converte o id da URL (texto decimal simples, inteiro positivo até o maior
 * Int do PostgreSQL), no mesmo padrão de /estudantes/{id}.
 * @param {unknown} valor req.params.id
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function validarIdOcorrencia(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) {
    throw new ErroHttp(400, MENSAGEM_ID_OCORRENCIA_INVALIDO);
  }
  const id = Number(valor);
  if (id > MAIOR_ID) throw new ErroHttp(400, MENSAGEM_ID_OCORRENCIA_INVALIDO);
  return id;
}

/**
 * RN19 — visibilidade das ocorrências por perfil. É a ÚNICA definição da
 * regra no back-end: devolve o `where` do Prisma (modelo Ocorrencia) com as
 * ocorrências que o usuário pode ver. Use-a em toda consulta ou operação sobre
 * ocorrências de um usuário (lista, detalhe e, nas próximas Issues, filtros do
 * RF11, histórico do RF12, RF13/RF14 e a #51), combinando com outras condições
 * por `{ AND: [condicoes, filtroVisibilidadeOcorrencias(usuario)] }` — assim a
 * restrição fica na própria consulta, e não numa checagem depois de ler.
 *
 * - GESTAO e PEDAGOGICO: todas (filtro vazio).
 * - Demais perfis (mesma condição para todos, sem tratamento especial para
 *   PROFESSOR e TECNICO_ADMINISTRATIVO): as que registrou
 *   (profissional_responsavel_id) OU as encaminhadas a ele como usuário
 *   destinatário (destinatario_usuario_id de algum encaminhamento).
 * - TUTOR, além disso: as que acompanha como responsável
 *   (responsavel_acompanhamento_id) OU as que envolvem algum estudante sob a
 *   tutoria dele. Decisão do Rafael (Issue #47): vale o vínculo ATUAL do
 *   estudante (estudantes.tutor_id no momento da consulta). Se o estudante
 *   trocar de tutor, o novo tutor passa a ver as ocorrências dele (inclusive
 *   as antigas) e o anterior deixa de vê-las, salvo se outra condição acima
 *   ainda valer para ele (registrou, recebeu encaminhamento ou acompanha).
 *
 * O perfil e o id vêm de req.usuario, lidos do banco a cada requisição
 * (services/sessao.js) — nunca do corpo nem do token.
 * @param {{ id: number, perfil: string }} usuario usuário autenticado
 * @returns {object} where do Prisma para o modelo Ocorrencia
 * @throws {Error} sem usuário válido (erro de programação; falha fechada)
 */
export function filtroVisibilidadeOcorrencias(usuario) {
  if (!usuario || !Number.isInteger(usuario.id) || usuario.id < 1) {
    throw new Error('filtroVisibilidadeOcorrencias: usuário autenticado obrigatório.');
  }
  if (PERFIS_VISIBILIDADE_TOTAL.includes(usuario.perfil)) return {};

  const condicoes = [
    { profissional_responsavel_id: usuario.id },
    { encaminhamentos: { some: { destinatario_usuario_id: usuario.id } } },
  ];
  if (usuario.perfil === 'TUTOR') {
    condicoes.push(
      { responsavel_acompanhamento_id: usuario.id },
      { estudantes: { some: { estudante: { tutor_id: usuario.id } } } },
    );
  }
  return { OR: condicoes };
}

/**
 * Lê as ocorrências e as relações em consultas SEQUENCIAIS (no máximo duas
 * relações por consulta, como em lerOcorrenciaParaResposta), sem N+1: uma
 * consulta de ocorrências, uma dos profissionais e uma das associações com
 * estudantes, independentemente do número de ocorrências.
 */
async function lerListaOcorrencias(tx, filtro) {
  const ocorrencias = await tx.ocorrencia.findMany({
    where: filtro,
    select: {
      id: true,
      data_hora: true,
      local: true,
      status: true,
      profissional_responsavel_id: true,
      turma: { select: SELECAO_TURMA_RESUMO },
      categoria: { select: { id: true, nome: true } },
    },
    // Mais recente primeiro; id desc desempata fatos com a mesma data/hora.
    orderBy: [{ data_hora: 'desc' }, { id: 'desc' }],
  });
  if (ocorrencias.length === 0) return [];

  const idsProfissionais = [...new Set(ocorrencias.map((o) => o.profissional_responsavel_id))];
  const profissionais = await tx.usuario.findMany({
    where: { id: { in: idsProfissionais } },
    select: { id: true, nome: true },
  });

  // As associações vêm pelo MESMO filtro de visibilidade (e não por uma lista
  // de ids, que cresceria com o número de ocorrências); a transação garante
  // que as duas consultas enxergam o mesmo conjunto.
  const associacoes = await tx.ocorrenciaEstudante.findMany({
    where: Object.keys(filtro).length > 0 ? { ocorrencia: filtro } : {},
    select: { ocorrencia_id: true, estudante: { select: { id: true, nome_completo: true } } },
    orderBy: [{ estudante: { nome_completo: 'asc' } }, { estudante_id: 'asc' }],
  });

  const profissionalPorId = new Map(profissionais.map((u) => [u.id, u]));
  const estudantesPorOcorrencia = new Map();
  for (const { ocorrencia_id: ocorrenciaId, estudante } of associacoes) {
    if (!estudantesPorOcorrencia.has(ocorrenciaId)) estudantesPorOcorrencia.set(ocorrenciaId, []);
    estudantesPorOcorrencia.get(ocorrenciaId).push(estudante);
  }
  return ocorrencias.map((o) => ({
    ...o,
    profissional_responsavel: profissionalPorId.get(o.profissional_responsavel_id),
    estudantes: estudantesPorOcorrencia.get(o.id) ?? [],
  }));
}

/**
 * Item RESUMIDO da lista (decisão do Rafael, Issue #47): sem descrição,
 * demais textos, encaminhamentos nem comunicações — o detalhe traz o resto.
 */
export function paraRespostaItemListaOcorrencia(o) {
  return {
    id: o.id,
    dataHora: o.data_hora,
    local: o.local,
    status: o.status,
    turma: paraRespostaTurma(o.turma),
    categoria: { id: o.categoria.id, nome: o.categoria.nome },
    profissionalResponsavel: { id: o.profissional_responsavel.id, nome: o.profissional_responsavel.nome },
    estudantes: o.estudantes.map((e) => ({ id: e.id, nomeCompleto: e.nome_completo })),
  };
}

/**
 * Detalhe: o mesmo formato do 201 do POST (paraRespostaOcorrencia) mais
 * comunicações e providências. RN20: codigoEscolar nos estudantes SOMENTE
 * para a Gestão; para os demais perfis a chave não aparece.
 * @param {object} o ocorrência lida (com comunicacoes e providencias)
 * @param {{ codigoEscolar?: boolean }} [opcoes]
 */
export function paraRespostaDetalheOcorrencia(o, { codigoEscolar = false } = {}) {
  const base = paraRespostaOcorrencia(o);
  const registradoPor = (r) => ({ id: r.registrado_por.id, nome: r.registrado_por.nome });
  return {
    ...base,
    estudantes: codigoEscolar
      ? base.estudantes.map((estudante, i) => ({
          ...estudante,
          codigoEscolar: o.estudantes[i].estudante.codigo_escolar,
        }))
      : base.estudantes,
    comunicacoes: o.comunicacoes.map((c) => ({
      id: c.id,
      destinatario: c.destinatario,
      meio: c.meio,
      descricao: c.descricao,
      dataHora: c.data_hora,
      registradoPor: registradoPor(c),
    })),
    providencias: o.providencias.map((p) => ({
      id: p.id,
      descricao: p.descricao,
      dataHora: p.data_hora,
      registradoPor: registradoPor(p),
    })),
  };
}

// Leituras numa transação REPEATABLE READ: as consultas sequenciais enxergam
// um único snapshot (a visibilidade conferida e os dados lidos são do mesmo
// momento). Como só há leituras, não ocorre conflito de serialização.
function emLeituraConsistente(db, operacao) {
  return db.$transaction(operacao, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/**
 * Lista as ocorrências visíveis ao usuário (RN19), da mais recente para a mais
 * antiga (data_hora desc, id desc), sem filtros (RF11 na Sprint 3) e sem
 * paginação. Itens no formato resumido.
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 */
export async function listarOcorrencias(solicitante, { db = prisma } = {}) {
  const filtro = filtroVisibilidadeOcorrencias(solicitante);
  const ocorrencias = await emLeituraConsistente(db, (tx) => lerListaOcorrencias(tx, filtro));
  return ocorrencias.map(paraRespostaItemListaOcorrencia);
}

/**
 * Detalhe de uma ocorrência visível ao usuário (RN19, RN20), com estudantes,
 * categoria, turma, encaminhamentos, comunicações e providências.
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @throws {ErroHttp} 400 (id inválido) ou 404 (inexistente ou fora da visibilidade)
 */
export async function obterOcorrencia(idUrl, solicitante, { db = prisma } = {}) {
  const id = validarIdOcorrencia(idUrl);
  const filtro = filtroVisibilidadeOcorrencias(solicitante);
  const codigoEscolar = solicitante.perfil === PERFIL_DADOS_COMPLETOS;

  return emLeituraConsistente(db, async (tx) => {
    // A visibilidade faz parte da consulta: inexistente e não permitida dão o
    // mesmo resultado (null -> 404 com a mesma mensagem).
    const visivel = await tx.ocorrencia.findFirst({
      where: { AND: [{ id }, filtro] },
      select: { id: true },
    });
    if (!visivel) throw new ErroHttp(404, MENSAGEM_OCORRENCIA_NAO_ENCONTRADA);

    return lerDetalheOcorrencia(tx, id, { codigoEscolar });
  });
}

/**
 * Lê o detalhe completo (formato do GET /ocorrencias/{id}) de uma ocorrência
 * cuja visibilidade já foi conferida, na transação recebida. Usada pelo GET
 * do detalhe e pelo 201 do POST /ocorrencias/{id}/encaminhamentos, do
 * POST /ocorrencias/{id}/comunicacoes e do POST /ocorrencias/{id}/providencias.
 * @param {object} tx client da transação
 * @param {number} id
 * @param {{ codigoEscolar?: boolean }} [opcoes] RN20: só para a Gestão
 */
async function lerDetalheOcorrencia(tx, id, { codigoEscolar = false } = {}) {
  const ocorrencia = await lerOcorrenciaParaResposta(tx, id, { codigoEscolar });
  const comunicacoes = await tx.comunicacao.findMany({
    where: { ocorrencia_id: id },
    select: {
      id: true,
      destinatario: true,
      meio: true,
      descricao: true,
      data_hora: true,
      registrado_por: { select: { id: true, nome: true } },
    },
    orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
  });
  const providencias = await tx.providencia.findMany({
    where: { ocorrencia_id: id },
    select: {
      id: true,
      descricao: true,
      data_hora: true,
      registrado_por: { select: { id: true, nome: true } },
    },
    orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
  });
  return paraRespostaDetalheOcorrencia(
    { ...ocorrencia, comunicacoes, providencias },
    { codigoEscolar },
  );
}

// ---------------------------------------------------------------------------
// Encaminhamento: POST /ocorrencias/{id}/encaminhamentos (Issue #49, UC02)
// ---------------------------------------------------------------------------
//
// - Contrato (Seção 12): { destinatarioPerfil, destinatarioUsuarioId?,
//   observacao?, responsavelAcompanhamentoId? }; responde 201 com o DETALHE
//   COMPLETO da ocorrência (decisão do Rafael), no formato do
//   GET /ocorrencias/{id} (codigoEscolar só para a Gestão — RN20). Campos
//   fora do contrato (ex.: registradoPorId, status) são ignorados.
// - Permissão (Seção 4, RN15): só GESTAO e PEDAGOGICO (na rota).
// - RN03: mesmas regras de destinatário do POST /ocorrencias.
// - RN15: ABERTO exige responsavelAcompanhamentoId (usuário ATIVO com perfil
//   TUTOR, PEDAGOGICO ou GESTAO) e passa a EM_ACOMPANHAMENTO (RN04);
//   EM_ACOMPANHAMENTO mantém o status e a troca do responsável é opcional
//   (o mesmo responsável atual não é troca); ENCERRADO responde 409.
// - Decisão do Rafael: encaminhar de novo para um destinatário que já
//   recebeu esta ocorrência é PERMITIDO.
// - RN17: registrado_por_id é o usuário logado e data_hora vem do banco.
// - RN08: histórico "encaminhamento registrado" e, quando houver, "status
//   alterado" e "responsável pelo acompanhamento definido/alterado" — textos
//   fixos, sem nomes. RNF04: LogAuditoria "encaminhamento registrado".
//
// Ordem das respostas de erro: 400 do id da URL -> 400 do formato do corpo
// (sem banco) -> 404 (inexistente/fora da visibilidade) -> 409 (ENCERRADO)
// -> 400 de responsável obrigatório (ABERTO sem responsável) -> 400 do
// usuário destinatário (RN03) -> 400 do responsável (RN15).
//
// Transação: tudo numa ÚNICA transação SERIALIZABLE, no padrão do POST
// /ocorrencias. O status e o responsável atuais são lidos DENTRO dela, e a
// linha da ocorrência é SEMPRE atualizada (mesmo sem mudança de valores): a
// escrita trava a linha, e um encaminhamento ou encerramento concorrente na
// mesma ocorrência aborta uma das transações (P2034), que é repetida e
// relê o status; esgotadas as tentativas, responde 409.

/** Perfis que podem encaminhar uma ocorrência já registrada (RN15, Seção 4). */
export const PERFIS_ENCAMINHAMENTO = Object.freeze(['GESTAO', 'PEDAGOGICO']);

/** Perfis aceitos como responsável pelo acompanhamento (RN15). */
export const PERFIS_RESPONSAVEL_ACOMPANHAMENTO = Object.freeze(['TUTOR', 'PEDAGOGICO', 'GESTAO']);

export const MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO =
  'Envie um objeto JSON com destinatarioPerfil e, opcionalmente, destinatarioUsuarioId, observacao e responsavelAcompanhamentoId.';
export const MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO = `Informe destinatarioPerfil com um dos valores: ${DESTINATARIOS_VALIDOS.join(', ')}.`;
export const MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_USUARIO_ID_INVALIDO =
  'Informe destinatarioUsuarioId como número inteiro positivo (ou null).';
export const MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO = 'O destinatário tutor exige destinatarioUsuarioId.';
export const MENSAGEM_RESPONSAVEL_ID_INVALIDO =
  'Informe responsavelAcompanhamentoId como número inteiro positivo (ou null).';
export const MENSAGEM_RESPONSAVEL_OBRIGATORIO =
  'Ocorrência com status aberto exige responsavelAcompanhamentoId (responsável pelo acompanhamento).';
export const MENSAGEM_RESPONSAVEL_INVALIDO =
  'O responsável pelo acompanhamento precisa ser um usuário com perfil Tutor, Pedagógico ou Gestão e status ativo.';
export const MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO = 'Ocorrência encerrada não recebe encaminhamentos.';
export const MENSAGEM_CONFLITO_CONCORRENTE_ENCAMINHAMENTO =
  'Não foi possível registrar o encaminhamento por causa de outra operação ao mesmo tempo. Tente novamente.';

/** Mensagem do 400 de usuário destinatário inválido (sem posição: um só encaminhamento). */
export function mensagemDestinatarioEncaminhamentoInvalido(destinatarioPerfil) {
  return `O usuário destinatário precisa ter perfil ${ROTULO_PERFIL_DESTINATARIO[destinatarioPerfil]} e status ativo.`;
}

/**
 * Valida e normaliza o corpo do POST /ocorrencias/{id}/encaminhamentos. Não
 * acessa o banco. responsavelAcompanhamentoId ausente ou null -> null (a
 * obrigatoriedade depende do status e é conferida na transação).
 * @param {unknown} corpo
 * @throws {ErroHttp} 400
 */
export function validarEncaminhamento(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_ENCAMINHAMENTO_INVALIDO);
  }
  const destinatario = normalizarDestinatario(corpo, {
    perfilInvalido: MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_PERFIL_INVALIDO,
    usuarioIdInvalido: MENSAGEM_ENCAMINHAMENTO_DESTINATARIO_USUARIO_ID_INVALIDO,
    tutorObrigatorio: MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO,
    campoObservacao: 'observacao',
  });
  let responsavelAcompanhamentoId = null;
  const { responsavelAcompanhamentoId: responsavel } = corpo;
  if (responsavel !== undefined && responsavel !== null) {
    if (!ehIdNumerico(responsavel)) throw new ErroHttp(400, MENSAGEM_RESPONSAVEL_ID_INVALIDO);
    responsavelAcompanhamentoId = responsavel;
  }
  return { ...destinatario, responsavelAcompanhamentoId };
}

/** RN15: o responsável existe, está ATIVO e tem perfil TUTOR, PEDAGOGICO ou GESTAO (400). */
async function garantirResponsavelValido(tx, usuarioId) {
  const usuario = await tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, perfil: true, status: true },
  });
  if (
    !usuario ||
    usuario.status !== 'ATIVO' ||
    !PERFIS_RESPONSAVEL_ACOMPANHAMENTO.includes(usuario.perfil)
  ) {
    throw new ErroHttp(400, MENSAGEM_RESPONSAVEL_INVALIDO);
  }
}

/** Grava o encaminhamento (com status, responsável, histórico e auditoria) e lê o detalhe. */
async function gravarEncaminhamento(tx, id, dados, solicitante, filtro) {
  const usuarioId = solicitante.id;

  // Releitura do estado atual DENTRO da transação, já limitada pela
  // visibilidade (RN19): inexistente e fora da visibilidade dão 404.
  const atual = await tx.ocorrencia.findFirst({
    where: { AND: [{ id }, filtro] },
    select: { id: true, status: true, responsavel_acompanhamento_id: true },
  });
  if (!atual) throw new ErroHttp(404, MENSAGEM_OCORRENCIA_NAO_ENCONTRADA);
  if (atual.status === 'ENCERRADO') {
    throw new ErroHttp(409, MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO);
  }

  const estavaAberta = atual.status === 'ABERTO';
  if (estavaAberta && dados.responsavelAcompanhamentoId === null) {
    throw new ErroHttp(400, MENSAGEM_RESPONSAVEL_OBRIGATORIO);
  }

  await garantirDestinatariosValidos(tx, [dados], (_posicao, destinatarioPerfil) =>
    mensagemDestinatarioEncaminhamentoInvalido(destinatarioPerfil),
  );

  // Responsável informado e diferente do atual -> definição ou troca. Igual
  // ao atual não é troca (não gera histórico). Em ocorrência ABERTO o
  // responsável é sempre revalidado, mesmo igual ao gravado (RN15: ativo).
  const responsavelAnterior = atual.responsavel_acompanhamento_id;
  const mudaResponsavel =
    dados.responsavelAcompanhamentoId !== null && dados.responsavelAcompanhamentoId !== responsavelAnterior;
  if (estavaAberta || mudaResponsavel) {
    await garantirResponsavelValido(tx, dados.responsavelAcompanhamentoId);
  }

  // data_hora vem do banco (@default(now()) — RN17).
  await tx.encaminhamento.create({
    data: {
      ocorrencia_id: id,
      destinatario_perfil: dados.destinatarioPerfil,
      destinatario_usuario_id: dados.destinatarioUsuarioId,
      registrado_por_id: usuarioId, // sempre o usuário logado
      observacao: dados.observacao,
    },
    select: { id: true },
  });

  // Atualização SEMPRE feita (ver comentário da seção): trava a linha da
  // ocorrência contra encaminhamento/encerramento concorrente.
  await tx.ocorrencia.update({
    where: { id },
    data: {
      status: estavaAberta ? 'EM_ACOMPANHAMENTO' : atual.status,
      responsavel_acompanhamento_id: mudaResponsavel ? dados.responsavelAcompanhamentoId : responsavelAnterior,
    },
    select: { id: true },
  });

  // RN08: textos fixos, sem dados pessoais nem conteúdo da observação.
  const historico = [
    {
      acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO,
      descricao: DESCRICAO_HISTORICO_DESTINATARIO[dados.destinatarioPerfil],
    },
  ];
  if (estavaAberta) {
    historico.push({
      acao: ACOES_HISTORICO.STATUS_ALTERADO,
      descricao: DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO,
    });
  }
  if (mudaResponsavel) {
    historico.push({
      acao:
        responsavelAnterior === null
          ? ACOES_HISTORICO.RESPONSAVEL_DEFINIDO
          : ACOES_HISTORICO.RESPONSAVEL_ALTERADO,
    });
  }
  await tx.historicoOcorrencia.createMany({
    data: historico.map((h) => ({ ocorrencia_id: id, usuario_id: usuarioId, ...h })),
  });

  await registrarAuditoria(
    {
      usuarioId,
      acao: ACOES_AUDITORIA.ENCAMINHAMENTO_REGISTRADO,
      recurso: recursoAuditoria(RECURSO_OCORRENCIAS, id),
    },
    tx,
  );

  return lerDetalheOcorrencia(tx, id, {
    codigoEscolar: solicitante.perfil === PERFIL_DADOS_COMPLETOS,
  });
}

/**
 * Registra um encaminhamento numa ocorrência já registrada (UC02, RF08, RN03,
 * RN04, RN08, RN15, RN17, RNF04).
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<object>} detalhe completo da ocorrência (formato do GET /ocorrencias/{id})
 * @throws {ErroHttp} 400 (id/corpo/destinatário/responsável inválidos),
 *   404 (inexistente ou fora da visibilidade) ou 409 (encerrada ou conflito concorrente)
 */
export async function registrarEncaminhamento(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdOcorrencia(idUrl);
  const dados = validarEncaminhamento(corpo);
  const filtro = filtroVisibilidadeOcorrencias(solicitante);

  return executarSerializavel(
    db,
    (tx) => gravarEncaminhamento(tx, id, dados, solicitante, filtro),
    MENSAGEM_CONFLITO_CONCORRENTE_ENCAMINHAMENTO,
  );
}

// ---------------------------------------------------------------------------
// Comunicação: POST /ocorrencias/{id}/comunicacoes (Issue #51, UC02 passo 3)
// ---------------------------------------------------------------------------
//
// - Contrato (Seção 12): { destinatario, meio, descricao, dataHora }, todos
//   obrigatórios; responde 201 com o DETALHE COMPLETO da ocorrência (decisão
//   do Rafael, mesmo padrão da #49), no formato do GET /ocorrencias/{id}, já
//   com a nova comunicação (codigoEscolar só para a Gestão — RN20). Campos
//   fora do contrato (ex.: registradoPorId, status) são ignorados.
// - Permissão (Seção 4, RN16): TUTOR, GESTAO e PEDAGOGICO (na rota); o Tutor
//   só nas ocorrências que pode visualizar (RN19 — filtroVisibilidadeOcorrencias
//   na própria consulta; fora dela, 404 igual à inexistente).
// - RN16: a comunicação é feita FORA do sistema e só registrada aqui; o
//   sistema não envia notificações (Seção 5). destinatario e meio são texto
//   livre (NFC + trim, até 150 caracteres — decisão do Rafael, como o local da
//   #45); descricao até 5000. Ocorrência ENCERRADO responde 409; ABERTO e
//   EM_ACOMPANHAMENTO aceitam e o status NÃO muda.
// - RN17: dataHora (momento do contato) informada pelo usuário, ISO 8601 com
//   fuso obrigatório, até 5 minutos à frente do relógio do servidor.
// - registrado_por_id é sempre o usuário logado.
// - RN08: histórico "comunicação registrada", sem descrição e SEM o conteúdo
//   da comunicação (destinatário, meio, descrição). RNF04: LogAuditoria
//   "comunicação registrada", recurso "ocorrencias/<id>".
//
// Ordem das respostas de erro: 400 do id da URL -> 400 do corpo (sem banco;
// na ordem destinatario, meio, descricao, dataHora — formato e depois data
// futura) -> 404 (inexistente/fora da visibilidade) -> 409 (ENCERRADO) ->
// 409 (conflito concorrente esgotado).
//
// Transação: ÚNICA e SERIALIZABLE (executarSerializavel). O status é relido
// DENTRO dela e a linha da ocorrência é SEMPRE atualizada (com o mesmo
// status), como no encaminhamento: a escrita trava a linha, e um
// encerramento concorrente aborta uma das transações (P2034), que é repetida
// e relê o status.

/** Perfis que podem registrar comunicação (Seção 4, RN16). */
export const PERFIS_COMUNICACAO = Object.freeze(['TUTOR', 'GESTAO', 'PEDAGOGICO']);

/** Limite de destinatario e meio da comunicação (decisão do Rafael, Issue #51). */
export const TAMANHO_MAXIMO_DESTINATARIO_MEIO = 150;

export const MENSAGEM_CORPO_COMUNICACAO_INVALIDO =
  'Envie um objeto JSON com destinatario, meio, descricao e dataHora.';
export const MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO = 'Informe destinatario (texto não vazio).';
export const MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO = `O destinatario deve ter no máximo ${TAMANHO_MAXIMO_DESTINATARIO_MEIO} caracteres.`;
export const MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO = 'Informe meio (texto não vazio).';
export const MENSAGEM_COMUNICACAO_MEIO_LONGO = `O meio deve ter no máximo ${TAMANHO_MAXIMO_DESTINATARIO_MEIO} caracteres.`;
export const MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA = 'A data e hora da comunicação não pode estar no futuro.';
export const MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO = 'Ocorrência encerrada não recebe comunicações.';
export const MENSAGEM_CONFLITO_CONCORRENTE_COMUNICACAO =
  'Não foi possível registrar a comunicação por causa de outra operação ao mesmo tempo. Tente novamente.';

/**
 * Valida e normaliza o corpo do POST /ocorrencias/{id}/comunicacoes. Não
 * acessa o banco.
 * @param {unknown} corpo
 * @param {object} [opcoes]
 * @param {() => Date} [opcoes.agora] relógio do servidor (injetável em testes)
 * @returns {{ destinatario: string, meio: string, descricao: string, dataHora: Date }}
 * @throws {ErroHttp} 400
 */
export function validarComunicacao(corpo, { agora = () => new Date() } = {}) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_COMUNICACAO_INVALIDO);
  }
  const destinatario = textoObrigatorio(
    corpo.destinatario,
    TAMANHO_MAXIMO_DESTINATARIO_MEIO,
    MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO,
    MENSAGEM_COMUNICACAO_DESTINATARIO_LONGO,
  );
  const meio = textoObrigatorio(
    corpo.meio,
    TAMANHO_MAXIMO_DESTINATARIO_MEIO,
    MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO,
    MENSAGEM_COMUNICACAO_MEIO_LONGO,
  );
  const descricao = textoObrigatorio(
    corpo.descricao,
    TAMANHO_MAXIMO_TEXTO_LONGO,
    MENSAGEM_DESCRICAO_OBRIGATORIA,
    mensagemTextoLongo('descricao'),
  );
  const dataHora = converterDataHora(corpo.dataHora);
  garantirNaoFutura(dataHora, agora, MENSAGEM_DATA_HORA_COMUNICACAO_FUTURA);
  return { destinatario, meio, descricao, dataHora };
}

/** Grava a comunicação (com histórico e auditoria) e lê o detalhe. */
async function gravarComunicacao(tx, id, dados, solicitante, filtro) {
  const usuarioId = solicitante.id;

  // Releitura do status DENTRO da transação, já limitada pela visibilidade
  // (RN19): inexistente e fora da visibilidade dão 404.
  const atual = await tx.ocorrencia.findFirst({
    where: { AND: [{ id }, filtro] },
    select: { id: true, status: true },
  });
  if (!atual) throw new ErroHttp(404, MENSAGEM_OCORRENCIA_NAO_ENCONTRADA);
  if (atual.status === 'ENCERRADO') {
    throw new ErroHttp(409, MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO);
  }

  await tx.comunicacao.create({
    data: {
      ocorrencia_id: id,
      destinatario: dados.destinatario,
      meio: dados.meio,
      descricao: dados.descricao,
      registrado_por_id: usuarioId, // sempre o usuário logado
      data_hora: dados.dataHora, // momento do contato, informado (RN17)
    },
    select: { id: true },
  });

  // Atualização SEMPRE feita, com o MESMO status (a comunicação não muda o
  // status): trava a linha contra encaminhamento/encerramento concorrente.
  await tx.ocorrencia.update({
    where: { id },
    data: { status: atual.status },
    select: { id: true },
  });

  // RN08: texto fixo, sem o conteúdo da comunicação nem dados pessoais.
  await tx.historicoOcorrencia.create({
    data: { ocorrencia_id: id, usuario_id: usuarioId, acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA },
    select: { id: true },
  });

  await registrarAuditoria(
    {
      usuarioId,
      acao: ACOES_AUDITORIA.COMUNICACAO_REGISTRADA,
      recurso: recursoAuditoria(RECURSO_OCORRENCIAS, id),
    },
    tx,
  );

  return lerDetalheOcorrencia(tx, id, {
    codigoEscolar: solicitante.perfil === PERFIL_DADOS_COMPLETOS,
  });
}

/**
 * Registra uma comunicação feita fora do sistema numa ocorrência (UC02, RF09,
 * RN08, RN16, RN17, RN19, RNF04).
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {() => Date} [deps.agora] relógio do servidor (injetável em testes)
 * @returns {Promise<object>} detalhe completo da ocorrência (formato do GET /ocorrencias/{id})
 * @throws {ErroHttp} 400 (id/corpo/data inválidos), 404 (inexistente ou fora
 *   da visibilidade) ou 409 (encerrada ou conflito concorrente)
 */
export async function registrarComunicacao(
  idUrl,
  corpo,
  solicitante,
  { db = prisma, agora = () => new Date() } = {},
) {
  const id = validarIdOcorrencia(idUrl);
  const dados = validarComunicacao(corpo, { agora });
  const filtro = filtroVisibilidadeOcorrencias(solicitante);

  return executarSerializavel(
    db,
    (tx) => gravarComunicacao(tx, id, dados, solicitante, filtro),
    MENSAGEM_CONFLITO_CONCORRENTE_COMUNICACAO,
  );
}

// ---------------------------------------------------------------------------
// Providência: POST /ocorrencias/{id}/providencias (Issue #81, UC04 passo 2)
// ---------------------------------------------------------------------------
//
// - Contrato (Seção 12, SSD 1.8): { descricao }, obrigatória; responde 201
//   com o DETALHE COMPLETO da ocorrência, no formato do GET /ocorrencias/{id},
//   já com a nova providência (codigoEscolar só para a Gestão — RN20). Campos
//   fora do contrato (ex.: registradoPorId, dataHora, status) são ignorados.
// - Permissão (Seção 4, RN22): na rota, GESTAO, PEDAGOGICO e TUTOR (Professor
//   e Técnico-administrativo recebem 403). No service, o Tutor só registra se
//   for o RESPONSÁVEL PELO ACOMPANHAMENTO (responsavel_acompanhamento_id = ele);
//   se vê a ocorrência (RN19) mas não é o responsável, recebe 403. Gestão e
//   Pedagógico registram em qualquer ocorrência.
// - Visibilidade (RN19): inexistente ou fora da visibilidade -> 404 com a
//   mesma mensagem (filtroVisibilidadeOcorrencias na própria consulta). A
//   visibilidade vem antes do 403 (decisão do Rafael, 12/11/2026).
// - RN04: só com a ocorrência em EM_ACOMPANHAMENTO; ABERTO ou ENCERRADO ->
//   409. O registro da providência NÃO muda o status.
// - Texto (Seção 11): NFC, sem espaços nas pontas, não vazio, até 5000
//   caracteres (UTF-16); U+0000 recusado (400).
// - RN17: registrado_por_id é o usuário logado e data_hora vem do banco
//   (@default(now()) — momento do registro).
// - RN08: histórico "providência registrada", descrição nula, SEM o conteúdo
//   da providência. RNF04: LogAuditoria "providência registrada", recurso
//   "ocorrencias/<id>", sem dados pessoais.
//
// Ordem das respostas de erro: 400 do id da URL -> 400 do corpo (sem banco)
// -> 404 (inexistente/fora da visibilidade) -> 403 (Tutor que não é o
// responsável) -> 409 (ABERTO/ENCERRADO) -> 409 (conflito concorrente esgotado).
//
// Transação: ÚNICA e SERIALIZABLE (executarSerializavel). Status e
// responsável são relidos DENTRO dela e a linha da ocorrência é SEMPRE
// atualizada (com o mesmo status), como no encaminhamento e na comunicação: a
// escrita trava a linha, e um encaminhamento (troca do responsável) ou
// encerramento concorrente aborta uma das transações (P2034), que é repetida
// e relê o estado.
//
// O 409 de status ainda não traz o campo `codigo` estável (Seção 12, v1.8):
// ele depende do padrão da Issue #72 (D1), ainda não implementado.

/** Perfis que podem registrar providência (Seção 4, RN22); o Tutor só se for o responsável. */
export const PERFIS_PROVIDENCIA = Object.freeze(['GESTAO', 'PEDAGOGICO', 'TUTOR']);

/** Mesmo texto do 403 por perfil do middleware (RN01/RF14). */
export const MENSAGEM_PROVIDENCIA_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
export const MENSAGEM_CORPO_PROVIDENCIA_INVALIDO = 'Envie um objeto JSON com descricao.';
export const MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA =
  'A providência só pode ser registrada com a ocorrência em acompanhamento. Esta ocorrência ainda está aberta.';
export const MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA = 'Ocorrência encerrada não recebe providências.';
export const MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA =
  'Não foi possível registrar a providência por causa de outra operação ao mesmo tempo. Tente novamente.';

/**
 * Valida e normaliza o corpo do POST /ocorrencias/{id}/providencias. Não
 * acessa o banco.
 * @param {unknown} corpo
 * @returns {{ descricao: string }}
 * @throws {ErroHttp} 400
 */
export function validarProvidencia(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_PROVIDENCIA_INVALIDO);
  }
  const descricao = textoObrigatorio(
    corpo.descricao,
    TAMANHO_MAXIMO_TEXTO_LONGO,
    MENSAGEM_DESCRICAO_OBRIGATORIA,
    mensagemTextoLongo('descricao'),
  );
  return { descricao };
}

/** Grava a providência (com histórico e auditoria) e lê o detalhe. */
async function gravarProvidencia(tx, id, dados, solicitante, filtro) {
  const usuarioId = solicitante.id;

  // Releitura do status e do responsável DENTRO da transação, já limitada
  // pela visibilidade (RN19): inexistente e fora da visibilidade dão 404.
  const atual = await tx.ocorrencia.findFirst({
    where: { AND: [{ id }, filtro] },
    select: { id: true, status: true, responsavel_acompanhamento_id: true },
  });
  if (!atual) throw new ErroHttp(404, MENSAGEM_OCORRENCIA_NAO_ENCONTRADA);

  // RN22: o Tutor que vê a ocorrência só registra se for o responsável.
  if (solicitante.perfil === 'TUTOR' && atual.responsavel_acompanhamento_id !== usuarioId) {
    throw new ErroHttp(403, MENSAGEM_PROVIDENCIA_SEM_PERMISSAO);
  }

  // RN04: só em EM_ACOMPANHAMENTO.
  if (atual.status === 'ABERTO') throw new ErroHttp(409, MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA);
  if (atual.status === 'ENCERRADO') throw new ErroHttp(409, MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA);

  // data_hora vem do banco (@default(now()) — RN17).
  await tx.providencia.create({
    data: {
      ocorrencia_id: id,
      descricao: dados.descricao,
      registrado_por_id: usuarioId, // sempre o usuário logado
    },
    select: { id: true },
  });

  // Atualização SEMPRE feita, com o MESMO status (a providência não muda o
  // status): trava a linha contra encaminhamento/encerramento concorrente.
  await tx.ocorrencia.update({
    where: { id },
    data: { status: atual.status },
    select: { id: true },
  });

  // RN08: texto fixo, sem o conteúdo da providência nem dados pessoais.
  await tx.historicoOcorrencia.create({
    data: { ocorrencia_id: id, usuario_id: usuarioId, acao: ACOES_HISTORICO.PROVIDENCIA_REGISTRADA },
    select: { id: true },
  });

  await registrarAuditoria(
    {
      usuarioId,
      acao: ACOES_AUDITORIA.PROVIDENCIA_REGISTRADA,
      recurso: recursoAuditoria(RECURSO_OCORRENCIAS, id),
    },
    tx,
  );

  return lerDetalheOcorrencia(tx, id, {
    codigoEscolar: solicitante.perfil === PERFIL_DADOS_COMPLETOS,
  });
}

/**
 * Registra uma providência adotada numa ocorrência em acompanhamento (UC04,
 * RF12, RF14, RN04, RN08, RN17, RN19, RN22, RNF04).
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number, perfil: string }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<object>} detalhe completo da ocorrência (formato do GET /ocorrencias/{id})
 * @throws {ErroHttp} 400 (id/corpo inválidos), 404 (inexistente ou fora da
 *   visibilidade), 403 (Tutor que não é o responsável) ou 409 (status
 *   diferente de em acompanhamento ou conflito concorrente)
 */
export async function registrarProvidencia(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdOcorrencia(idUrl);
  const dados = validarProvidencia(corpo);
  const filtro = filtroVisibilidadeOcorrencias(solicitante);

  return executarSerializavel(
    db,
    (tx) => gravarProvidencia(tx, id, dados, solicitante, filtro),
    MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA,
  );
}
