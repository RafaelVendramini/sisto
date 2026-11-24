// Cadastro, listagem e edição de estudantes, com vínculo ao professor tutor —
// Sisto (Issue #42).
//
// - RF15: cadastro e edição de estudantes (Seção 12: GET, POST e PUT /estudantes).
// - RF16 / RN13: vínculo do estudante a um tutor. Só pode ser vinculado um
//   usuário com perfil TUTOR e status ATIVO no momento do vínculo; senão 400.
//   Se o tutor for bloqueado/desativado depois, o vínculo continua gravado e a
//   Gestão vê o status do tutor. `tutorId: null` no PUT desvincula.
// - Contrato (Seção 12): POST e PUT recebem
//   { nomeCompleto, codigoEscolar?, turmaId, tutorId? }. A API usa camelCase e o
//   banco snake_case (Seção 11). Números chegam como número JSON (texto é
//   recusado), no mesmo padrão de /turmas.
// - RN18: codigoEscolar é opcional; texto vazio (ou só espaços) vira null; é
//   único quando informado (índice único no banco + checagem aqui); duplicado
//   responde 409. O nome do estudante pode se repetir.
// - RN20: GET para todos os perfis. Quem não é Gestão recebe só id, nomeCompleto,
//   turma e tutor ({ id, nome } ou null) — sem codigoEscolar, sem e-mail e sem
//   status do tutor. Os campos restritos nem são lidos do banco nesse caso.
// - RN14 / RN21: trocar a turma é permitido e não mexe em ocorrências (a
//   ocorrência guarda a própria turma de referência). Não há DELETE.
// - RNF04 / RNF06: criação e edição gravam LogAuditoria com recurso
//   "estudantes/<id>", na mesma transação, sem nome nem código do estudante.
//
// Concorrência: como em services/turmas.js, leitura, checagens, gravação e
// auditoria rodam numa transação SERIALIZABLE; conflito de serialização
// (P2034) é repetido e, esgotadas as tentativas, responde 409 (helper
// lib/transacao.js).
import prisma from '../lib/prisma.js';
import { CODIGOS_ERRO, ErroHttp } from '../lib/erros.js';
import { converterIdTexto, ehIdNumerico } from '../lib/ids.js';
import { garantirSemCaractereNulo } from '../lib/texto.js';
import { emTransacaoSerializavel } from '../lib/transacao.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';
import { paraRespostaTurma } from './turmas.js';

/** Nome do recurso na API, usado no LogAuditoria ("estudantes/<id>"). */
export const RECURSO_ESTUDANTES = 'estudantes';

/**
 * Limites TÉCNICOS defensivos (após trim), no mesmo padrão de turmas e
 * categorias (decisão do Rafael: 150 caracteres em textos curtos). Não são
 * regras de negócio do SSD.
 */
export const TAMANHO_MAXIMO_NOME_ESTUDANTE = 150;
export const TAMANHO_MAXIMO_CODIGO_ESCOLAR = 150;

export const MENSAGEM_CORPO_ESTUDANTE_INVALIDO =
  'Envie um objeto JSON com nomeCompleto, turmaId e, opcionalmente, codigoEscolar e tutorId.';
export const MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO = 'Informe nomeCompleto (texto não vazio).';
export const MENSAGEM_NOME_ESTUDANTE_LONGO = `O nome completo deve ter no máximo ${TAMANHO_MAXIMO_NOME_ESTUDANTE} caracteres.`;
export const MENSAGEM_CODIGO_ESCOLAR_INVALIDO = 'Informe codigoEscolar como texto (ou null).';
export const MENSAGEM_CODIGO_ESCOLAR_LONGO = `O código escolar deve ter no máximo ${TAMANHO_MAXIMO_CODIGO_ESCOLAR} caracteres.`;
export const MENSAGEM_TURMA_ID_INVALIDO = 'Informe turmaId como número inteiro positivo.';
export const MENSAGEM_TURMA_INEXISTENTE = 'A turma informada não existe.';
export const MENSAGEM_TUTOR_ID_INVALIDO = 'Informe tutorId como número inteiro positivo (ou null).';
export const MENSAGEM_TUTOR_INVALIDO =
  'O tutor informado precisa ser um usuário com perfil Tutor e status ativo.';
export const MENSAGEM_CODIGO_ESCOLAR_DUPLICADO =
  'Já existe um estudante cadastrado com este código escolar.';
export const MENSAGEM_ID_ESTUDANTE_INVALIDO = 'Identificador de estudante inválido.';
export const MENSAGEM_ESTUDANTE_NAO_ENCONTRADO = 'Estudante não encontrado.';
export const MENSAGEM_FILTRO_TURMA_INVALIDO =
  'O filtro turmaId deve ser um número inteiro positivo.';
export const MENSAGEM_CONFLITO_CONCORRENTE_ESTUDANTE =
  'O estudante foi alterado por outra operação ao mesmo tempo. Tente novamente.';

const SELECAO_TURMA_RESUMO = Object.freeze({ id: true, nome: true, etapa: true, ano_letivo: true });

/** Gestão: todos os campos, inclusive código escolar e e-mail/status do tutor. */
const SELECAO_ESTUDANTE_COMPLETA = Object.freeze({
  id: true,
  nome_completo: true,
  codigo_escolar: true,
  turma: { select: SELECAO_TURMA_RESUMO },
  tutor: { select: { id: true, nome: true, email: true, status: true } },
});

/** Demais perfis (RN20): sem código escolar; tutor só com id e nome. */
const SELECAO_ESTUDANTE_REDUZIDA = Object.freeze({
  id: true,
  nome_completo: true,
  turma: { select: SELECAO_TURMA_RESUMO },
  tutor: { select: { id: true, nome: true } },
});

/** Perfil que recebe os dados completos de estudantes (RN20). */
const PERFIL_DADOS_COMPLETOS = 'GESTAO';

/**
 * Resposta completa (Gestão; também usada no 201/200 de POST/PUT, que só a
 * Gestão acessa).
 */
export function paraRespostaEstudanteCompleta({ id, nome_completo, codigo_escolar, turma, tutor }) {
  return {
    id,
    nomeCompleto: nome_completo,
    codigoEscolar: codigo_escolar,
    turma: paraRespostaTurma(turma),
    tutor: tutor ? { id: tutor.id, nome: tutor.nome, email: tutor.email, status: tutor.status } : null,
  };
}

/** Resposta reduzida para quem não é Gestão (RN20). */
export function paraRespostaEstudanteReduzida({ id, nome_completo, turma, tutor }) {
  return {
    id,
    nomeCompleto: nome_completo,
    turma: paraRespostaTurma(turma),
    tutor: tutor ? { id: tutor.id, nome: tutor.nome } : null,
  };
}

/** Normaliza um código escolar para gravação/comparação: NFC e sem espaços nas pontas. */
export function normalizarCodigoEscolar(codigo) {
  return codigo.normalize('NFC').trim();
}

/**
 * Valida e normaliza o corpo do POST e do PUT /estudantes.
 * - nomeCompleto: obrigatório, texto não vazio após trim (NFC), até 150.
 * - turmaId: obrigatório, número inteiro positivo (texto recusado).
 * - codigoEscolar: opcional. null ou texto vazio/só espaços -> null; texto ->
 *   sem espaços nas pontas, até 150. Ausente (undefined) é devolvido como
 *   undefined: no POST grava null; no PUT mantém o valor atual.
 * - tutorId: opcional. null desvincula; número inteiro positivo vincula.
 *   Ausente (undefined): no POST fica sem tutor; no PUT mantém o vínculo atual.
 * Outros campos (id, turma_id etc.) são ignorados.
 * @param {unknown} corpo
 * @returns {{ nomeCompleto: string, turmaId: number, codigoEscolar?: string | null, tutorId?: number | null }}
 * @throws {ErroHttp} 400
 */
export function validarEstudante(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, MENSAGEM_CORPO_ESTUDANTE_INVALIDO);
  }

  const { nomeCompleto, codigoEscolar, turmaId, tutorId } = corpo;

  if (typeof nomeCompleto !== 'string' || nomeCompleto.trim() === '') {
    throw new ErroHttp(400, MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO);
  }
  // U+0000: o PostgreSQL não grava (400, não 500 — Issue #127).
  garantirSemCaractereNulo(nomeCompleto);
  const nomeLimpo = nomeCompleto.normalize('NFC').trim();
  if (nomeLimpo.length > TAMANHO_MAXIMO_NOME_ESTUDANTE) {
    throw new ErroHttp(400, MENSAGEM_NOME_ESTUDANTE_LONGO);
  }

  if (!ehIdNumerico(turmaId)) {
    throw new ErroHttp(400, MENSAGEM_TURMA_ID_INVALIDO);
  }

  const dados = { nomeCompleto: nomeLimpo, turmaId };

  if (codigoEscolar === null) {
    dados.codigoEscolar = null;
  } else if (codigoEscolar !== undefined) {
    if (typeof codigoEscolar !== 'string') {
      throw new ErroHttp(400, MENSAGEM_CODIGO_ESCOLAR_INVALIDO);
    }
    garantirSemCaractereNulo(codigoEscolar);
    const codigoLimpo = normalizarCodigoEscolar(codigoEscolar);
    if (codigoLimpo.length > TAMANHO_MAXIMO_CODIGO_ESCOLAR) {
      throw new ErroHttp(400, MENSAGEM_CODIGO_ESCOLAR_LONGO);
    }
    dados.codigoEscolar = codigoLimpo === '' ? null : codigoLimpo;
  }

  if (tutorId === null) {
    dados.tutorId = null;
  } else if (tutorId !== undefined) {
    if (!ehIdNumerico(tutorId)) {
      throw new ErroHttp(400, MENSAGEM_TUTOR_ID_INVALIDO);
    }
    dados.tutorId = tutorId;
  }

  return dados;
}

/** Valida o id da URL de PUT /estudantes/{id}. */
export function validarIdEstudante(valor) {
  return converterIdTexto(valor, MENSAGEM_ID_ESTUDANTE_INVALIDO);
}

/**
 * Valida o filtro ?turmaId= do GET. Ausente: sem filtro. Repetido
 * (?turmaId=1&turmaId=2), vazio ou fora do formato: 400.
 * @param {unknown} valor req.query.turmaId
 * @returns {number | undefined}
 */
export function validarFiltroTurma(valor) {
  if (valor === undefined) return undefined;
  return converterIdTexto(valor, MENSAGEM_FILTRO_TURMA_INVALIDO);
}

async function garantirTurmaExiste(tx, turmaId) {
  const turma = await tx.turma.findUnique({ where: { id: turmaId }, select: { id: true } });
  if (!turma) throw new ErroHttp(400, MENSAGEM_TURMA_INEXISTENTE);
}

/** RN13: no momento do vínculo, o usuário precisa ser TUTOR e estar ATIVO. */
async function garantirTutorVinculavel(tx, tutorId) {
  const usuario = await tx.usuario.findUnique({
    where: { id: tutorId },
    select: { id: true, perfil: true, status: true },
  });
  if (!usuario || usuario.perfil !== 'TUTOR' || usuario.status !== 'ATIVO') {
    throw new ErroHttp(400, MENSAGEM_TUTOR_INVALIDO);
  }
}

/** RN18: recusa (409) código escolar já usado por outro estudante. */
async function garantirCodigoDisponivel(tx, codigoEscolar, idIgnorado) {
  if (codigoEscolar === null || codigoEscolar === undefined) return;
  const existente = await tx.estudante.findUnique({
    where: { codigo_escolar: codigoEscolar },
    select: { id: true },
  });
  if (existente && existente.id !== idIgnorado) {
    throw new ErroHttp(409, MENSAGEM_CODIGO_ESCOLAR_DUPLICADO, {
      codigo: CODIGOS_ERRO.CODIGO_ESCOLAR_DUPLICADO,
    });
  }
}

/**
 * Transação SERIALIZABLE das gravações de estudante (lib/transacao.js).
 * Violação do índice único (P2002, só codigo_escolar é único em estudantes)
 * vira 409 de duplicidade.
 */
function emTransacaoEstudante(db, operacao) {
  return emTransacaoSerializavel(db, operacao, {
    mensagemConflito: MENSAGEM_CONFLITO_CONCORRENTE_ESTUDANTE,
    traduzirErro: (erro) =>
      erro?.code === 'P2002'
        ? new ErroHttp(409, MENSAGEM_CODIGO_ESCOLAR_DUPLICADO, {
            codigo: CODIGOS_ERRO.CODIGO_ESCOLAR_DUPLICADO,
          })
        : undefined,
  });
}

/**
 * Lista estudantes ordenados por nome completo (e id, para ordem estável),
 * opcionalmente só de uma turma. Turma inexistente no filtro devolve lista
 * vazia. O formato depende do perfil de quem consulta (RN20).
 * @param {{ perfil: string }} solicitante req.usuario
 * @param {{ turmaId?: unknown }} [query] req.query
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 */
export async function listarEstudantes(solicitante, query = {}, { db = prisma } = {}) {
  const turmaId = validarFiltroTurma(query?.turmaId);
  const completo = solicitante?.perfil === PERFIL_DADOS_COMPLETOS;

  const estudantes = await db.estudante.findMany({
    ...(turmaId !== undefined ? { where: { turma_id: turmaId } } : {}),
    select: completo ? SELECAO_ESTUDANTE_COMPLETA : SELECAO_ESTUDANTE_REDUZIDA,
    orderBy: [{ nome_completo: 'asc' }, { id: 'asc' }],
  });

  return estudantes.map(completo ? paraRespostaEstudanteCompleta : paraRespostaEstudanteReduzida);
}

/**
 * Cadastra um estudante (RF15, RF16, RN13, RN18) e registra a auditoria (RNF04).
 * @param {unknown} corpo
 * @param {{ id: number }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @throws {ErroHttp} 400 (dados/turma/tutor inválidos) ou 409 (código duplicado / conflito)
 */
export async function criarEstudante(corpo, solicitante, { db = prisma } = {}) {
  const { nomeCompleto, turmaId, codigoEscolar = null, tutorId = null } = validarEstudante(corpo);

  return emTransacaoEstudante(db, async (tx) => {
    await garantirTurmaExiste(tx, turmaId);
    if (tutorId !== null) await garantirTutorVinculavel(tx, tutorId);
    await garantirCodigoDisponivel(tx, codigoEscolar);

    const estudante = await tx.estudante.create({
      data: {
        nome_completo: nomeCompleto,
        codigo_escolar: codigoEscolar,
        turma_id: turmaId,
        tutor_id: tutorId,
      },
      select: SELECAO_ESTUDANTE_COMPLETA,
    });
    await registrarAuditoria(
      {
        usuarioId: solicitante?.id ?? null,
        acao: ACOES_AUDITORIA.ESTUDANTE_CRIADO,
        recurso: recursoAuditoria(RECURSO_ESTUDANTES, estudante.id),
      },
      tx,
    );
    return paraRespostaEstudanteCompleta(estudante);
  });
}

/**
 * Edita um estudante (RF15, RF16, RN13, RN14, RN18, RN21) e registra a
 * auditoria (RNF04).
 * - Trocar a turma só altera o estudante; ocorrências já registradas guardam a
 *   própria turma de referência e não são tocadas (RN14).
 * - tutorId: null desvincula; outro id vincula/troca (exige TUTOR ATIVO —
 *   RN13); o MESMO id já vinculado não é um novo vínculo e é mantido sem nova
 *   checagem (o vínculo com tutor bloqueado/desativado depois continua
 *   gravado — RN13/RN07); ausente mantém o vínculo atual.
 * - codigoEscolar ausente mantém o atual; null ou vazio limpa.
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo
 * @param {{ id: number }} solicitante req.usuario
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @throws {ErroHttp} 400, 404 ou 409
 */
export async function atualizarEstudante(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdEstudante(idUrl);
  const dados = validarEstudante(corpo);

  try {
    return await emTransacaoEstudante(db, async (tx) => {
      const atual = await tx.estudante.findUnique({
        where: { id },
        select: { id: true, tutor_id: true },
      });
      if (!atual) throw new ErroHttp(404, MENSAGEM_ESTUDANTE_NAO_ENCONTRADO);

      await garantirTurmaExiste(tx, dados.turmaId);
      if (
        dados.tutorId !== undefined &&
        dados.tutorId !== null &&
        dados.tutorId !== atual.tutor_id
      ) {
        await garantirTutorVinculavel(tx, dados.tutorId);
      }
      await garantirCodigoDisponivel(tx, dados.codigoEscolar, id);

      const data = { nome_completo: dados.nomeCompleto, turma_id: dados.turmaId };
      if (dados.codigoEscolar !== undefined) data.codigo_escolar = dados.codigoEscolar;
      if (dados.tutorId !== undefined) data.tutor_id = dados.tutorId;

      const estudante = await tx.estudante.update({
        where: { id },
        data,
        select: SELECAO_ESTUDANTE_COMPLETA,
      });
      await registrarAuditoria(
        {
          usuarioId: solicitante?.id ?? null,
          acao: ACOES_AUDITORIA.ESTUDANTE_EDITADO,
          recurso: recursoAuditoria(RECURSO_ESTUDANTES, estudante.id),
        },
        tx,
      );
      return paraRespostaEstudanteCompleta(estudante);
    });
  } catch (erro) {
    // Registro inexistente no update (ex.: removido direto no banco).
    if (erro?.code === 'P2025') throw new ErroHttp(404, MENSAGEM_ESTUDANTE_NAO_ENCONTRADO);
    throw erro;
  }
}
