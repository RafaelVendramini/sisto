// Testes complementares do QA para a Issue #91 — auditoria do cadastro e da
// edição de usuários (RNF04, RNF06). Somente dados fictícios (RN05).
// Lacunas cobertas (não testadas em usuarios-auditoria.test.js):
// - usuario_id vem do token e recurso do id gerado pelo banco, mesmo que o
//   corpo traga id/usuario_id/acao/recurso forjados (campos ignorados);
// - Gestão com troca de senha pendente (403) e Gestão bloqueada/desativada
//   (401) não gravam auditoria;
// - P2002 no update do PUT (corrida de e-mail) → 409 sem auditoria;
// - PUT /usuarios/{id}/senha grava só "senha redefinida pela Gestão", sem
//   "usuário editado" (as duas ações não se misturam).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  estudanteCount: vi.fn(),
  criarLogTx: vi.fn(),
  criarLogForaDaTransacao: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
      count: mocks.count,
    },
    estudante: { count: mocks.estudanteCount },
    logAuditoria: { create: mocks.criarLogForaDaTransacao },
    $transaction: mocks.$transaction,
  },
}));

// Custo bcrypt baixo só neste arquivo: aqui se testa a auditoria, não o hash
// (o custo real é coberto em senha.test.js/usuarios.test.js). Com o custo 12,
// a carga extra fazia outro arquivo da suíte estourar o timeout de 5 s.
vi.mock('../src/services/senha.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, gerarHashSenha: (senha) => original.gerarHashSenha(senha, 4) };
});

const { default: app } = await import('../src/app.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-qa-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_GESTAO = 3;
const ID_GESTAO_2 = 7;
const ID_GESTAO_3 = 8;
const ID_ALVO = 6;
const HASH_FICTICIO = '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';

let banco;
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

function erroPrisma(code) {
  const erro = new Error(`erro simulado ${code}`);
  erro.code = code;
  return erro;
}

function usuario(id, perfil, extra = {}) {
  return {
    id,
    nome: `Pessoa Ficticia ${id}`,
    email: `pessoa.${id}@sisto.exemplo`,
    senha_hash: HASH_FICTICIO,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  };
}

const buscar = (id) => banco.find((u) => u.id === id);

const clienteTransacao = {
  usuario: {
    findUnique: mocks.findUnique,
    findMany: mocks.findMany,
    create: mocks.create,
    update: mocks.update,
    count: mocks.count,
  },
  estudante: { count: mocks.estudanteCount },
  logAuditoria: { create: mocks.criarLogTx },
};

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuario(ID_PROFESSOR, 'PROFESSOR'),
    usuario(ID_GESTAO, 'GESTAO'),
    usuario(ID_ALVO, 'PROFESSOR'),
    usuario(ID_GESTAO_2, 'GESTAO'),
    usuario(ID_GESTAO_3, 'GESTAO'),
  ];
  logs = [];
  proximoId = 500;

  mocks.findUnique.mockReset();
  mocks.findUnique.mockImplementation(async ({ where, select }) => {
    const r = banco.find((u) => (where.id !== undefined ? u.id === where.id : u.email === where.email));
    return r ? selecionar(r, select) : null;
  });
  mocks.create.mockReset();
  mocks.create.mockImplementation(async ({ data, select }) => {
    if (banco.some((u) => u.email === data.email)) throw erroPrisma('P2002');
    const r = { id: proximoId++, senha_alterada_em: null, ...data };
    banco.push(r);
    return selecionar(r, select);
  });
  mocks.update.mockReset();
  mocks.update.mockImplementation(async ({ where, data, select }) => {
    const r = buscar(where.id);
    if (!r) throw erroPrisma('P2025');
    Object.assign(r, data);
    return selecionar(r, select);
  });
  mocks.count.mockReset();
  mocks.count.mockImplementation(
    async ({ where }) =>
      banco.filter((u) => u.perfil === where.perfil && u.status === where.status && u.id !== where.id?.not)
        .length,
  );
  mocks.estudanteCount.mockReset();
  mocks.estudanteCount.mockResolvedValue(0);
  mocks.findMany.mockReset();

  mocks.criarLogTx.mockReset();
  mocks.criarLogTx.mockImplementation(async ({ data }) => {
    logs.push({ id: logs.length + 1, ...data });
    return { id: logs.length };
  });
  mocks.criarLogForaDaTransacao.mockReset();
  mocks.criarLogForaDaTransacao.mockRejectedValue(new Error('LogAuditoria gravado fora da transação'));

  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (fn) => {
    const bancoAntes = structuredClone(banco);
    const logsAntes = structuredClone(logs);
    try {
      return await fn(clienteTransacao);
    } catch (erro) {
      banco = bancoAntes;
      logs = logsAntes;
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDe(id) {
  return jwt.sign({ id, perfil: buscar(id).perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

const corpoCadastro = (extra = {}) => ({
  nome: 'Cadastro Ficticio QA',
  email: 'cadastro.qa@sisto.exemplo',
  perfil: 'PROFESSOR',
  senha: 'Temporaria123',
  ...extra,
});

function esperarSemLog() {
  expect(logs).toEqual([]);
  expect(mocks.criarLogTx).not.toHaveBeenCalled();
  expect(mocks.criarLogForaDaTransacao).not.toHaveBeenCalled();
}

describe('QA #91 — campos forjados no corpo não alteram o registro de auditoria', () => {
  it('POST: id/usuario_id/usuarioId/acao/recurso do corpo são ignorados', async () => {
    const res = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`)
      .send(
        corpoCadastro({
          id: 42,
          usuario_id: ID_GESTAO_2,
          usuarioId: ID_GESTAO_2,
          acao: 'acao forjada',
          recurso: 'usuarios/1',
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(500);
    expect(logs).toEqual([
      { id: 1, usuario_id: ID_GESTAO, acao: ACOES_AUDITORIA.USUARIO_CRIADO, recurso: 'usuarios/500' },
    ]);
  });

  it('PUT: usuario_id vem do token e recurso do id da URL, não do corpo', async () => {
    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO_2)}`)
      .send({ nome: 'Nome Editado QA', id: 1, usuario_id: ID_GESTAO, acao: 'x', recurso: 'usuarios/1' });

    expect(res.status).toBe(200);
    expect(logs).toEqual([
      {
        id: 1,
        usuario_id: ID_GESTAO_2,
        acao: ACOES_AUDITORIA.USUARIO_EDITADO,
        recurso: `usuarios/${ID_ALVO}`,
      },
    ]);
    expect(buscar(1).nome).toBe('Pessoa Ficticia 1');
  });
});

describe('QA #91 — sessões recusadas não gravam auditoria', () => {
  it('403: Gestão com troca de senha obrigatória pendente (RN10)', async () => {
    buscar(ID_GESTAO).troca_senha_obrigatoria = true;
    const token = tokenDe(ID_GESTAO);

    const post = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send(corpoCadastro());
    const put = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'BLOQUEADO' });

    expect(post.status).toBe(403);
    expect(put.status).toBe(403);
    expect(buscar(ID_ALVO).status).toBe('ATIVO');
    esperarSemLog();
  });

  it.each(['BLOQUEADO', 'DESATIVADO'])('401: Gestão %s com token ainda válido (RN09)', async (status) => {
    const token = tokenDe(ID_GESTAO);
    buscar(ID_GESTAO).status = status;

    const post = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send(corpoCadastro());
    const put = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Nome Qualquer' });

    expect(post.status).toBe(401);
    expect(put.status).toBe(401);
    esperarSemLog();
  });

  it('401: token assinado com outro segredo', async () => {
    const forjado = jwt.sign({ id: ID_GESTAO, perfil: 'GESTAO' }, 'outro-segredo-ficticio-com-mais-de-32-chars', {
      algorithm: 'HS256',
    });

    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${forjado}`)
      .send({ status: 'DESATIVADO' });

    expect(res.status).toBe(401);
    esperarSemLog();
  });
});

describe('QA #91 — conflito de e-mail no update não grava auditoria', () => {
  it('409: P2002 no update (e-mail tomado por outra requisição entre a checagem e o update)', async () => {
    mocks.update.mockImplementationOnce(async () => {
      throw erroPrisma('P2002');
    });

    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`)
      .send({ email: 'livre.na.checagem@sisto.exemplo' });

    expect(res.status).toBe(409);
    esperarSemLog();
  });
});

describe('QA #91 — redefinição de senha pela Gestão não vira "usuário editado"', () => {
  it('PUT /usuarios/{id}/senha grava só "senha redefinida pela Gestão"', async () => {
    const res = await request(app)
      .put(`/usuarios/${ID_ALVO}/senha`)
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`)
      .send({ novaSenha: 'NovaTemporaria123' });

    expect(res.status).toBe(204);
    expect(logs.map((l) => l.acao)).toEqual([ACOES_AUDITORIA.SENHA_REDEFINIDA_PELA_GESTAO]);
    expect(logs[0].recurso).toBe(`usuarios/${ID_ALVO}`);
    expect(JSON.stringify(logs)).not.toContain('NovaTemporaria123');
  });
});
