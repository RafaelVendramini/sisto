// Testes de GET, POST e PUT /estudantes (Issue #42) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (usuários fictícios, turmas fictícias, estudantes fictícios e
// LogAuditoria).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  turmaFindUnique: vi.fn(),
  estudanteFindMany: vi.fn(),
  estudanteFindUnique: vi.fn(),
  estudanteCreate: vi.fn(),
  estudanteUpdate: vi.fn(),
  logCreate: vi.fn(),
  $transaction: vi.fn(),
}));

function clientMock() {
  return {
    usuario: { findUnique: mocks.usuarioFindUnique },
    turma: { findUnique: mocks.turmaFindUnique },
    estudante: {
      findMany: mocks.estudanteFindMany,
      findUnique: mocks.estudanteFindUnique,
      create: mocks.estudanteCreate,
      update: mocks.estudanteUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
  };
}

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: (...a) => mocks.usuarioFindUnique(...a) },
    turma: { findUnique: (...a) => mocks.turmaFindUnique(...a) },
    estudante: {
      findMany: (...a) => mocks.estudanteFindMany(...a),
      findUnique: (...a) => mocks.estudanteFindUnique(...a),
      create: (...a) => mocks.estudanteCreate(...a),
      update: (...a) => mocks.estudanteUpdate(...a),
    },
    logAuditoria: { create: (...a) => mocks.logCreate(...a) },
    $transaction: (...a) => mocks.$transaction(...a),
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  MENSAGEM_CORPO_ESTUDANTE_INVALIDO,
  MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO,
  MENSAGEM_NOME_ESTUDANTE_LONGO,
  MENSAGEM_CODIGO_ESCOLAR_INVALIDO,
  MENSAGEM_CODIGO_ESCOLAR_LONGO,
  MENSAGEM_TURMA_ID_INVALIDO,
  MENSAGEM_TURMA_INEXISTENTE,
  MENSAGEM_TUTOR_ID_INVALIDO,
  MENSAGEM_TUTOR_INVALIDO,
  MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
  MENSAGEM_ID_ESTUDANTE_INVALIDO,
  MENSAGEM_ESTUDANTE_NAO_ENCONTRADO,
  MENSAGEM_FILTRO_TURMA_INVALIDO,
  MENSAGEM_CONFLITO_CONCORRENTE_ESTUDANTE,
  TAMANHO_MAXIMO_NOME_ESTUDANTE,
  TAMANHO_MAXIMO_CODIGO_ESCOLAR,
  criarEstudante,
} = await import('../src/services/estudantes.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_NAO_GESTAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_GESTAO = 3;
const ID_TUTOR_ATIVO = 2;
const ID_TROCA_PENDENTE = 6;
const ID_TUTOR_2 = 7;
const ID_TUTOR_BLOQUEADO = 8;
const ID_TUTOR_DESATIVADO = 9;
const EM = 'Ensino Médio';

let usuarios;
let turmas;
let estudantes;
let logs;
let proximoIdEstudante;

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

/** Aplica um `select` do Prisma (com relações turma/tutor) a um estudante em memória. */
function projetarEstudante(estudante, select) {
  const saida = {};
  for (const [campo, valor] of Object.entries(select)) {
    if (!valor) continue;
    if (campo === 'turma' || campo === 'tutor') {
      const fonte =
        campo === 'turma'
          ? turmas.find((t) => t.id === estudante.turma_id)
          : usuarios.find((u) => u.id === estudante.tutor_id);
      saida[campo] = fonte ? selecionar(fonte, valor.select) : null;
    } else {
      saida[campo] = estudante[campo];
    }
  }
  return saida;
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;

  const base = (id, perfil, extra = {}) => ({
    id,
    nome: `Usuário Fictício ${id}`,
    email: `usuario${id}@sisto.exemplo`,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });
  usuarios = PERFIS.map((perfil, i) => base(i + 1, perfil));
  usuarios.push(base(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }));
  usuarios.push(base(ID_TUTOR_2, 'TUTOR', { nome: 'Tutor Fictício B' }));
  usuarios.push(base(ID_TUTOR_BLOQUEADO, 'TUTOR', { nome: 'Tutor Fictício Bloqueado', status: 'BLOQUEADO' }));
  usuarios.push(base(ID_TUTOR_DESATIVADO, 'TUTOR', { nome: 'Tutor Fictício Desativado', status: 'DESATIVADO' }));
  usuarios.find((u) => u.id === ID_TUTOR_ATIVO).nome = 'Tutor Fictício A';

  turmas = [
    { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
    { id: 2, nome: '1º A', etapa: EM, ano_letivo: 2026 },
  ];

  estudantes = [
    { id: 1, nome_completo: 'Estudante Fictício 03', codigo_escolar: 'TESTE-0003', turma_id: 2, tutor_id: null },
    { id: 2, nome_completo: 'Estudante Fictício 01', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR_ATIVO },
    { id: 3, nome_completo: 'Estudante Fictício 02', codigo_escolar: null, turma_id: 1, tutor_id: ID_TUTOR_BLOQUEADO },
  ];
  proximoIdEstudante = 4;
  logs = [];

  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = usuarios.find((u) => u.id === where.id);
    return encontrado ? selecionar(encontrado, select) : null;
  });

  mocks.turmaFindUnique.mockReset();
  mocks.turmaFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrada = turmas.find((t) => t.id === where.id);
    return encontrada ? selecionar(encontrada, select) : null;
  });

  mocks.estudanteFindMany.mockReset();
  mocks.estudanteFindMany.mockImplementation(async ({ where, select } = {}) => {
    let lista = [...estudantes];
    if (where?.turma_id !== undefined) lista = lista.filter((e) => e.turma_id === where.turma_id);
    lista.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo) || a.id - b.id);
    return lista.map((e) => projetarEstudante(e, select));
  });

  mocks.estudanteFindUnique.mockReset();
  mocks.estudanteFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrado =
      where.id !== undefined
        ? estudantes.find((e) => e.id === where.id)
        : estudantes.find((e) => e.codigo_escolar === where.codigo_escolar);
    return encontrado ? projetarEstudante(encontrado, select) : null;
  });

  mocks.estudanteCreate.mockReset();
  mocks.estudanteCreate.mockImplementation(async ({ data, select }) => {
    const registro = { id: proximoIdEstudante++, ...data };
    estudantes.push(registro);
    return projetarEstudante(registro, select);
  });

  mocks.estudanteUpdate.mockReset();
  mocks.estudanteUpdate.mockImplementation(async ({ where, data, select }) => {
    const registro = estudantes.find((e) => e.id === where.id);
    if (!registro) throw erroPrisma('P2025');
    Object.assign(registro, data);
    return projetarEstudante(registro, select);
  });

  mocks.logCreate.mockReset();
  mocks.logCreate.mockImplementation(async ({ data }) => {
    logs.push(data);
    return { id: logs.length };
  });

  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => operacao(clientMock()));
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDoUsuario(id) {
  const usuario = usuarios.find((u) => u.id === id);
  return jwt.sign({ id, perfil: usuario.perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

function autenticar(req, perfil) {
  if (!perfil) return req;
  const id = usuarios.find((u) => u.perfil === perfil).id;
  return req.set('Authorization', `Bearer ${tokenDoUsuario(id)}`);
}

const getEstudantes = (perfil = 'GESTAO', query = '') =>
  autenticar(request(app).get(`/estudantes${query}`), perfil);
const postEstudantes = (corpo, perfil = 'GESTAO') =>
  autenticar(request(app).post('/estudantes'), perfil).send(corpo);
const putEstudante = (id, corpo, perfil = 'GESTAO') =>
  autenticar(request(app).put(`/estudantes/${id}`), perfil).send(corpo);

const TURMA_1 = { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', anoLetivo: 2026 };
const TURMA_2 = { id: 2, nome: '1º A', etapa: EM, anoLetivo: 2026 };
const ESTUDANTE_VALIDO = Object.freeze({
  nomeCompleto: 'Estudante Fictício 04',
  codigoEscolar: 'TESTE-0004',
  turmaId: 2,
  tutorId: ID_TUTOR_ATIVO,
});

// ---------------------------------------------------------------------------
// GET /estudantes
// ---------------------------------------------------------------------------
describe('GET /estudantes', () => {
  it('Gestão recebe todos os campos, ordenados por nome, com e-mail e status do tutor (RN13/RN20)', async () => {
    const res = await getEstudantes('GESTAO');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 2,
        nomeCompleto: 'Estudante Fictício 01',
        codigoEscolar: 'TESTE-0001',
        turma: TURMA_1,
        tutor: { id: ID_TUTOR_ATIVO, nome: 'Tutor Fictício A', email: `usuario${ID_TUTOR_ATIVO}@sisto.exemplo`, status: 'ATIVO' },
      },
      {
        id: 3,
        nomeCompleto: 'Estudante Fictício 02',
        codigoEscolar: null,
        turma: TURMA_1,
        tutor: {
          id: ID_TUTOR_BLOQUEADO,
          nome: 'Tutor Fictício Bloqueado',
          email: `usuario${ID_TUTOR_BLOQUEADO}@sisto.exemplo`,
          status: 'BLOQUEADO',
        },
      },
      { id: 1, nomeCompleto: 'Estudante Fictício 03', codigoEscolar: 'TESTE-0003', turma: TURMA_2, tutor: null },
    ]);
  });

  it.each(PERFIS_NAO_GESTAO)(
    'perfil %s recebe só id, nomeCompleto, turma e tutor { id, nome } (RN20)',
    async (perfil) => {
      const res = await getEstudantes(perfil);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: 2, nomeCompleto: 'Estudante Fictício 01', turma: TURMA_1, tutor: { id: ID_TUTOR_ATIVO, nome: 'Tutor Fictício A' } },
        { id: 3, nomeCompleto: 'Estudante Fictício 02', turma: TURMA_1, tutor: { id: ID_TUTOR_BLOQUEADO, nome: 'Tutor Fictício Bloqueado' } },
        { id: 1, nomeCompleto: 'Estudante Fictício 03', turma: TURMA_2, tutor: null },
      ]);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(/codigoEscolar|TESTE-|email|@|status|BLOQUEADO"/);
    },
  );

  it('para quem não é Gestão, o código escolar e o e-mail/status do tutor nem são lidos do banco', async () => {
    await getEstudantes('PROFESSOR');
    const { select } = mocks.estudanteFindMany.mock.calls[0][0];
    expect(select).not.toHaveProperty('codigo_escolar');
    expect(select.tutor).toEqual({ select: { id: true, nome: true } });
  });

  it('pede ao banco a ordenação por nome completo e id', async () => {
    await getEstudantes();
    expect(mocks.estudanteFindMany.mock.calls[0][0].orderBy).toEqual([
      { nome_completo: 'asc' },
      { id: 'asc' },
    ]);
  });

  it.each(PERFIS)('?turmaId=1 (perfil %s) devolve só os estudantes da turma 1', async (perfil) => {
    const res = await getEstudantes(perfil, '?turmaId=1');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.id)).toEqual([2, 3]);
    expect(res.body.every((e) => e.turma.id === 1)).toBe(true);
    expect(mocks.estudanteFindMany.mock.calls[0][0].where).toEqual({ turma_id: 1 });
  });

  it('?turmaId de turma inexistente devolve lista vazia (200)', async () => {
    const res = await getEstudantes('GESTAO', '?turmaId=999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(['abc', '0', '-1', '1.5', '01', '', '99999999999', '1&turmaId=2'])(
    '?turmaId=%s inválido responde 400',
    async (valor) => {
      const res = await getEstudantes('GESTAO', `?turmaId=${valor}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_FILTRO_TURMA_INVALIDO });
      expect(mocks.estudanteFindMany).not.toHaveBeenCalled();
    },
  );

  it('lista vazia responde 200 com []', async () => {
    estudantes = [];
    const res = await getEstudantes('TUTOR');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('sem token responde 401', async () => {
    const res = await getEstudantes(null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.estudanteFindMany).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await request(app)
      .get('/estudantes')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.estudanteFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /estudantes
// ---------------------------------------------------------------------------
describe('POST /estudantes', () => {
  it('Gestão cadastra com tutor: 201 com o estudante completo', async () => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, nomeCompleto: '  Estudante Fictício 04  ', codigoEscolar: ' TESTE-0004 ' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 4,
      nomeCompleto: 'Estudante Fictício 04',
      codigoEscolar: 'TESTE-0004',
      turma: TURMA_2,
      tutor: { id: ID_TUTOR_ATIVO, nome: 'Tutor Fictício A', email: `usuario${ID_TUTOR_ATIVO}@sisto.exemplo`, status: 'ATIVO' },
    });
    expect(estudantes.at(-1)).toEqual({
      id: 4,
      nome_completo: 'Estudante Fictício 04',
      codigo_escolar: 'TESTE-0004',
      turma_id: 2,
      tutor_id: ID_TUTOR_ATIVO,
    });
  });

  it('só com os obrigatórios: sem código e sem tutor (null)', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 05', turmaId: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ codigoEscolar: null, tutor: null });
    expect(mocks.estudanteCreate.mock.calls[0][0].data).toEqual({
      nome_completo: 'Estudante Fictício 05',
      codigo_escolar: null,
      turma_id: 1,
      tutor_id: null,
    });
    expect(mocks.usuarioFindUnique).toHaveBeenCalledTimes(1); // só a sessão
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['null', null],
  ])('código escolar %s vira null; vários estudantes podem ficar sem código (RN18)', async (_caso, codigoEscolar) => {
    const primeiro = await postEstudantes({ nomeCompleto: 'Estudante Fictício 05', turmaId: 1, codigoEscolar });
    const segundo = await postEstudantes({ nomeCompleto: 'Estudante Fictício 06', turmaId: 1, codigoEscolar });
    expect(primeiro.status).toBe(201);
    expect(segundo.status).toBe(201);
    expect(primeiro.body.codigoEscolar).toBeNull();
    expect(segundo.body.codigoEscolar).toBeNull();
  });

  it('nome completo repetido é aceito (RN18)', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 01', turmaId: 1 });
    expect(res.status).toBe(201);
  });

  it('ignora campos fora do contrato (ex.: id, turma_id, tutor_id)', async () => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, id: 99, turma_id: 1, tutor_id: ID_TUTOR_BLOQUEADO });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(4);
    expect(mocks.estudanteCreate.mock.calls[0][0].data).toEqual({
      nome_completo: 'Estudante Fictício 04',
      codigo_escolar: 'TESTE-0004',
      turma_id: 2,
      tutor_id: ID_TUTOR_ATIVO,
    });
  });

  it('grava a criação no LogAuditoria com recurso estudantes/<id>, sem nome nem código (RNF04/RNF06)', async () => {
    const res = await postEstudantes(ESTUDANTE_VALIDO);
    expect(res.status).toBe(201);
    expect(logs).toEqual([
      { usuario_id: ID_GESTAO, acao: ACOES_AUDITORIA.ESTUDANTE_CRIADO, recurso: `estudantes/${res.body.id}` },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/Fictício|TESTE-/);
  });

  it('usa transação serializável', async () => {
    await postEstudantes(ESTUDANTE_VALIDO);
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s responde 403 e nada é gravado', async (perfil) => {
    const res = await postEstudantes(ESTUDANTE_VALIDO, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('sem token responde 401', async () => {
    const res = await postEstudantes(ESTUDANTE_VALIDO, null);
    expect(res.status).toBe(401);
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403', async () => {
    const res = await request(app)
      .post('/estudantes')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send(ESTUDANTE_VALIDO);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', { turmaId: 1 }],
    ['vazio', { nomeCompleto: '', turmaId: 1 }],
    ['só espaços', { nomeCompleto: '   ', turmaId: 1 }],
    ['null', { nomeCompleto: null, turmaId: 1 }],
    ['número', { nomeCompleto: 10, turmaId: 1 }],
  ])('nomeCompleto %s responde 400', async (_caso, corpo) => {
    const res = await postEstudantes(corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
  });

  it('nomeCompleto acima de 150 caracteres responde 400; no limite, 201', async () => {
    const longo = await postEstudantes({ nomeCompleto: 'a'.repeat(TAMANHO_MAXIMO_NOME_ESTUDANTE + 1), turmaId: 1 });
    expect(longo.status).toBe(400);
    expect(longo.body).toEqual({ erro: MENSAGEM_NOME_ESTUDANTE_LONGO });
    const limite = await postEstudantes({ nomeCompleto: 'a'.repeat(TAMANHO_MAXIMO_NOME_ESTUDANTE), turmaId: 1 });
    expect(limite.status).toBe(201);
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['texto', '1'],
    ['decimal', 1.5],
    ['zero', 0],
    ['negativo', -1],
    ['booleano', true],
    ['acima do Int', 2_147_483_648],
  ])('turmaId %s responde 400', async (_caso, turmaId) => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 05', turmaId });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_ID_INVALIDO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('turmaId de turma inexistente responde 400 e nada é gravado', async () => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, turmaId: 999 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it.each([
    ['número', 1234],
    ['booleano', false],
    ['objeto', { valor: 'TESTE-0009' }],
  ])('codigoEscolar %s responde 400', async (_caso, codigoEscolar) => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, codigoEscolar });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_INVALIDO });
  });

  it('codigoEscolar acima de 150 caracteres responde 400', async () => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, codigoEscolar: 'T'.repeat(TAMANHO_MAXIMO_CODIGO_ESCOLAR + 1) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_LONGO });
  });

  it.each([
    ['texto', '2'],
    ['decimal', 2.5],
    ['zero', 0],
    ['booleano', true],
  ])('tutorId %s responde 400', async (_caso, tutorId) => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, tutorId });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_ID_INVALIDO });
  });

  it.each([
    ['usuário inexistente', 999],
    ['perfil PROFESSOR', 1],
    ['perfil GESTAO', ID_GESTAO],
    ['perfil PEDAGOGICO', 4],
    ['tutor BLOQUEADO', ID_TUTOR_BLOQUEADO],
    ['tutor DESATIVADO', ID_TUTOR_DESATIVADO],
  ])('tutor inválido (%s) responde 400 (RN13) e nada é gravado', async (_caso, tutorId) => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, tutorId });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it.each([
    ['mesmo texto', 'TESTE-0001'],
    ['com espaços nas pontas', '  TESTE-0001 '],
  ])('código escolar duplicado (%s) responde 409 (RN18) e nada é gravado', async (_caso, codigoEscolar) => {
    const res = await postEstudantes({ ...ESTUDANTE_VALIDO, codigoEscolar });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('violação do índice único no banco (P2002, corrida) responde 409', async () => {
    mocks.estudanteCreate.mockRejectedValueOnce(erroPrisma('P2002'));
    const res = await postEstudantes(ESTUDANTE_VALIDO);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO });
  });

  it('corpo que não é objeto (array) responde 400', async () => {
    const res = await postEstudantes([ESTUDANTE_VALIDO]);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_ESTUDANTE_INVALIDO });
  });

  it('JSON malformado responde 400', async () => {
    const res = await autenticar(request(app).post('/estudantes'), 'GESTAO')
      .set('Content-Type', 'application/json')
      .send('{"nomeCompleto": ');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
  });
});

// ---------------------------------------------------------------------------
// PUT /estudantes/{id}
// ---------------------------------------------------------------------------
describe('PUT /estudantes/{id}', () => {
  it('Gestão edita nome, código, turma e tutor: 200 com o estudante completo', async () => {
    const res = await putEstudante(1, {
      nomeCompleto: 'Estudante Fictício 03 Editado',
      codigoEscolar: 'TESTE-0033',
      turmaId: 1,
      tutorId: ID_TUTOR_2,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      nomeCompleto: 'Estudante Fictício 03 Editado',
      codigoEscolar: 'TESTE-0033',
      turma: TURMA_1,
      tutor: { id: ID_TUTOR_2, nome: 'Tutor Fictício B', email: `usuario${ID_TUTOR_2}@sisto.exemplo`, status: 'ATIVO' },
    });
  });

  it('vincula tutor a estudante sem tutor', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, tutorId: ID_TUTOR_ATIVO });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toMatchObject({ id: ID_TUTOR_ATIVO });
    expect(estudantes.find((e) => e.id === 1).tutor_id).toBe(ID_TUTOR_ATIVO);
  });

  it('troca o tutor por outro tutor ativo', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, tutorId: ID_TUTOR_2 });
    expect(res.status).toBe(200);
    expect(estudantes.find((e) => e.id === 2).tutor_id).toBe(ID_TUTOR_2);
  });

  it('tutorId: null desvincula o tutor', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, tutorId: null });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toBeNull();
    expect(mocks.estudanteUpdate.mock.calls[0][0].data.tutor_id).toBeNull();
  });

  it('desvincula tutor que foi bloqueado depois (RN13)', async () => {
    const res = await putEstudante(3, { nomeCompleto: 'Estudante Fictício 02', turmaId: 1, tutorId: null });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toBeNull();
  });

  it('trocar o tutor por um tutor bloqueado responde 400 e mantém o atual', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, tutorId: ID_TUTOR_DESATIVADO });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
    expect(estudantes.find((e) => e.id === 2).tutor_id).toBe(ID_TUTOR_ATIVO);
    expect(logs).toHaveLength(0);
  });

  it('vincular usuário que não é Tutor responde 400 (RN13)', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, tutorId: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
  });

  it('reenviar o MESMO tutor já vinculado, agora bloqueado, mantém o vínculo (não é novo vínculo)', async () => {
    const res = await putEstudante(3, {
      nomeCompleto: 'Estudante Fictício 02 Editado',
      turmaId: 1,
      tutorId: ID_TUTOR_BLOQUEADO,
    });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toMatchObject({ id: ID_TUTOR_BLOQUEADO, status: 'BLOQUEADO' });
  });

  it('omitir codigoEscolar e tutorId mantém os valores atuais', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01 Editado', turmaId: 2 });
    expect(res.status).toBe(200);
    expect(mocks.estudanteUpdate.mock.calls[0][0].data).toEqual({
      nome_completo: 'Estudante Fictício 01 Editado',
      turma_id: 2,
    });
    expect(res.body).toMatchObject({ codigoEscolar: 'TESTE-0001', tutor: { id: ID_TUTOR_ATIVO } });
  });

  it('codigoEscolar vazio limpa o código', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, codigoEscolar: '' });
    expect(res.status).toBe(200);
    expect(res.body.codigoEscolar).toBeNull();
  });

  it('manter o próprio código escolar não é duplicidade', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, codigoEscolar: 'TESTE-0001' });
    expect(res.status).toBe(200);
  });

  it('código escolar de outro estudante responde 409 (RN18)', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, codigoEscolar: 'TESTE-0001' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO });
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('trocar a turma altera só o estudante (RN14/RN21): nenhuma ocorrência é tocada', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.turma).toEqual(TURMA_2);
    // O client usado na transação não tem acesso a ocorrências: o service só
    // grava em estudante e logAuditoria.
    expect(Object.keys(clientMock())).not.toContain('ocorrencia');
  });

  it('turma inexistente responde 400', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 999 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
  });

  it('grava a edição no LogAuditoria com recurso estudantes/<id>, sem dados pessoais', async () => {
    const res = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, tutorId: null });
    expect(res.status).toBe(200);
    expect(logs).toEqual([
      { usuario_id: ID_GESTAO, acao: ACOES_AUDITORIA.ESTUDANTE_EDITADO, recurso: 'estudantes/2' },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/Fictício|TESTE-/);
  });

  it('id inexistente responde 404 e nada é gravado', async () => {
    const res = await putEstudante(999, { nomeCompleto: 'Estudante Fictício 09', turmaId: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_NAO_ENCONTRADO });
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('estudante removido entre a leitura e o update (P2025) responde 404', async () => {
    mocks.estudanteUpdate.mockRejectedValueOnce(erroPrisma('P2025'));
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_NAO_ENCONTRADO });
  });

  it.each(['abc', '0', '-1', '1.5', '01', '99999999999'])('id inválido (%s) responde 400', async (id) => {
    const res = await putEstudante(id, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ID_ESTUDANTE_INVALIDO });
  });

  it.each([
    ['sem nomeCompleto', { turmaId: 1 }, MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO],
    ['sem turmaId', { nomeCompleto: 'Estudante Fictício 03' }, MENSAGEM_TURMA_ID_INVALIDO],
    ['turmaId texto', { nomeCompleto: 'Estudante Fictício 03', turmaId: '2' }, MENSAGEM_TURMA_ID_INVALIDO],
    ['tutorId texto', { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, tutorId: '2' }, MENSAGEM_TUTOR_ID_INVALIDO],
    ['corpo array', [], MENSAGEM_CORPO_ESTUDANTE_INVALIDO],
  ])('PUT %s responde 400', async (_caso, corpo, mensagem) => {
    const res = await putEstudante(1, corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagem });
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s responde 403 e nada é consultado nem gravado', async (perfil) => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, tutorId: null }, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.estudanteFindUnique).not.toHaveBeenCalled();
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
  });

  it('sem token responde 401', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2 }, null);
    expect(res.status).toBe(401);
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await request(app)
      .put('/estudantes/1')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send({ nomeCompleto: 'Estudante Fictício 03', turmaId: 2 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
  });
});

// ---------------------------------------------------------------------------
// RN21: sem exclusão; ordem das rotas
// ---------------------------------------------------------------------------
describe('Sem DELETE /estudantes/{id} (RN21)', () => {
  it.each(['delete', 'patch'])('%s /estudantes/1 responde 404 e não altera nada', async (metodo) => {
    const res = await autenticar(request(app)[metodo]('/estudantes/1'), 'GESTAO').send({});
    expect(res.status).toBe(404);
    expect(estudantes).toHaveLength(3);
    expect(mocks.estudanteUpdate).not.toHaveBeenCalled();
  });

  it('o roteador de estudantes registra apenas GET, POST e PUT', async () => {
    const { default: rotasEstudantes } = await import('../src/routes/estudantes.js');
    const metodos = rotasEstudantes.stack.flatMap((c) => Object.keys(c.route?.methods ?? {}));
    expect(metodos.sort()).toEqual(['get', 'post', 'put']);
  });

  it('está montado em protegidas depois do bloqueio de troca de senha', async () => {
    const { protegidas } = await import('../src/routes/index.js');
    const { default: rotasEstudantes } = await import('../src/routes/estudantes.js');
    const { bloquearComTrocaDeSenhaPendente } = await import('../src/middlewares/autenticacao.js');
    const camadas = protegidas.stack.map((c) => c.handle);
    const posBloqueio = camadas.indexOf(bloquearComTrocaDeSenhaPendente);
    expect(posBloqueio).toBeGreaterThan(-1);
    expect(camadas.indexOf(rotasEstudantes)).toBeGreaterThan(posBloqueio);
  });
});

// ---------------------------------------------------------------------------
// Concorrência
// ---------------------------------------------------------------------------
describe('Concorrência no cadastro de estudantes', () => {
  it('P2034 é repetido; na repetição o código já existe e responde 409', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      estudantes.push({ id: proximoIdEstudante++, nome_completo: 'Estudante Fictício 07', codigo_escolar: 'TESTE-0004', turma_id: 1, tutor_id: null });
      throw erroPrisma('P2034');
    });
    const res = await postEstudantes(ESTUDANTE_VALIDO);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO });
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('P2034 seguido de sucesso responde 201', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await postEstudantes(ESTUDANTE_VALIDO);
    expect(res.status).toBe(201);
    expect(logs).toHaveLength(1);
  });

  it('PUT: esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_ESTUDANTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
  });

  it('erro inesperado do banco responde 500 genérico, sem dados do estudante', async () => {
    mocks.$transaction.mockRejectedValueOnce(new Error('falha fictícia'));
    const res = await postEstudantes(ESTUDANTE_VALIDO);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  it('o service aceita db injetado', async () => {
    const db = { ...clientMock(), $transaction: async (op) => op(clientMock()) };
    const estudante = await criarEstudante({ nomeCompleto: 'Estudante Fictício 08', turmaId: 1 }, { id: ID_GESTAO }, { db });
    expect(estudante).toMatchObject({ id: 4, nomeCompleto: 'Estudante Fictício 08', tutor: null });
  });
});
