// Testes de GET, POST e PUT /categorias (Issue #38) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (usuários fictícios para a sessão, categorias e LogAuditoria).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { TENTATIVAS_TRANSACAO } from '../src/lib/transacao.js';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  categoriaFindMany: vi.fn(),
  categoriaFindUnique: vi.fn(),
  categoriaCreate: vi.fn(),
  categoriaUpdate: vi.fn(),
  logCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.usuarioFindUnique },
    categoria: {
      findMany: mocks.categoriaFindMany,
      findUnique: mocks.categoriaFindUnique,
      create: mocks.categoriaCreate,
      update: mocks.categoriaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO, MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  MENSAGEM_CATEGORIA_DUPLICADA,
  MENSAGEM_CATEGORIA_NAO_ENCONTRADA,
  MENSAGEM_ID_CATEGORIA_INVALIDO,
  MENSAGEM_NOME_CATEGORIA_OBRIGATORIO,
  MENSAGEM_CORPO_CATEGORIA_INVALIDO,
  MENSAGEM_DESCRICAO_CATEGORIA_INVALIDA,
  MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA,
  TAMANHO_MAXIMO_NOME_CATEGORIA,
  TAMANHO_MAXIMO_DESCRICAO_CATEGORIA,
  criarCategoria,
} = await import('../src/services/categorias.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const PERFIS_GERENCIAM = ['GESTAO', 'PEDAGOGICO'];
const PERFIS_SEM_PERMISSAO = ['PROFESSOR', 'TUTOR', 'TECNICO_ADMINISTRATIVO'];
const ID_TROCA_PENDENTE = 6;

let usuarios;
let categorias;
let logs;
let proximoIdCategoria;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

/** Client "Prisma" em memória usado pelo app e passado como tx nas transações. */
function clientMock() {
  return {
    usuario: { findUnique: mocks.usuarioFindUnique },
    categoria: {
      findMany: mocks.categoriaFindMany,
      findUnique: mocks.categoriaFindUnique,
      create: mocks.categoriaCreate,
      update: mocks.categoriaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;

  usuarios = PERFIS.map((perfil, i) => ({
    id: i + 1,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  }));
  usuarios.push({
    id: ID_TROCA_PENDENTE,
    perfil: 'GESTAO',
    status: 'ATIVO',
    troca_senha_obrigatoria: true,
    senha_alterada_em: null,
  });

  categorias = [
    { id: 1, nome: 'Indisciplina', descricao: null },
    { id: 2, nome: 'Bullying', descricao: 'Descrição fictícia de exemplo' },
  ];
  proximoIdCategoria = 3;
  logs = [];

  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = usuarios.find((u) => u.id === where.id);
    return encontrado ? selecionar(encontrado, select) : null;
  });

  mocks.categoriaFindMany.mockReset();
  mocks.categoriaFindMany.mockImplementation(async ({ select, orderBy } = {}) => {
    const lista = [...categorias];
    if (orderBy) lista.sort((a, b) => a.nome.localeCompare(b.nome) || a.id - b.id);
    return lista.map((c) => selecionar(c, select));
  });

  mocks.categoriaFindUnique.mockReset();
  mocks.categoriaFindUnique.mockImplementation(async ({ where, select }) => {
    const encontrada = categorias.find((c) => c.id === where.id);
    return encontrada ? selecionar(encontrada, select) : null;
  });

  mocks.categoriaCreate.mockReset();
  mocks.categoriaCreate.mockImplementation(async ({ data, select }) => {
    const registro = { id: proximoIdCategoria++, descricao: null, ...data };
    categorias.push(registro);
    return selecionar(registro, select);
  });

  mocks.categoriaUpdate.mockReset();
  mocks.categoriaUpdate.mockImplementation(async ({ where, data, select }) => {
    const registro = categorias.find((c) => c.id === where.id);
    if (!registro) throw erroPrisma('P2025');
    Object.assign(registro, data);
    return selecionar(registro, select);
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

function tokenDoPerfil(perfil) {
  return tokenDoUsuario(usuarios.find((u) => u.perfil === perfil).id);
}

function autenticar(req, perfil) {
  return perfil ? req.set('Authorization', `Bearer ${tokenDoPerfil(perfil)}`) : req;
}

const getCategorias = (perfil = 'GESTAO') => autenticar(request(app).get('/categorias'), perfil);
const postCategorias = (corpo, perfil = 'GESTAO') =>
  autenticar(request(app).post('/categorias'), perfil).send(corpo);
const putCategoria = (id, corpo, perfil = 'GESTAO') =>
  autenticar(request(app).put(`/categorias/${id}`), perfil).send(corpo);

// ---------------------------------------------------------------------------
// GET /categorias
// ---------------------------------------------------------------------------
describe('GET /categorias', () => {
  it.each(PERFIS)('responde 200 para o perfil %s, com a lista ordenada por nome', async (perfil) => {
    const res = await getCategorias(perfil);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 2, nome: 'Bullying', descricao: 'Descrição fictícia de exemplo' },
      { id: 1, nome: 'Indisciplina', descricao: null },
    ]);
  });

  it('pede ao banco a ordenação por nome e depois id, só com id, nome e descricao', async () => {
    await getCategorias();
    expect(mocks.categoriaFindMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, descricao: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
  });

  it('sem token responde 401', async () => {
    const res = await getCategorias(null);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.categoriaFindMany).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403 (RN10)', async () => {
    const res = await request(app)
      .get('/categorias')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    expect(mocks.categoriaFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /categorias
// ---------------------------------------------------------------------------
describe('POST /categorias', () => {
  it.each(PERFIS_GERENCIAM)('perfil %s cria a categoria: 201 com a categoria criada', async (perfil) => {
    const res = await postCategorias(
      { nome: '  Conflitos  ', descricao: '  Descrição fictícia  ' },
      perfil,
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 3, nome: 'Conflitos', descricao: 'Descrição fictícia' });
    expect(categorias.at(-1)).toEqual({ id: 3, nome: 'Conflitos', descricao: 'Descrição fictícia' });
  });

  it('descrição ausente, vazia ou só com espaços é gravada como null', async () => {
    for (const [i, extra] of [{}, { descricao: '' }, { descricao: '   ' }, { descricao: null }].entries()) {
      const res = await postCategorias({ nome: `Categoria Fictícia ${i}`, ...extra });
      expect(res.status).toBe(201);
      expect(res.body.descricao).toBeNull();
    }
  });

  it('ignora campos fora de { nome, descricao } (ex.: id)', async () => {
    const res = await postCategorias({ id: 99, nome: 'Evasão' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(3);
    expect(mocks.categoriaCreate.mock.calls[0][0].data).toEqual({ nome: 'Evasão', descricao: null });
  });

  it('grava a criação no LogAuditoria com recurso categorias/<id>, sem o nome (RNF04)', async () => {
    const gestao = usuarios.find((u) => u.perfil === 'GESTAO');
    const res = await postCategorias({ nome: 'Agressões' });
    expect(res.status).toBe(201);
    expect(logs).toEqual([
      { usuario_id: gestao.id, acao: ACOES_AUDITORIA.CATEGORIA_CRIADA, recurso: `categorias/${res.body.id}` },
    ]);
    expect(JSON.stringify(logs)).not.toContain('Agressões');
  });

  it('usa transação serializável', async () => {
    await postCategorias({ nome: 'Evasão' });
    expect(mocks.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it.each(PERFIS_SEM_PERMISSAO)('perfil %s responde 403 e nada é gravado', async (perfil) => {
    const res = await postCategorias({ nome: 'Evasão' }, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.categoriaCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('sem token responde 401', async () => {
    const res = await postCategorias({ nome: 'Evasão' }, null);
    expect(res.status).toBe(401);
    expect(mocks.categoriaCreate).not.toHaveBeenCalled();
  });

  it('com troca de senha pendente responde 403', async () => {
    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send({ nome: 'Evasão' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    expect(mocks.categoriaCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['ausente', {}],
    ['vazio', { nome: '' }],
    ['só com espaços', { nome: '    ' }],
    ['null', { nome: null }],
    ['número', { nome: 123 }],
  ])('nome %s responde 400', async (_caso, corpo) => {
    const res = await postCategorias(corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOME_CATEGORIA_OBRIGATORIO });
    expect(mocks.categoriaCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('corpo que não é objeto (array) responde 400', async () => {
    const res = await postCategorias([{ nome: 'Evasão' }]);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_CATEGORIA_INVALIDO });
  });

  it('descrição que não é texto responde 400', async () => {
    const res = await postCategorias({ nome: 'Evasão', descricao: 42 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DESCRICAO_CATEGORIA_INVALIDA });
  });

  it('nome e descrição acima do limite técnico respondem 400', async () => {
    const nomeLongo = await postCategorias({ nome: 'a'.repeat(TAMANHO_MAXIMO_NOME_CATEGORIA + 1) });
    expect(nomeLongo.status).toBe(400);
    const descricaoLonga = await postCategorias({
      nome: 'Evasão',
      descricao: 'a'.repeat(TAMANHO_MAXIMO_DESCRICAO_CATEGORIA + 1),
    });
    expect(descricaoLonga.status).toBe(400);
    const noLimite = await postCategorias({ nome: 'a'.repeat(TAMANHO_MAXIMO_NOME_CATEGORIA) });
    expect(noLimite.status).toBe(201);
  });

  it.each([
    ['mesmo texto', 'Bullying'],
    ['outra caixa', 'BULLYING'],
    ['caixa mista', 'bUlLyInG'],
    ['espaços nas pontas', '   bullying   '],
  ])('nome duplicado (%s) responde 409 (RN18) e nada é gravado', async (_caso, nome) => {
    const res = await postCategorias({ nome });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_DUPLICADA, codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA });
    expect(mocks.categoriaCreate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('detecta duplicidade mesmo com nome gravado fora da API com espaços', async () => {
    categorias.push({ id: 3, nome: '  Evasão ', descricao: null });
    proximoIdCategoria = 4;
    const res = await postCategorias({ nome: 'evasão' });
    expect(res.status).toBe(409);
  });

  it('JSON malformado responde 400', async () => {
    const res = await request(app)
      .post('/categorias')
      .set('Authorization', `Bearer ${tokenDoPerfil('GESTAO')}`)
      .set('Content-Type', 'application/json')
      .send('{"nome": ');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
  });
});

// ---------------------------------------------------------------------------
// PUT /categorias/{id}
// ---------------------------------------------------------------------------
describe('PUT /categorias/{id}', () => {
  it.each(PERFIS_GERENCIAM)('perfil %s edita a categoria: 200 com a categoria editada', async (perfil) => {
    const res = await putCategoria(1, { nome: ' Indisciplina grave ', descricao: 'Texto fictício' }, perfil);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, nome: 'Indisciplina grave', descricao: 'Texto fictício' });
  });

  it('manter o próprio nome, inclusive com outra caixa, não é duplicidade', async () => {
    const res = await putCategoria(2, { nome: 'BULLYING' });
    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('BULLYING');
  });

  it('descricao ausente mantém a atual; vazia ou null apaga (vira null)', async () => {
    const semDescricao = await putCategoria(2, { nome: 'Bullying' });
    expect(semDescricao.body.descricao).toBe('Descrição fictícia de exemplo');

    const vazia = await putCategoria(2, { nome: 'Bullying', descricao: '  ' });
    expect(vazia.body.descricao).toBeNull();

    categorias[1].descricao = 'Outra descrição fictícia';
    const nula = await putCategoria(2, { nome: 'Bullying', descricao: null });
    expect(nula.body.descricao).toBeNull();
  });

  it('grava a edição no LogAuditoria com recurso categorias/<id> (RNF04)', async () => {
    const pedagogico = usuarios.find((u) => u.perfil === 'PEDAGOGICO');
    const res = await putCategoria(1, { nome: 'Indisciplina leve' }, 'PEDAGOGICO');
    expect(res.status).toBe(200);
    expect(logs).toEqual([
      { usuario_id: pedagogico.id, acao: ACOES_AUDITORIA.CATEGORIA_EDITADA, recurso: 'categorias/1' },
    ]);
  });

  it('id inexistente responde 404 e nada é gravado', async () => {
    const res = await putCategoria(999, { nome: 'Evasão' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_NAO_ENCONTRADA });
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('categoria removida entre a leitura e o update (P2025) responde 404', async () => {
    mocks.categoriaUpdate.mockRejectedValueOnce(erroPrisma('P2025'));
    const res = await putCategoria(1, { nome: 'Evasão' });
    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5', '01', '99999999999'])('id inválido (%s) responde 400', async (id) => {
    const res = await putCategoria(id, { nome: 'Evasão' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ID_CATEGORIA_INVALIDO });
  });

  it.each([
    ['ausente', {}],
    ['vazio', { nome: '' }],
    ['só com espaços', { nome: '  ' }],
  ])('nome %s responde 400', async (_caso, corpo) => {
    const res = await putCategoria(1, corpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_NOME_CATEGORIA_OBRIGATORIO });
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
  });

  it.each(['Bullying', 'bullying', '  BULLYING  '])(
    'nome de outra categoria (%s) responde 409 (RN18)',
    async (nome) => {
      const res = await putCategoria(1, { nome });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_DUPLICADA, codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA });
      expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    },
  );

  it.each(PERFIS_SEM_PERMISSAO)('perfil %s responde 403', async (perfil) => {
    const res = await putCategoria(1, { nome: 'Evasão' }, perfil);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
  });

  it('sem token responde 401', async () => {
    const res = await putCategoria(1, { nome: 'Evasão' }, null);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// RN21: sem exclusão
// ---------------------------------------------------------------------------
describe('Sem DELETE /categorias/{id} (RN21)', () => {
  it('DELETE responde 404 (rota inexistente) e não altera nada', async () => {
    const res = await autenticar(request(app).delete('/categorias/1'), 'GESTAO');
    expect(res.status).toBe(404);
    expect(categorias).toHaveLength(2);
  });

  it('o roteador de categorias não registra o método DELETE', async () => {
    const { default: rotasCategorias } = await import('../src/routes/categorias.js');
    const metodos = rotasCategorias.stack.flatMap((camada) => Object.keys(camada.route?.methods ?? {}));
    expect(metodos.sort()).toEqual(['get', 'post', 'put']);
  });
});

// ---------------------------------------------------------------------------
// Concorrência (RN18): conflito de serialização é repetido
// ---------------------------------------------------------------------------
describe('Concorrência no cadastro de categorias', () => {
  it('conflito de serialização (P2034) é repetido; na repetição o nome já existe e responde 409', async () => {
    // Simula a outra requisição concorrente: ela grava "Evasão" antes da repetição.
    mocks.$transaction.mockImplementationOnce(async () => {
      categorias.push({ id: proximoIdCategoria++, nome: 'Evasão', descricao: null });
      throw erroPrisma('P2034');
    });
    const res = await postCategorias({ nome: 'EVASÃO' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CATEGORIA_DUPLICADA, codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA });
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('conflito de serialização seguido de sucesso responde 201', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await postCategorias({ nome: 'Evasão' });
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
  });

  it('esgotadas as tentativas, responde 409 pedindo para tentar de novo', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await postCategorias({ nome: 'Evasão' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_CATEGORIA, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(TENTATIVAS_TRANSACAO);
  });

  it('erro inesperado do banco responde 500 genérico', async () => {
    mocks.$transaction.mockRejectedValueOnce(new Error('falha fictícia'));
    const res = await postCategorias({ nome: 'Evasão' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });

  it('o service aceita db injetado (sem o módulo prisma)', async () => {
    const db = { ...clientMock(), $transaction: async (op) => op(clientMock()) };
    const categoria = await criarCategoria({ nome: 'Sofrimento emocional' }, { id: 3 }, { db });
    expect(categoria).toEqual({ id: 3, nome: 'Sofrimento emocional', descricao: null });
  });
});

// ---------------------------------------------------------------------------
// QA (Issue #38): lacunas complementares — somente dados fictícios (RN05)
// ---------------------------------------------------------------------------
describe('QA — complementos da Issue #38', () => {
  it('PUT com troca de senha pendente responde 403 e nada é gravado (RN10)', async () => {
    const res = await request(app)
      .put('/categorias/1')
      .set('Authorization', `Bearer ${tokenDoUsuario(ID_TROCA_PENDENTE)}`)
      .send({ nome: 'Evasão' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it.each(PERFIS_SEM_PERMISSAO)(
    'perfil %s: a permissão é checada antes da validação e da existência (403, sem consultar o banco)',
    async (perfil) => {
      const idInvalido = await putCategoria('abc', {}, perfil);
      expect(idInvalido.status).toBe(403);
      const inexistente = await putCategoria(999, { nome: 'Evasão' }, perfil);
      expect(inexistente.status).toBe(403);
      const duplicado = await postCategorias({ nome: 'Bullying' }, perfil);
      expect(duplicado.status).toBe(403);
      expect(mocks.categoriaFindMany).not.toHaveBeenCalled();
      expect(mocks.categoriaFindUnique).not.toHaveBeenCalled();
      expect(mocks.$transaction).not.toHaveBeenCalled();
    },
  );

  it('PUT sem token não consulta nem grava nada', async () => {
    const res = await putCategoria(1, { nome: 'Evasão' }, null);
    expect(res.status).toBe(401);
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('RN18: duplicidade com letras acentuadas em outra caixa (AGRESSÕES x Agressões) responde 409', async () => {
    const criada = await postCategorias({ nome: 'Agressões' });
    expect(criada.status).toBe(201);
    const duplicada = await postCategorias({ nome: '  AGRESSÕES ' });
    expect(duplicada.status).toBe(409);
    expect(duplicada.body).toEqual({ erro: MENSAGEM_CATEGORIA_DUPLICADA, codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA });
    expect(logs).toHaveLength(1);
  });

  it('RN18: o mesmo acento digitado de outra forma (NFD x NFC) responde 409 e o nome é gravado em NFC', async () => {
    const criada = await postCategorias({ nome: 'Evasão' });
    expect(criada.status).toBe(201);
    expect(criada.body.nome).toBe('Evasão');
    const duplicada = await postCategorias({ nome: 'EVASÃO' });
    expect(duplicada.status).toBe(409);
  });

  it('RN18: duplicidade com tabulação/quebra de linha nas pontas responde 409', async () => {
    const res = await postCategorias({ nome: '\t Bullying \n' });
    expect(res.status).toBe(409);
  });

  it('PUT: renomear para o nome de outra categoria depois de criada na mesma sessão responde 409', async () => {
    const criada = await postCategorias({ nome: 'Conflitos' });
    expect(criada.status).toBe(201);
    const res = await putCategoria(1, { nome: 'CONFLITOS' });
    expect(res.status).toBe(409);
    expect(categorias.find((c) => c.id === 1).nome).toBe('Indisciplina');
  });

  it('PUT: nome gravado sem espaços nas pontas e só id/nome/descricao na resposta', async () => {
    const res = await putCategoria(1, { nome: '   Indisciplina   ', extra: 'ignorado' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['descricao', 'id', 'nome']);
    expect(mocks.categoriaUpdate.mock.calls[0][0].data).toEqual({ nome: 'Indisciplina' });
  });

  it('PUT: corpo array ou descrição não textual respondem 400', async () => {
    const corpoArray = await putCategoria(1, [{ nome: 'Evasão' }]);
    expect(corpoArray.status).toBe(400);
    expect(corpoArray.body).toEqual({ erro: MENSAGEM_CORPO_CATEGORIA_INVALIDO });
    const descricaoNumero = await putCategoria(1, { nome: 'Evasão', descricao: 7 });
    expect(descricaoNumero.status).toBe(400);
    expect(descricaoNumero.body).toEqual({ erro: MENSAGEM_DESCRICAO_CATEGORIA_INVALIDA });
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
  });

  it('PUT: conflito de serialização (P2034) é repetido e responde 200', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await putCategoria(1, { nome: 'Indisciplina leve' });
    expect(res.status).toBe(200);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(1);
  });

  it('LogAuditoria da edição não contém nome nem descrição (RNF04)', async () => {
    await putCategoria(2, { nome: 'Bullying virtual', descricao: 'Descrição fictícia sigilosa' });
    expect(JSON.stringify(logs)).not.toMatch(/Bullying|sigilosa/);
  });

  it.each(['patch', 'delete'])('RN21: %s /categorias/{id} não existe (404) para a Gestão', async (metodo) => {
    const res = await autenticar(request(app)[metodo]('/categorias/1'), 'GESTAO').send({ nome: 'X' });
    expect(res.status).toBe(404);
    expect(categorias).toHaveLength(2);
    expect(mocks.categoriaUpdate).not.toHaveBeenCalled();
  });

  it('DELETE /categorias (coleção) também não existe (404)', async () => {
    const res = await autenticar(request(app).delete('/categorias'), 'GESTAO');
    expect(res.status).toBe(404);
  });

  it('o roteador de categorias está montado em protegidas depois do bloqueio de troca de senha', async () => {
    const { protegidas } = await import('../src/routes/index.js');
    const { default: rotasCategorias } = await import('../src/routes/categorias.js');
    const { bloquearComTrocaDeSenhaPendente } = await import('../src/middlewares/autenticacao.js');
    const camadas = protegidas.stack.map((c) => c.handle);
    const posBloqueio = camadas.indexOf(bloquearComTrocaDeSenhaPendente);
    const posCategorias = camadas.indexOf(rotasCategorias);
    expect(posCategorias).toBeGreaterThan(posBloqueio);
    expect(posBloqueio).toBeGreaterThan(-1);
  });
});
