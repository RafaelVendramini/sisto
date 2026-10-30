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
});

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

// Sem código escolar: a resposta é a mesma para todos os perfis (RN20).
const SELECAO_ESTUDANTES_RESPOSTA = Object.freeze({
  estudante: { select: { id: true, nome_completo: true, turma: { select: SELECAO_TURMA_RESUMO } } },
});

const SELECAO_ENCAMINHAMENTO_RESPOSTA = Object.freeze({
  id: true,
  destinatario_perfil: true,
  destinatario_usuario: { select: { id: true, nome: true, perfil: true } },
  registrado_por: { select: { id: true, nome: true } },
  data_hora: true,
  observacao: true,
});

/** Lê a ocorrência gravada, com estudantes e encaminhamentos, para a resposta. */
async function lerOcorrenciaParaResposta(tx, id) {
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
    select: SELECAO_ESTUDANTES_RESPOSTA,
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

/** Texto obrigatório: NFC, sem espaços nas pontas, não vazio, até `maximo`. */
function textoObrigatorio(valor, maximo, mensagemObrigatorio, mensagemLongo) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErroHttp(400, mensagemObrigatorio);
  }
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
    const { destinatarioPerfil, destinatarioUsuarioId, observacao } = item;
    if (typeof destinatarioPerfil !== 'string' || !DESTINATARIOS_VALIDOS.includes(destinatarioPerfil)) {
      throw new ErroHttp(400, mensagemDestinatarioPerfilInvalido(posicao));
    }
    let usuarioId = null;
    if (destinatarioUsuarioId !== undefined && destinatarioUsuarioId !== null) {
      if (!ehIdNumerico(destinatarioUsuarioId)) {
        throw new ErroHttp(400, mensagemDestinatarioUsuarioIdInvalido(posicao));
      }
      usuarioId = destinatarioUsuarioId;
    }
    if (destinatarioPerfil === 'TUTOR' && usuarioId === null) {
      throw new ErroHttp(400, mensagemTutorObrigatorio(posicao));
    }
    return {
      destinatarioPerfil,
      destinatarioUsuarioId: usuarioId,
      observacao: textoOpcional(observacao, `observacao do encaminhamento ${posicao}`),
    };
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
  if (dataHora.getTime() > agora().getTime() + TOLERANCIA_FUTURO_MS) {
    throw new ErroHttp(400, MENSAGEM_DATA_HORA_FUTURA);
  }

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

/** RN03: o usuário destinatário, quando informado, tem o perfil certo e está ATIVO. */
async function garantirDestinatariosValidos(tx, encaminhamentos) {
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
      throw new ErroHttp(400, mensagemDestinatarioInvalido(indice + 1, encaminhamento.destinatarioPerfil));
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

  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction((tx) => gravarOcorrencia(tx, dados, usuarioId), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (erro) {
      if (erro instanceof ErroHttp) throw erro;
      if (erro?.code === 'P2034') {
        if (tentativa < TENTATIVAS_TRANSACAO) continue;
        throw new ErroHttp(409, MENSAGEM_CONFLITO_CONCORRENTE_OCORRENCIA);
      }
      throw erro;
    }
  }
}
