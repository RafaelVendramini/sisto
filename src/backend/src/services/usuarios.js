// Cadastro, listagem e edição de usuários — Sisto (Issues #12 e #13).
//
// - RF01: cadastro de usuários autorizados com perfil e senha temporária.
// - RN10 (SSD v1.6, Issue #37): senha temporária com no mínimo 8 caracteres,
//   definida pela Gestão; o usuário é criado com troca_senha_obrigatoria =
//   true e precisa trocá-la no primeiro login (fluxo de PUT /conta/senha da
//   #18). Usuários já cadastrados não são alterados.
// - RNF03: senha armazenada somente como hash bcrypt.
// - RN07: o usuário é sempre criado com status ATIVO.
// - RNF06: nenhuma resposta inclui senha_hash (select explícito); nada de
//   senha ou e-mail em mensagens de erro ou logs.
// - RN01: cadastrar e editar são restritos a GESTAO nas rotas (permitirPerfis).
// - RN20 (Issue #44): GET /usuarios é aberto aos 6 perfis; quem não é Gestão
//   recebe só id, nome e perfil dos usuários ATIVOS que podem ser
//   destinatários (TUTOR, PSICOLOGO — v1.18, PEDAGOGICO, GESTAO), sem e-mail
//   e sem status.
// - Perfil PSICOLOGO (SSD 1.18, Issue #153): cadastrado pela Gestão como os
//   demais; não conta para a RN11 (só GESTAO conta) e não pode ser
//   responsável pelo acompanhamento (RN23, abaixo). A mudança de perfil de um
//   psicólogo que é destinatário de encaminhamentos NÃO é recusada (RN24): só
//   valem as RN13 e RN23.
//
// Edição, bloqueio, desativação e reativação (Issue #13):
// - RF04 / RN07: status ATIVO, BLOQUEADO ou DESATIVADO; reativar = voltar a
//   ATIVO. O usuário nunca é excluído (não há DELETE).
// - RN09: o corte imediato do acesso vem do middleware de autenticação (#11),
//   que consulta o status no banco a cada requisição.
// - RN11 (SSD v1.6, Issue #37): o sistema mantém sempre ao menos DOIS
//   usuários GESTAO com status ATIVO (um pode redefinir a senha do outro).
//   Nenhuma edição pode reduzir esse número a menos de dois; a Gestão também
//   não bloqueia, desativa nem altera o próprio perfil (409). Desde a Issue
//   #149, só conta como Gestão ativa quem já trocou a senha temporária
//   (troca_senha_obrigatoria = false). A redefinição de senha entre Gestões
//   (troca-senha.js) continua permitida (decisão do Rafael, 23/11/2026).
// - RN13 (Issue #44): o perfil de um usuário TUTOR com estudantes vinculados
//   não pode ser alterado (409) até que os estudantes sejam desvinculados.
// - RN23 (SSD 1.13, Issue #134; v1.18, Issue #153): o perfil do responsável
//   pelo acompanhamento de ocorrências não encerradas não pode mudar para
//   PROFESSOR, TECNICO_ADMINISTRATIVO nem PSICOLOGO (409) até a Gestão ou a
//   Equipe Pedagógica trocar o responsável dessas ocorrências. A RN13 é
//   verificada antes.
//
// Auditoria (Issue #91 — RNF04, RNF06): o cadastro grava "usuário criado" e a
// edição (inclusive bloqueio, desativação e reativação) grava "usuário
// editado", com recurso "usuarios/<id>" e usuario_id da Gestão logada, na
// mesma transação da alteração (se o log falhar, a alteração é desfeita).
// Operações recusadas (400, 403, 404, 409) não chegam a gravar o log.
import { Perfil, StatusOcorrencia, StatusUsuario } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { CODIGOS_ERRO, ErroHttp } from '../lib/erros.js';
import { converterIdTexto } from '../lib/ids.js';
import { garantirSemCaractereNulo } from '../lib/texto.js';
import { emTransacaoSerializavel } from '../lib/transacao.js';
import { ACOES_AUDITORIA, recursoAuditoria, registrarAuditoria } from './auditoria.js';
import { normalizarEmail } from './email.js';
import { gerarHashSenha, mensagemPoliticaSenha } from './senha.js';

/** Nome do recurso na API, usado no LogAuditoria ("usuarios/<id>"). */
export const RECURSO_USUARIOS = 'usuarios';

/** Perfis aceitos: os valores do enum Perfil (ex.: GESTAO, TECNICO_ADMINISTRATIVO). */
export const PERFIS_VALIDOS = Object.freeze(Object.values(Perfil));

/**
 * Limite TÉCNICO defensivo do tamanho do nome (após trim), contra entradas
 * abusivas. Não é regra de negócio do SSD (não há RN sobre tamanho de nome);
 * mantido por decisão do Rafael na #12.
 */
export const TAMANHO_MAXIMO_NOME = 150;

/** Limite prático de tamanho de um endereço de e-mail (RFC 5321). */
export const TAMANHO_MAXIMO_EMAIL = 254;

/**
 * Validação simples de formato: parte local, "@", domínio com ao menos um
 * ponto; sem espaços e sem um segundo "@".
 */
const REGEX_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const MENSAGEM_EMAIL_DUPLICADO = 'Já existe um usuário cadastrado com este e-mail.';

/** Campos devolvidos ao cliente — nunca senha_hash (RNF06). */
export const SELECAO_USUARIO_PUBLICO = Object.freeze({
  id: true,
  nome: true,
  email: true,
  perfil: true,
  status: true,
});

function ehTextoPreenchido(valor) {
  return typeof valor === 'string' && valor.trim() !== '';
}

// Validações por campo, compartilhadas entre o cadastro (#12) e a edição (#13).
// Recebem um valor já verificado como texto não vazio (o cadastro verifica
// isso antes, para listar todos os campos ausentes de uma vez).

/**
 * Nome: sem U+0000 (Issue #127), trim e limite técnico de tamanho.
 * @returns {string} nome sem espaços nas pontas
 */
function validarNome(nome) {
  garantirSemCaractereNulo(nome);
  const nomeLimpo = nome.trim();
  if (nomeLimpo.length > TAMANHO_MAXIMO_NOME) {
    throw new ErroHttp(400, `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME} caracteres.`);
  }
  return nomeLimpo;
}

/**
 * E-mail: sem U+0000 (Issue #127; a regex de formato o aceitaria), normaliza
 * (trim + minúsculas) e valida formato e tamanho. @returns {string}
 */
function validarEmail(email) {
  garantirSemCaractereNulo(email);
  const emailNormalizado = normalizarEmail(email);
  if (emailNormalizado.length > TAMANHO_MAXIMO_EMAIL || !REGEX_EMAIL.test(emailNormalizado)) {
    throw new ErroHttp(400, 'Informe um e-mail em formato válido.');
  }
  return emailNormalizado;
}

/** Perfil: somente os valores exatos do enum Perfil. */
function validarPerfil(perfil) {
  if (!PERFIS_VALIDOS.includes(perfil)) {
    throw new ErroHttp(400, `Perfil inválido. Valores aceitos: ${PERFIS_VALIDOS.join(', ')}.`);
  }
}

/**
 * Valida e normaliza o corpo do cadastro.
 * @param {unknown} corpo
 * @returns {{ nome: string, email: string, perfil: string, senha: string }}
 * @throws {ErroHttp} 400 com mensagem clara (nunca contém a senha nem o e-mail)
 */
export function validarCadastroUsuario(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(400, 'Envie um objeto JSON com nome, email, perfil e senha.');
  }

  // Somente nome, email, perfil e senha são lidos; qualquer outro campo
  // (status, id, senha_hash, confirmarSenha...) é IGNORADO e nunca chega ao
  // banco (decisão do Rafael na #12): o status é sempre ATIVO, o id vem do
  // banco e o senha_hash é sempre gerado a partir da senha.
  const { nome, email, perfil, senha } = corpo;

  const faltando = [];
  if (!ehTextoPreenchido(nome)) faltando.push('nome');
  if (!ehTextoPreenchido(email)) faltando.push('email');
  if (!ehTextoPreenchido(perfil)) faltando.push('perfil');
  if (typeof senha !== 'string' || senha === '') faltando.push('senha');
  if (faltando.length > 0) {
    throw new ErroHttp(400, `Informe ${faltando.join(', ')} (texto não vazio).`);
  }

  const nomeLimpo = validarNome(nome);
  const emailNormalizado = validarEmail(email);
  validarPerfil(perfil);

  const problemaSenha = mensagemPoliticaSenha(senha);
  if (problemaSenha) {
    throw new ErroHttp(400, problemaSenha);
  }

  return { nome: nomeLimpo, email: emailNormalizado, perfil, senha };
}

function ehViolacaoDeUnicidade(erro) {
  return erro?.code === 'P2002';
}

/**
 * Cadastra um usuário com status ATIVO e troca de senha obrigatória no
 * primeiro login (RF01, RN10, RNF03). A resposta não muda: o campo
 * troca_senha_obrigatoria não é devolvido (SELECAO_USUARIO_PUBLICO).
 *
 * Auditoria (Issue #91): o create e o LogAuditoria "usuário criado" rodam na
 * mesma transação; se o log falhar, o usuário não fica cadastrado.
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @param {(senha: string) => Promise<string>} [deps.gerarHash] gera o hash bcrypt
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 * @throws {ErroHttp} 400 (dados inválidos) ou 409 (e-mail já cadastrado)
 */
export async function cadastrarUsuario(
  corpo,
  solicitante,
  { db = prisma, gerarHash = gerarHashSenha } = {},
) {
  const { nome, email, perfil, senha } = validarCadastroUsuario(corpo);

  // Pré-checagem (evita gastar um hash bcrypt à toa). A corrida entre duas
  // requisições simultâneas é coberta pelo tratamento do P2002 abaixo.
  const existente = await db.usuario.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO, { codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
  }

  // O hash é gerado fora da transação para não mantê-la aberta durante o bcrypt.
  const senha_hash = await gerarHash(senha);

  try {
    return await db.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nome,
          email,
          perfil,
          senha_hash,
          status: StatusUsuario.ATIVO,
          // RN10: a senha definida pela Gestão é temporária.
          troca_senha_obrigatoria: true,
        },
        select: SELECAO_USUARIO_PUBLICO,
      });
      await registrarAuditoria(
        {
          usuarioId: solicitante?.id ?? null,
          acao: ACOES_AUDITORIA.USUARIO_CRIADO,
          recurso: recursoAuditoria(RECURSO_USUARIOS, usuario.id),
        },
        tx,
      );
      return usuario;
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO, { codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
    }
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Listagem (GET /usuarios) — Issues #12 e #44
// ---------------------------------------------------------------------------

/** Perfil que recebe a lista completa de usuários (RN20). */
const PERFIL_DADOS_COMPLETOS = Perfil.GESTAO;

/**
 * Perfis que podem ser destinatários de encaminhamento ou responsáveis pelo
 * acompanhamento (RN03, RN15) — os únicos na lista reduzida (RN20). O
 * PSICOLOGO (v1.18) entra só como destinatário: nunca é responsável (RN23).
 */
export const PERFIS_DESTINATARIOS = Object.freeze([
  Perfil.TUTOR,
  Perfil.PSICOLOGO,
  Perfil.PEDAGOGICO,
  Perfil.GESTAO,
]);

/** Demais perfis (RN20): e-mail e status nem são lidos do banco. */
export const SELECAO_USUARIO_REDUZIDA = Object.freeze({ id: true, nome: true, perfil: true });

export const MENSAGEM_FILTRO_PERFIL_INVALIDO = `O filtro perfil deve ser um dos valores: ${PERFIS_DESTINATARIOS.join(', ')}.`;

const ORDEM_USUARIOS = Object.freeze([{ nome: 'asc' }, { id: 'asc' }]);

/**
 * Valida o filtro ?perfil= do GET (mesmo padrão do ?turmaId= da #42).
 * Ausente: sem filtro. Repetido (?perfil=A&perfil=B), vazio ou fora dos
 * valores aceitos: 400. Valores exatos do enum (sem trim nem minúsculas).
 * @param {unknown} valor req.query.perfil
 * @param {readonly string[]} aceitos perfis aceitos para quem consulta
 * @param {string} mensagem mensagem do 400
 * @returns {string | undefined}
 */
export function validarFiltroPerfil(valor, aceitos, mensagem) {
  if (valor === undefined) return undefined;
  if (typeof valor !== 'string' || !aceitos.includes(valor)) {
    throw new ErroHttp(400, mensagem);
  }
  return valor;
}

/**
 * Lista usuários, sem senha_hash, ordenados por nome e depois id (ordem
 * estável mesmo com nomes repetidos). O formato depende do perfil de quem
 * consulta (RN20), lido do banco pelo middleware de autenticação (req.usuario):
 * - GESTAO: id, nome, email, perfil e status de todos os usuários (qualquer
 *   status), como antes da #44. Sem filtro: ?perfil= é ignorado (decisão do
 *   Rafael na #44; o SSD só prevê o filtro para os demais perfis).
 * - Demais perfis: só id, nome e perfil dos usuários ATIVOS com perfil TUTOR,
 *   PSICOLOGO, PEDAGOGICO ou GESTAO (possíveis destinatários/responsáveis).
 *   ?perfil= opcional, restrito a esses quatro valores.
 * @param {{ perfil: string }} solicitante req.usuario
 * @param {{ perfil?: unknown }} [query] req.query
 * @param {object} [deps]
 * @param {object} [deps.db]
 */
export async function listarUsuarios(solicitante, query = {}, { db = prisma } = {}) {
  if (solicitante?.perfil === PERFIL_DADOS_COMPLETOS) {
    return db.usuario.findMany({
      select: SELECAO_USUARIO_PUBLICO,
      orderBy: ORDEM_USUARIOS,
    });
  }

  const perfil = validarFiltroPerfil(
    query?.perfil,
    PERFIS_DESTINATARIOS,
    MENSAGEM_FILTRO_PERFIL_INVALIDO,
  );
  return db.usuario.findMany({
    where: {
      status: StatusUsuario.ATIVO,
      perfil: perfil !== undefined ? perfil : { in: [...PERFIS_DESTINATARIOS] },
    },
    select: SELECAO_USUARIO_REDUZIDA,
    orderBy: ORDEM_USUARIOS,
  });
}

// ---------------------------------------------------------------------------
// Edição (PUT /usuarios/{id}) — Issue #13
// ---------------------------------------------------------------------------

/**
 * Campos aceitos no corpo do PUT /usuarios/{id}. Outros campos (id,
 * senha, senha_hash...) são IGNORADOS, como no cadastro; a troca de senha
 * não faz parte desta Story.
 */
export const CAMPOS_EDICAO = Object.freeze(['nome', 'email', 'perfil', 'status']);

/** Status aceitos: os valores do enum StatusUsuario (ATIVO, BLOQUEADO, DESATIVADO). */
export const STATUS_VALIDOS = Object.freeze(Object.values(StatusUsuario));

export const MENSAGEM_ID_INVALIDO = 'Identificador de usuário inválido.';
export const MENSAGEM_USUARIO_NAO_ENCONTRADO = 'Usuário não encontrado.';
export const MENSAGEM_ALTERAR_PROPRIO_ACESSO =
  'Você não pode bloquear, desativar ou alterar o perfil do seu próprio usuário.';
/** RN11: mínimo de usuários GESTAO com status ATIVO e sem troca de senha pendente (#149). */
export const MINIMO_GESTOES_ATIVAS = 2;

export const MENSAGEM_MINIMO_GESTOES_ATIVAS =
  'O sistema precisa de ao menos dois usuários Gestão ativos que já tenham trocado a senha temporária. Cadastre ou reative outro usuário Gestão (e aguarde o primeiro acesso dele) antes de bloquear, desativar ou alterar o perfil deste.';
/** RN13: troca de perfil de um Tutor com estudantes vinculados (409). */
export const MENSAGEM_TUTOR_COM_TUTORADOS =
  'Este usuário Tutor tem estudantes vinculados. Desvincule os estudantes (ou troque o tutor deles) antes de alterar o perfil.';
/**
 * RN23: perfis que não podem ser responsáveis pelo acompanhamento de uma
 * ocorrência (só Tutor, Pedagógico e Gestão podem — RN15, RN22). O
 * PSICOLOGO entrou na v1.18 (Issue #153).
 */
export const PERFIS_SEM_ACOMPANHAMENTO = Object.freeze([
  Perfil.PROFESSOR,
  Perfil.TECNICO_ADMINISTRATIVO,
  Perfil.PSICOLOGO,
]);
/** RN23: mudança de perfil do responsável por ocorrências não encerradas (409). Sem dados de estudantes (RNF06). */
export const MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS =
  'Este usuário é o responsável pelo acompanhamento de ocorrências que ainda não foram encerradas. Troque o responsável dessas ocorrências (por um novo encaminhamento) antes de alterar o perfil para Professor, Técnico-administrativo ou Psicólogo escolar.';
export const MENSAGEM_CONFLITO_CONCORRENTE =
  'O usuário foi alterado por outra operação ao mesmo tempo. Tente novamente.';

/**
 * Converte o id da URL. Aceita apenas inteiro positivo em notação decimal
 * simples ("1", "42"), dentro do limite do Int do banco.
 * @param {unknown} valor
 * @returns {number}
 * @throws {ErroHttp} 400
 */
export function validarIdUsuario(valor) {
  return converterIdTexto(valor, MENSAGEM_ID_INVALIDO);
}

/**
 * Valida e normaliza o corpo da edição. Cada campo é opcional, mas ao menos
 * um dos CAMPOS_EDICAO deve vir; um campo presente (inclusive null) é
 * validado com as mesmas regras do cadastro.
 * @param {unknown} corpo
 * @returns {{ nome?: string, email?: string, perfil?: string, status?: string }}
 * @throws {ErroHttp} 400 (a mensagem nunca contém o e-mail enviado)
 */
export function validarEdicaoUsuario(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    throw new ErroHttp(
      400,
      `Envie um objeto JSON com ao menos um dos campos: ${CAMPOS_EDICAO.join(', ')}.`,
    );
  }

  const presentes = CAMPOS_EDICAO.filter((campo) => corpo[campo] !== undefined);
  if (presentes.length === 0) {
    throw new ErroHttp(400, `Informe ao menos um dos campos: ${CAMPOS_EDICAO.join(', ')}.`);
  }

  // Somente os CAMPOS_EDICAO são lidos; qualquer outro é ignorado.
  const { nome, email, perfil, status } = corpo;
  const dados = {};

  if (nome !== undefined) {
    if (!ehTextoPreenchido(nome)) throw new ErroHttp(400, 'Informe nome (texto não vazio).');
    dados.nome = validarNome(nome);
  }
  if (email !== undefined) {
    if (!ehTextoPreenchido(email)) throw new ErroHttp(400, 'Informe email (texto não vazio).');
    dados.email = validarEmail(email);
  }
  if (perfil !== undefined) {
    validarPerfil(perfil);
    dados.perfil = perfil;
  }
  if (status !== undefined) {
    if (!STATUS_VALIDOS.includes(status)) {
      throw new ErroHttp(400, `Status inválido. Valores aceitos: ${STATUS_VALIDOS.join(', ')}.`);
    }
    dados.status = status;
  }

  return dados;
}

// RN11 (#149): Gestão com troca de senha pendente ainda não definiu a própria
// senha e não conta como Gestão ativa. `!== true` aqui e `false` na contagem
// abaixo são equivalentes: a coluna é Boolean @default(false), sem nulo.
function ehGestaoAtiva({ perfil, status, troca_senha_obrigatoria }) {
  return (
    perfil === Perfil.GESTAO && status === StatusUsuario.ATIVO && troca_senha_obrigatoria !== true
  );
}

/**
 * Verificações que dependem do banco + atualização, dentro da transação.
 * @param {object} tx client da transação
 * @param {number} id
 * @param {object} dados campos já validados
 * @param {{ id: number }} solicitante usuário autenticado (req.usuario)
 */
async function verificarEAtualizar(tx, id, dados, solicitante) {
  const atual = await tx.usuario.findUnique({
    where: { id },
    select: { id: true, email: true, perfil: true, status: true, troca_senha_obrigatoria: true },
  });
  if (!atual) {
    throw new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
  }

  // E-mail único: manter o próprio e-mail não é conflito.
  if (dados.email !== undefined && dados.email !== atual.email) {
    const dono = await tx.usuario.findUnique({
      where: { email: dados.email },
      select: { id: true },
    });
    if (dono && dono.id !== id) {
      throw new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO, { codigo: CODIGOS_ERRO.EMAIL_DUPLICADO });
    }
  }

  // RN13 — Tutor com estudantes vinculados não muda de perfil (409). Só a
  // saída do perfil TUTOR é recusada; nome, e-mail e status continuam
  // editáveis (o vínculo com tutor bloqueado/desativado é mantido — RN07).
  // A contagem roda na mesma transação SERIALIZABLE do update: um vínculo
  // novo criado ao mesmo tempo em POST/PUT /estudantes (também serializável)
  // faz uma das duas transações abortar (P2034) e ser repetida.
  if (atual.perfil === Perfil.TUTOR && dados.perfil !== undefined && dados.perfil !== Perfil.TUTOR) {
    const tutorados = await tx.estudante.count({ where: { tutor_id: id } });
    if (tutorados > 0) {
      throw new ErroHttp(409, MENSAGEM_TUTOR_COM_TUTORADOS, {
        codigo: CODIGOS_ERRO.TUTOR_COM_TUTORADOS,
      });
    }
  }

  // RN23 — o responsável pelo acompanhamento de ocorrências não encerradas
  // não passa a Professor, Técnico-administrativo nem Psicólogo escolar (409
  // — PERFIS_SEM_ACOMPANHAMENTO). A mudança entre
  // TUTOR, PEDAGOGICO e GESTAO e a edição sem mudança de perfil não são
  // recusadas; ocorrências ENCERRADO não impedem (o responsável gravado nelas
  // é mantido). Verificada DEPOIS da RN13 (decisão do Rafael, 23/11/2026).
  // A contagem roda na mesma transação SERIALIZABLE do update: um
  // encaminhamento simultâneo que defina este usuário como responsável (também
  // serializável) faz uma das duas transações abortar (P2034) e ser repetida.
  if (
    dados.perfil !== undefined &&
    dados.perfil !== atual.perfil &&
    PERFIS_SEM_ACOMPANHAMENTO.includes(dados.perfil)
  ) {
    const emAcompanhamento = await tx.ocorrencia.count({
      where: { responsavel_acompanhamento_id: id, status: { not: StatusOcorrencia.ENCERRADO } },
    });
    if (emAcompanhamento > 0) {
      throw new ErroHttp(409, MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS, {
        codigo: CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS,
      });
    }
  }

  // RN11 — ao menos dois GESTAO ATIVO sem troca de senha pendente (#149): se
  // este usuário é Gestão ativa e deixaria de ser (rebaixado, bloqueado ou
  // desativado), precisam restar ao menos MINIMO_GESTOES_ATIVAS outras
  // Gestões ativas depois da edição.
  const depois = {
    perfil: dados.perfil ?? atual.perfil,
    status: dados.status ?? atual.status,
    troca_senha_obrigatoria: atual.troca_senha_obrigatoria,
  };
  if (ehGestaoAtiva(atual) && !ehGestaoAtiva(depois)) {
    const outrasGestoesAtivas = await tx.usuario.count({
      where: {
        perfil: Perfil.GESTAO,
        status: StatusUsuario.ATIVO,
        troca_senha_obrigatoria: false,
        id: { not: id },
      },
    });
    if (outrasGestoesAtivas < MINIMO_GESTOES_ATIVAS) {
      throw new ErroHttp(409, MENSAGEM_MINIMO_GESTOES_ATIVAS, {
        codigo: CODIGOS_ERRO.GESTAO_ATIVA_MINIMA,
      });
    }
  }

  const usuario = await tx.usuario.update({
    where: { id },
    data: dados,
    select: SELECAO_USUARIO_PUBLICO,
  });
  // Issue #91: toda edição aceita (nome, e-mail, perfil ou status — inclusive
  // bloqueio, desativação e reativação) grava "usuário editado".
  await registrarAuditoria(
    {
      usuarioId: solicitante?.id ?? null,
      acao: ACOES_AUDITORIA.USUARIO_EDITADO,
      recurso: recursoAuditoria(RECURSO_USUARIOS, usuario.id),
    },
    tx,
  );
  return usuario;
}

/**
 * Edita um usuário: nome, e-mail, perfil e/ou status (RF01, RF04, RN07).
 *
 * Concorrência: a leitura, as verificações (e-mail único, tutor com
 * estudantes vinculados — RN13, responsável por ocorrências não encerradas —
 * RN23, mínimo de duas Gestões ativas — RN11), o
 * update e o LogAuditoria "usuário editado" (#91) rodam numa transação SERIALIZABLE. Duas edições simultâneas que, juntas, deixariam o sistema com menos de duas
 * Gestões ativas (ex.: com três Gestões ativas, cada uma rebaixa uma
 * Gestão diferente — isoladas, ambas passariam) não passam ambas: o PostgreSQL
 * aborta uma delas (SQLSTATE 40001, que o Prisma expõe como P2034); ela é
 * repetida e então esbarra na regra. Esgotadas as tentativas, responde 409.
 *
 * @param {unknown} idUrl id recebido na URL (texto)
 * @param {unknown} corpo corpo da requisição
 * @param {{ id: number, perfil: string }} solicitante usuário autenticado (req.usuario)
 * @param {object} [deps]
 * @param {object} [deps.db] client Prisma (injetável em testes)
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, status: string }>}
 * @throws {ErroHttp} 400 (dados/id inválidos), 404 (inexistente) ou 409 (conflito)
 */
export async function atualizarUsuario(idUrl, corpo, solicitante, { db = prisma } = {}) {
  const id = validarIdUsuario(idUrl);
  const dados = validarEdicaoUsuario(corpo);

  // RN11: a Gestão não bloqueia/desativa a si mesma nem muda o próprio
  // perfil. Editar o próprio nome/e-mail é permitido, e reenviar o valor
  // atual (perfil GESTAO, status ATIVO) não muda nada e é aceito.
  if (solicitante?.id === id) {
    const mudaPerfil = dados.perfil !== undefined && dados.perfil !== solicitante.perfil;
    const perdeAcesso = dados.status !== undefined && dados.status !== StatusUsuario.ATIVO;
    if (mudaPerfil || perdeAcesso) {
      throw new ErroHttp(409, MENSAGEM_ALTERAR_PROPRIO_ACESSO, {
        codigo: CODIGOS_ERRO.ALTERAR_PROPRIO_ACESSO,
      });
    }
  }

  // Conflito de serialização/escrita (P2034): o helper repete a transação.
  return emTransacaoSerializavel(db, (tx) => verificarEAtualizar(tx, id, dados, solicitante), {
    mensagemConflito: MENSAGEM_CONFLITO_CONCORRENTE,
    traduzirErro: (erro) => {
      // Corrida com outro cadastro/edição usando o mesmo e-mail.
      if (ehViolacaoDeUnicidade(erro)) {
        return new ErroHttp(409, MENSAGEM_EMAIL_DUPLICADO, {
          codigo: CODIGOS_ERRO.EMAIL_DUPLICADO,
        });
      }
      // Registro inexistente no update (ex.: removido direto no banco).
      if (erro?.code === 'P2025') return new ErroHttp(404, MENSAGEM_USUARIO_NAO_ENCONTRADO);
      return undefined;
    },
  });
}
