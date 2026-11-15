// Testes complementares do QA para GET, POST e PUT /turmas (Issue #40).
// Cobrem casos de borda não exercitados em tests/turmas.test.js: sessão
// (RN09), ordem permissão x validação (RN01/RF14), autoria da auditoria,
// normalização de texto e ausência de DELETE para outros perfis.
// Somente dados fictícios (RN05). Sem banco: src/lib/prisma.js é substituído
// por um "banco" em memória.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  turmaFindMany: vi.fn(),
  turmaFindUnique: vi.fn(),
  turmaCreate: vi.fn(),
  turmaUpdate: vi.fn(),
  logCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.usuarioFindUnique },
    turma: {
      findMany: mocks.turmaFindMany,
      findUnique: mocks.turmaFindUnique,
      create: mocks.turmaCreate,
      update: mocks.turmaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_PERFIL_SEM_PERMISSAO } = await import('../src/middlewares/autenticacao.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const {
  MENSAGEM_CORPO_TURMA_INVALIDO,
  MENSAGEM_TURMA_NAO_ENCONTRADA,
  TAMANHO_MAXIMO_NOME_TURMA,
} = await import('../src/services/turmas.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-qa-com-mais-de-32-caracteres';
const EM = 'Ensino Médio';
const PERFIS_SEM_PERMISSAO = ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const TURMA_VALIDA = Object.freeze({ nome: '9º Z', etapa: EM, anoLetivo: 2026 });

let usuarios;
let turmas;
let logs;
let proximoId;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function clientMock() {
  return {
    usuario: { findUnique: mocks.usuarioFindUnique },
    turma: {
      findMany: mocks.turmaFindMany,
      findUnique: mocks.turmaFindUnique,
      create: mocks.turmaCreate,
      update: mocks.turmaUpdate,
    },
    logAuditoria: { create: mocks.logCreate },
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  usuarios = [
    { id: 1, perfil: 'GESTAO', status: 'ATIVO' },
    { id: 2, perfil: 'PROFESSOR', status: 'ATIVO' },
    { id: 3, perfil: 'TUTOR', status: 'ATIVO' },
    { id: 4, perfil: 'PEDAGOGICO', status: 'ATIVO' },
    { id: 5, perfil: 'TECNICO_ADMINISTRATIVO', status: 'ATIVO' },
    { id: 7, perfil: 'GESTAO', status: 'BLOQUEADO' },
    { id: 8, perfil: 'GESTAO', status: 'INATIVO' },
  ].map((u) => ({ ...u, troca_senha_obrigatoria: false, senha_alterada_em: null }));

  turmas = [
    { id: 1, nome: '1º A', etapa: EM, ano_letivo: 2026 },
    { id: 2, nome: '2º B', etapa: EM, ano_letivo: 2025 },
  ];
  proximoId = 3;
  logs = [];

  mocks.usuarioFindUnique.mockReset().mockImplementation(async ({ where, select }) => {
    const u = usuarios.find((x) => x.id === where.id);
    return u ? selecionar(u, select) : null;
  });
  mocks.turmaFindMany.mockReset().mockImplementation(async ({ where, select } = {}) => {
    let lista = [...turmas];
    if (where?.ano_letivo !== undefined) lista = lista.filter((t) => t.ano_letivo === where.ano_letivo);
    return lista.map((t) => selecionar(t, select));
  });
  mocks.turmaFindUnique.mockReset().mockImplementation(async ({ where, select }) => {
    const t = turmas.find((x) => x.id === where.id);
    return t ? selecionar(t, select) : null;
  });
  mocks.turmaCreate.mockReset().mockImplementation(async ({ data, select }) => {
    const registro = { id: proximoId++, ...data };
    turmas.push(registro);
    return selecionar(registro, select);
  });
  mocks.turmaUpdate.mockReset().mockImplementation(async ({ where, data, select }) => {
    const registro = turmas.find((t) => t.id === where.id);
    Object.assign(registro, data);
    return selecionar(registro, select);
  });
  mocks.logCreate.mockReset().mockImplementation(async ({ data }) => {
    logs.push(data);
    return { id: logs.length };
  });
  mocks.$transaction.mockReset().mockImplementation(async (operacao) => operacao(clientMock()));
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id, { segredo = SEGREDO_TESTE, expiresIn = '8h' } = {}) {
  const u = usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, segredo, { algorithm: 'HS256', expiresIn });
}

function idDoPerfil(perfil) {
  return usuarios.find((u) => u.perfil === perfil && u.status === 'ATIVO').id;
}

const comToken = (req, tk) => req.set('Authorization', `Bearer ${tk}`);

describe('Sessão (RN09 / RNF06) nas rotas de turmas', () => {
  it.each([
    ['BLOQUEADO', 7],
    ['INATIVO', 8],
  ])('usuário %s com token ainda válido recebe 401 em GET, POST e PUT', async (_status, id) => {
    const tk = token(id);
    const respostas = [
      await comToken(request(app).get('/turmas'), tk),
      await comToken(request(app).post('/turmas'), tk).send(TURMA_VALIDA),
      await comToken(request(app).put('/turmas/1'), tk).send(TURMA_VALIDA),
    ];
    for (const res of respostas) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    }
    expect(mocks.turmaFindMany).not.toHaveBeenCalled();
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
  });

  it('token assinado com outro segredo recebe 401', async () => {
    const tk = token(1, { segredo: 'outro-segredo-ficticio-com-mais-de-32-caracteres' });
    const res = await comToken(request(app).get('/turmas'), tk);
    expect(res.status).toBe(401);
  });

  it('token expirado recebe 401', async () => {
    const tk = token(1, { expiresIn: -10 });
    const res = await comToken(request(app).post('/turmas'), tk).send(TURMA_VALIDA);
    expect(res.status).toBe(401);
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it('cabeçalho Authorization malformado recebe 401', async () => {
    const res = await request(app).get('/turmas').set('Authorization', 'Basic qualquer');
    expect(res.status).toBe(401);
  });
});

describe('Permissão (RN01 / RF14) vem antes da validação e da existência', () => {
  it.each(PERFIS_SEM_PERMISSAO)('POST com corpo inválido pelo perfil %s responde 403 (não 400)', async (perfil) => {
    const res = await comToken(request(app).post('/turmas'), token(idDoPerfil(perfil))).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
  });

  it.each(PERFIS_SEM_PERMISSAO)(
    'PUT em turma inexistente pelo perfil %s responde 403 (não revela existência)',
    async (perfil) => {
      const res = await comToken(request(app).put('/turmas/999'), token(idDoPerfil(perfil))).send(TURMA_VALIDA);
      expect(res.status).toBe(403);
      expect(mocks.turmaFindUnique).not.toHaveBeenCalled();
    },
  );

  it.each(PERFIS_SEM_PERMISSAO)('DELETE /turmas/1 pelo perfil %s responde 404 e nada muda (RN21)', async (perfil) => {
    const res = await comToken(request(app).delete('/turmas/1'), token(idDoPerfil(perfil)));
    expect(res.status).toBe(404);
    expect(turmas).toHaveLength(2);
  });

  it('DELETE /turmas/1 sem token responde 401 (rota protegida, nada muda)', async () => {
    const res = await request(app).delete('/turmas/1');
    expect(res.status).toBe(401);
    expect(turmas).toHaveLength(2);
  });

  it('DELETE /turmas (coleção) pela Gestão responde 404', async () => {
    const res = await comToken(request(app).delete('/turmas'), token(1));
    expect(res.status).toBe(404);
    expect(turmas).toHaveLength(2);
  });
});

describe('Entrada e normalização', () => {
  it('POST sem corpo responde 400 com a mensagem de corpo inválido', async () => {
    const res = await comToken(request(app).post('/turmas'), token(1));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_TURMA_INVALIDO });
  });

  it('POST com corpo JSON que é texto responde 400', async () => {
    const res = await comToken(request(app).post('/turmas'), token(1))
      .set('Content-Type', 'application/json')
      .send('"turma"');
    expect(res.status).toBe(400);
    expect(mocks.turmaCreate).not.toHaveBeenCalled();
  });

  it('PUT sem corpo em turma existente responde 400 e não grava', async () => {
    const res = await comToken(request(app).put('/turmas/1'), token(1));
    expect(res.status).toBe(400);
    expect(mocks.turmaUpdate).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it('PUT parcial (só nome) responde 400: PUT exige o corpo completo', async () => {
    const res = await comToken(request(app).put('/turmas/1'), token(1)).send({ nome: '1º B' });
    expect(res.status).toBe(400);
    expect(turmas[0].nome).toBe('1º A');
  });

  it('o limite de tamanho do nome é aplicado depois do trim', async () => {
    const nome = `   ${'n'.repeat(TAMANHO_MAXIMO_NOME_TURMA)}   `;
    const res = await comToken(request(app).post('/turmas'), token(1)).send({ ...TURMA_VALIDA, nome });
    expect(res.status).toBe(201);
    expect(res.body.nome).toHaveLength(TAMANHO_MAXIMO_NOME_TURMA);
  });

  it('textos são gravados normalizados (NFC)', async () => {
    const res = await comToken(request(app).post('/turmas'), token(1)).send({
      nome: '3º C',
      etapa: 'Ensino Médio'.normalize('NFD'),
      anoLetivo: 2026,
    });
    expect(res.status).toBe(201);
    expect(res.body.etapa).toBe(EM.normalize('NFC'));
    expect(turmas.at(-1).etapa).toBe(EM.normalize('NFC'));
  });

  it('espaços INTERNOS diferentes não contam como a mesma turma (RN18 só ignora as pontas)', async () => {
    const res = await comToken(request(app).post('/turmas'), token(1)).send({
      nome: '1º  A',
      etapa: EM,
      anoLetivo: 2026,
    });
    expect(res.status).toBe(201);
  });

  it('turma duplicada em OUTRO ano via PUT (troca só o ano para um ano livre) responde 200', async () => {
    const res = await comToken(request(app).put('/turmas/2'), token(1)).send({
      nome: '2º B',
      etapa: EM,
      anoLetivo: 2024,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, nome: '2º B', etapa: EM, anoLetivo: 2024 });
  });
});

describe('Resposta e auditoria', () => {
  it('GET devolve cada turma só com id, nome, etapa e anoLetivo', async () => {
    const res = await comToken(request(app).get('/turmas'), token(idDoPerfil('PROFESSOR')));
    expect(res.status).toBe(200);
    for (const turma of res.body) {
      expect(Object.keys(turma).sort()).toEqual(['anoLetivo', 'etapa', 'id', 'nome']);
    }
  });

  it('o autor da auditoria vem do token, não do corpo', async () => {
    const res = await comToken(request(app).post('/turmas'), token(1)).send({
      ...TURMA_VALIDA,
      usuarioId: 2,
      usuario_id: 2,
    });
    expect(res.status).toBe(201);
    expect(logs).toHaveLength(1);
    expect(logs[0].usuario_id).toBe(1);
    expect(logs[0].recurso).toBe(`turmas/${res.body.id}`);
  });

  it('PUT 404 não grava auditoria', async () => {
    const res = await comToken(request(app).put('/turmas/12345'), token(1)).send(TURMA_VALIDA);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_NAO_ENCONTRADA });
    expect(logs).toHaveLength(0);
  });

  it('falha ao gravar a auditoria faz a operação falhar (500), sem resposta de sucesso', async () => {
    mocks.logCreate.mockRejectedValueOnce(new Error('falha fictícia na auditoria'));
    const res = await comToken(request(app).post('/turmas'), token(1)).send(TURMA_VALIDA);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
  });
});
