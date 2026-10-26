// Testes complementares do QA para GET, POST e PUT /estudantes (Issue #42).
// Cobrem casos não exercitados em tests/estudantes.test.js: vazamento de dados
// para quem não é Gestão (RN20) em todos os caminhos (lista, filtro, erros,
// token com perfil desatualizado), respostas de erro que não ecoam nome nem
// código do estudante (RNF06), ordem das checagens no PUT, vínculo com tutor
// bloqueado (RN13), decisões do dev ainda pendentes com o Rafael e a
// migration do índice único de codigo_escolar (RN18).
// Somente dados fictícios (RN05). Sem banco: src/lib/prisma.js é substituído
// por um "banco" em memória.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';

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
const { MENSAGEM_PERFIL_SEM_PERMISSAO } = await import('../src/middlewares/autenticacao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  MENSAGEM_TURMA_INEXISTENTE,
  MENSAGEM_TUTOR_INVALIDO,
  MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
  MENSAGEM_ID_ESTUDANTE_INVALIDO,
  MENSAGEM_ESTUDANTE_NAO_ENCONTRADO,
  MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO,
  MENSAGEM_FILTRO_TURMA_INVALIDO,
  TAMANHO_MAXIMO_CODIGO_ESCOLAR,
} = await import('../src/services/estudantes.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS_NAO_GESTAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_PROFESSOR = 1;
const ID_TUTOR_ATIVO = 2;
const ID_GESTAO = 3;
const ID_TUTOR_2 = 7;
const ID_TUTOR_BLOQUEADO = 8;
const ID_TUTOR_DESATIVADO = 9;

// Marcadores fictícios usados para provar que nenhuma resposta de erro ecoa
// o nome ou o código do estudante enviado (RNF06).
const NOME_MARCADOR = 'Estudante Fictício Marcador QA';
const CODIGO_MARCADOR = 'TESTE-QA-9999';

let usuarios;
let turmas;
let estudantes;
let logs;
let proximoIdEstudante;

function erroPrisma(code, extra = {}) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  Object.assign(erro, extra);
  return erro;
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

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
  usuarios = [
    base(ID_PROFESSOR, 'PROFESSOR'),
    base(ID_TUTOR_ATIVO, 'TUTOR', { nome: 'Tutor Fictício A' }),
    base(ID_GESTAO, 'GESTAO'),
    base(4, 'PEDAGOGICO'),
    base(5, 'TECNICO_ADMINISTRATIVO'),
    base(ID_TUTOR_2, 'TUTOR', { nome: 'Tutor Fictício B' }),
    base(ID_TUTOR_BLOQUEADO, 'TUTOR', { nome: 'Tutor Fictício Bloqueado', status: 'BLOQUEADO' }),
    base(ID_TUTOR_DESATIVADO, 'TUTOR', { nome: 'Tutor Fictício Desativado', status: 'DESATIVADO' }),
  ];

  turmas = [
    { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
    { id: 2, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
  ];

  estudantes = [
    { id: 1, nome_completo: 'Estudante Fictício 03', codigo_escolar: 'TESTE-0003', turma_id: 2, tutor_id: null },
    { id: 2, nome_completo: 'Estudante Fictício 01', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR_ATIVO },
    { id: 3, nome_completo: 'Estudante Fictício 02', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: ID_TUTOR_BLOQUEADO },
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

/** Token assinado com o perfil informado (por padrão, o perfil do banco). */
function token(id, perfilNoToken) {
  const perfil = perfilNoToken ?? usuarios.find((u) => u.id === id).perfil;
  return jwt.sign({ id, perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

function autenticar(req, perfil) {
  const id = usuarios.find((u) => u.perfil === perfil).id;
  return req.set('Authorization', `Bearer ${token(id)}`);
}

const getEstudantes = (perfil, query = '') => autenticar(request(app).get(`/estudantes${query}`), perfil);
const postEstudantes = (corpo, perfil = 'GESTAO') =>
  autenticar(request(app).post('/estudantes'), perfil).send(corpo);
const putEstudante = (id, corpo, perfil = 'GESTAO') =>
  autenticar(request(app).put(`/estudantes/${id}`), perfil).send(corpo);

const CAMPOS_REDUZIDOS = ['id', 'nomeCompleto', 'turma', 'tutor'].sort();
const CAMPOS_TURMA = ['id', 'nome', 'etapa', 'anoLetivo'].sort();

function verificarSemVazamento(body) {
  for (const estudante of body) {
    expect(Object.keys(estudante).sort()).toEqual(CAMPOS_REDUZIDOS);
    expect(Object.keys(estudante.turma).sort()).toEqual(CAMPOS_TURMA);
    if (estudante.tutor !== null) expect(Object.keys(estudante.tutor).sort()).toEqual(['id', 'nome']);
  }
  const texto = JSON.stringify(body);
  expect(texto).not.toMatch(/codigoEscolar|codigo_escolar|TESTE-|email|@|status|BLOQUEADO|ATIVO/);
}

// ---------------------------------------------------------------------------
// RN20: nenhum caminho do GET entrega dados restritos a quem não é Gestão
// ---------------------------------------------------------------------------
describe('RN20 — dados reduzidos em todos os caminhos do GET', () => {
  it.each(PERFIS_NAO_GESTAO)('perfil %s com ?turmaId=1 recebe só os campos reduzidos', async (perfil) => {
    const res = await getEstudantes(perfil, '?turmaId=1');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.id)).toEqual([2, 3]);
    verificarSemVazamento(res.body);
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s: parâmetros extras na query não ampliam a resposta', async (perfil) => {
    const res = await getEstudantes(perfil, '?completo=true&select=codigo_escolar&perfil=GESTAO');
    expect(res.status).toBe(200);
    verificarSemVazamento(res.body);
    const { select } = mocks.estudanteFindMany.mock.calls[0][0];
    expect(select).not.toHaveProperty('codigo_escolar');
  });

  it('token antigo com perfil GESTAO de quem hoje é PROFESSOR: vale o perfil do banco (dados reduzidos)', async () => {
    const res = await request(app)
      .get('/estudantes')
      .set('Authorization', `Bearer ${token(ID_PROFESSOR, 'GESTAO')}`);
    expect(res.status).toBe(200);
    verificarSemVazamento(res.body);
  });

  it('token antigo com perfil GESTAO de quem hoje é PROFESSOR: POST responde 403', async () => {
    const res = await request(app)
      .post('/estudantes')
      .set('Authorization', `Bearer ${token(ID_PROFESSOR, 'GESTAO')}`)
      .send({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.estudanteCreate).not.toHaveBeenCalled();
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s com ?turmaId inexistente recebe 200 []', async (perfil) => {
    const res = await getEstudantes(perfil, '?turmaId=999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s com ?turmaId inválido recebe 400 sem ecoar o valor', async (perfil) => {
    const res = await getEstudantes(perfil, '?turmaId=TESTE-0001');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_FILTRO_TURMA_INVALIDO });
    expect(JSON.stringify(res.body)).not.toMatch(/TESTE-/);
  });

  it.each(PERFIS_NAO_GESTAO)('perfil %s: falha do banco no GET responde 500 genérico', async (perfil) => {
    mocks.estudanteFindMany.mockRejectedValueOnce(
      erroPrisma('P1001', { meta: { codigo_escolar: 'TESTE-0001', nome_completo: 'Estudante Fictício 01' } }),
    );
    const res = await getEstudantes(perfil);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  it('Gestão recebe codigoEscolar e tutor com e-mail e status em cada item, inclusive tutor bloqueado', async () => {
    const res = await getEstudantes('GESTAO', '?turmaId=1');
    expect(res.status).toBe(200);
    for (const e of res.body) {
      expect(Object.keys(e).sort()).toEqual(['codigoEscolar', 'id', 'nomeCompleto', 'turma', 'tutor'].sort());
      expect(Object.keys(e.tutor).sort()).toEqual(['email', 'id', 'nome', 'status']);
    }
    expect(res.body.find((e) => e.id === 3).tutor.status).toBe('BLOQUEADO');
  });
});

// ---------------------------------------------------------------------------
// RNF06: respostas de erro não ecoam nome nem código do estudante
// ---------------------------------------------------------------------------
describe('Erros de POST/PUT não ecoam nome nem código do estudante', () => {
  const casos = [
    ['POST turma inexistente (400)', () => postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 999 }), 400],
    ['POST tutor inválido (400)', () => postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1, tutorId: ID_TUTOR_BLOQUEADO }), 400],
    ['POST código longo (400)', () => postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR.repeat(20), turmaId: 1 }), 400],
    ['POST código duplicado (409)', () => postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: 'TESTE-0001', turmaId: 1 }), 409],
    ['POST perfil sem permissão (403)', () => postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1 }, 'PROFESSOR'), 403],
    ['PUT id inexistente (404)', () => putEstudante(999, { nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1 }), 404],
    ['PUT código de outro estudante (409)', () => putEstudante(1, { nomeCompleto: NOME_MARCADOR, codigoEscolar: 'TESTE-0001', turmaId: 1 }), 409],
    ['PUT perfil sem permissão (403)', () => putEstudante(1, { nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1 }, 'TUTOR'), 403],
  ];

  it.each(casos)('%s', async (_caso, enviar, status) => {
    const res = await enviar();
    expect(res.status).toBe(status);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toContain('Marcador');
    expect(texto).not.toContain('TESTE-');
    expect(Object.keys(res.body)).toEqual(['erro']);
    expect(logs).toHaveLength(0);
  });

  it('P2002 do banco com meta contendo o código responde 409 sem ecoar o código', async () => {
    mocks.estudanteCreate.mockRejectedValueOnce(
      erroPrisma('P2002', { meta: { target: ['codigo_escolar'], valor: CODIGO_MARCADOR } }),
    );
    const res = await postEstudantes({ nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO });
  });

  it('PUT: erro inesperado do banco responde 500 genérico, sem dados do estudante', async () => {
    mocks.estudanteUpdate.mockRejectedValueOnce(erroPrisma('P9999', { meta: { valor: CODIGO_MARCADOR } }));
    const res = await putEstudante(1, { nomeCompleto: NOME_MARCADOR, codigoEscolar: CODIGO_MARCADOR, turmaId: 1 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(logs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PUT: ordem das checagens e vínculo de tutoria (RN13)
// ---------------------------------------------------------------------------
describe('PUT /estudantes/{id} — ordem das checagens e RN13', () => {
  it('perfil sem permissão recebe 403 antes da validação do corpo e do id', async () => {
    const res = await putEstudante('abc', [], 'PEDAGOGICO');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
  });

  it('POST de perfil sem permissão com corpo inválido recebe 403 (não 400)', async () => {
    const res = await postEstudantes({}, 'TECNICO_ADMINISTRATIVO');
    expect(res.status).toBe(403);
  });

  it('id inexistente com turma inexistente responde 404 (recurso da URL primeiro)', async () => {
    const res = await putEstudante(999, { nomeCompleto: 'Estudante Fictício 09', turmaId: 999 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_ESTUDANTE_NAO_ENCONTRADO });
  });

  it('id inexistente com corpo inválido responde 400 (validação de entrada antes do banco)', async () => {
    const res = await putEstudante(999, { turmaId: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOME_ESTUDANTE_OBRIGATORIO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('id acima do Int do PostgreSQL responde 400', async () => {
    const res = await putEstudante('2147483648', { nomeCompleto: 'Estudante Fictício 09', turmaId: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ID_ESTUDANTE_INVALIDO });
  });

  it('editar só o nome e trocar a turma de estudante com tutor bloqueado mantém o vínculo (RN13/RN07)', async () => {
    const res = await putEstudante(3, { nomeCompleto: 'Estudante Fictício 02 Editado', turmaId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toMatchObject({ id: ID_TUTOR_BLOQUEADO, status: 'BLOQUEADO' });
    expect(res.body.turma.id).toBe(2);
    expect(mocks.estudanteUpdate.mock.calls[0][0].data).not.toHaveProperty('tutor_id');
    expect(estudantes.find((e) => e.id === 3).tutor_id).toBe(ID_TUTOR_BLOQUEADO);
  });

  it('trocar o tutor bloqueado por outro tutor desativado responde 400 e mantém o vínculo atual', async () => {
    const res = await putEstudante(3, { nomeCompleto: 'Estudante Fictício 02', turmaId: 1, tutorId: ID_TUTOR_DESATIVADO });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
    expect(estudantes.find((e) => e.id === 3).tutor_id).toBe(ID_TUTOR_BLOQUEADO);
  });

  it('trocar o tutor bloqueado por um tutor ativo funciona', async () => {
    const res = await putEstudante(3, { nomeCompleto: 'Estudante Fictício 02', turmaId: 1, tutorId: ID_TUTOR_2 });
    expect(res.status).toBe(200);
    expect(res.body.tutor).toMatchObject({ id: ID_TUTOR_2, status: 'ATIVO' });
  });

  it('vincular a si mesmo (usuário GESTAO) como tutor responde 400', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, tutorId: ID_GESTAO });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
  });

  it('tutorId no limite do Int, inexistente, responde 400 de tutor inválido', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1, tutorId: 2_147_483_647 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_INVALIDO });
  });

  it('codigoEscolar null no PUT limpa o código e libera o código para outro estudante', async () => {
    const limpar = await putEstudante(2, { nomeCompleto: 'Estudante Fictício 01', turmaId: 1, codigoEscolar: null });
    expect(limpar.status).toBe(200);
    expect(limpar.body.codigoEscolar).toBeNull();
    const reutilizar = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, codigoEscolar: 'TESTE-0001' });
    expect(reutilizar.status).toBe(200);
    expect(reutilizar.body.codigoEscolar).toBe('TESTE-0001');
  });

  it('código de outro estudante com espaços nas pontas no PUT responde 409', async () => {
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 2, codigoEscolar: '  TESTE-0001  ' });
    expect(res.status).toBe(409);
  });

  it('auditoria da edição registra a Gestão do banco como autora e não grava nada em falha', async () => {
    await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 999 });
    expect(logs).toHaveLength(0);
    const res = await putEstudante(1, { nomeCompleto: 'Estudante Fictício 03', turmaId: 1, tutorId: ID_TUTOR_ATIVO });
    expect(res.status).toBe(200);
    expect(logs).toEqual([{ usuario_id: ID_GESTAO, acao: ACOES_AUDITORIA.ESTUDANTE_EDITADO, recurso: 'estudantes/1' }]);
  });
});

// ---------------------------------------------------------------------------
// POST: entradas de borda
// ---------------------------------------------------------------------------
describe('POST /estudantes — entradas de borda', () => {
  it('tutorId: null explícito cadastra sem tutor e não consulta usuários além da sessão', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1, tutorId: null });
    expect(res.status).toBe(201);
    expect(res.body.tutor).toBeNull();
    expect(mocks.usuarioFindUnique).toHaveBeenCalledTimes(1);
  });

  it('código com 150 caracteres cercado de espaços é aceito (limite após trim)', async () => {
    const codigo = 'T'.repeat(TAMANHO_MAXIMO_CODIGO_ESCOLAR);
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1, codigoEscolar: `  ${codigo}  ` });
    expect(res.status).toBe(201);
    expect(res.body.codigoEscolar).toBe(codigo);
  });

  it('nome em Unicode decomposto (NFD) é gravado em NFC', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10'.normalize('NFD'), turmaId: 1 });
    expect(res.status).toBe(201);
    expect(res.body.nomeCompleto).toBe('Estudante Fictício 10'.normalize('NFC'));
  });

  it('código com acento em NFD é comparado em NFC (duplicidade detectada)', async () => {
    estudantes.push({ id: 50, nome_completo: 'Estudante Fictício 50', codigo_escolar: 'TESTE-Ç50', turma_id: 1, tutor_id: null });
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 51', turmaId: 1, codigoEscolar: 'TESTE-Ç50'.normalize('NFD') });
    expect(res.status).toBe(409);
  });

  it('Gestão: POST devolve 201 com tutor { id, nome, email, status } e turma { id, nome, etapa, anoLetivo }', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 2, tutorId: ID_TUTOR_2 });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.turma).sort()).toEqual(CAMPOS_TURMA);
    expect(Object.keys(res.body.tutor).sort()).toEqual(['email', 'id', 'nome', 'status']);
  });
});

// ---------------------------------------------------------------------------
// Decisões do dev pendentes com o Rafael — testes que documentam o
// comportamento ATUAL. Se o Rafael decidir diferente, ajustar aqui.
// ---------------------------------------------------------------------------
describe('Decisões pendentes (comportamento atual documentado)', () => {
  it('código escolar é comparado com diferença de maiúsculas/minúsculas: "teste-0001" ≠ "TESTE-0001"', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1, codigoEscolar: 'teste-0001' });
    expect(res.status).toBe(201);
  });

  it('código escolar acima de 150 caracteres é recusado (limite técnico)', async () => {
    const res = await postEstudantes({ nomeCompleto: 'Estudante Fictício 10', turmaId: 1, codigoEscolar: 'T'.repeat(151) });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Migration e schema do índice único de codigo_escolar (RN18)
// ---------------------------------------------------------------------------
describe('Migration 20261026000000_codigo_escolar_unico_estudante', () => {
  const sql = readFileSync(
    new URL('../prisma/migrations/20261026000000_codigo_escolar_unico_estudante/migration.sql', import.meta.url),
    'utf8',
  );
  const comandos = sql
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('--'))
    .join('\n');

  it('converte vazios em NULL antes de criar o índice único', () => {
    const posUpdate = comandos.search(/UPDATE\s+"estudantes"/);
    const posIndice = comandos.search(/CREATE UNIQUE INDEX\s+"estudantes_codigo_escolar_key"/);
    expect(posUpdate).toBeGreaterThan(-1);
    expect(posIndice).toBeGreaterThan(posUpdate);
    expect(comandos).toMatch(/SET\s+"codigo_escolar"\s*=\s*NULL/);
    expect(comandos).toMatch(/btrim\("codigo_escolar"\)\s*=\s*''/);
  });

  it('não apaga nem altera estrutura além do índice (sem DELETE, DROP, TRUNCATE, ALTER)', () => {
    expect(comandos).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
  });

  it('o UPDATE só atinge códigos vazios/só espaços (tem WHERE)', () => {
    const update = comandos.match(/UPDATE[\s\S]*?;/)[0];
    expect(update).toMatch(/WHERE/);
  });

  it('o schema declara codigo_escolar opcional e único', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const modelo = schema.match(/model Estudante \{[\s\S]*?\n\}/)[0];
    expect(modelo).toMatch(/codigo_escolar\s+String\?\s+@unique/);
    expect(modelo).not.toMatch(/nome_completo\s+String[^\n]*@unique/);
  });
});
