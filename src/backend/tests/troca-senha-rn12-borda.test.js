// QA — Issue #18: casos de borda da RN12 (tokens anteriores à troca deixam de
// valer, inclusive o usado na própria troca) quando o login cai no MESMO
// segundo de uma troca de senha e recebe iat do segundo seguinte
// (calcularIatToken). O relógio é congelado só no Date (vi.useFakeTimers com
// toFake: ['Date']) para reproduzir o cenário de forma determinística.
// Somente dados fictícios (RN05). Não depende do banco (Prisma em memória).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { findUnique, update, $transaction, criarLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  $transaction: vi.fn(),
  criarLog: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique, update },
    logAuditoria: { create: criarLog },
    $transaction,
  },
}));

vi.mock('../src/services/senha.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, gerarHashSenha: (senha) => original.gerarHashSenha(senha, 4) };
});

const { default: app } = await import('../src/app.js');
const { gerarHashSenha } = await import('../src/services/senha.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_INICIAL = 'SenhaInicialFicticia1';
const SENHA_TEMPORARIA = 'Temporaria#2026';
const SENHA_NOVA = 'NovaSenhaFicticia9';
const OUTRA_TEMPORARIA = 'OutraTemporaria#77';

// 12:00:00.100 de um dia fictício (UTC).
const INSTANTE = new Date(Date.UTC(2026, 9, 15, 12, 0, 0, 100));

let hashInicial;
let banco;

beforeAll(async () => {
  hashInicial = await gerarHashSenha(SENHA_INICIAL);
});

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function usuarioFicticio(id, perfil, email) {
  return {
    id,
    nome: `Usuário QA Fictício ${id}`,
    email,
    senha_hash: hashInicial,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuarioFicticio(1, 'GESTAO', 'gestao.qa@sisto.exemplo'),
    usuarioFicticio(2, 'PROFESSOR', 'professor.qa@sisto.exemplo'),
  ];
  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const u = banco.find((r) => (where.id !== undefined ? r.id === where.id : r.email === where.email));
    return u ? selecionar(u, select) : null;
  });
  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const u = banco.find((r) => r.id === where.id);
    Object.assign(u, data);
    return selecionar(u, select);
  });
  criarLog.mockReset();
  criarLog.mockResolvedValue({ id: 1 });
  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({ usuario: { findUnique, update }, logAuditoria: { create: criarLog } }),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(INSTANTE);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.JWT_SECRET;
});

async function tokenPorLogin(email, senha) {
  const res = await request(app).post('/auth/login').send({ email, senha });
  expect(res.status).toBe(200);
  return res.body.token;
}

describe('RN12 — borda: login no mesmo segundo de uma troca', () => {
  it('troca da própria senha no mesmo segundo do login pós-redefinição: o token usado na troca deve deixar de valer (401)', async () => {
    const tokenGestao = await tokenPorLogin('gestao.qa@sisto.exemplo', SENHA_INICIAL);
    const redef = await request(app)
      .put('/usuarios/2/senha')
      .set('Authorization', `Bearer ${tokenGestao}`)
      .send({ novaSenha: SENHA_TEMPORARIA });
    expect(redef.status).toBe(204);

    // Login no mesmo segundo da redefinição: recebe iat do segundo seguinte.
    const tokenPendente = await tokenPorLogin('professor.qa@sisto.exemplo', SENHA_TEMPORARIA);

    vi.setSystemTime(new Date(INSTANTE.getTime() + 500)); // ainda 12:00:00
    const troca = await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${tokenPendente}`)
      .send({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_NOVA });
    expect(troca.status).toBe(204);

    // RN12: o token usado na própria troca não pode continuar valendo.
    const depois = await request(app)
      .get('/rota-inexistente')
      .set('Authorization', `Bearer ${tokenPendente}`);
    expect(depois.status).toBe(401);
  });

  it('segunda redefinição pela Gestão no mesmo segundo: o token emitido entre as duas deve deixar de valer (401)', async () => {
    const tokenGestao = await tokenPorLogin('gestao.qa@sisto.exemplo', SENHA_INICIAL);
    const redefinir = (novaSenha) =>
      request(app)
        .put('/usuarios/2/senha')
        .set('Authorization', `Bearer ${tokenGestao}`)
        .send({ novaSenha });

    expect((await redefinir(SENHA_TEMPORARIA)).status).toBe(204);
    const tokenEntreAsDuas = await tokenPorLogin('professor.qa@sisto.exemplo', SENHA_TEMPORARIA);

    vi.setSystemTime(new Date(INSTANTE.getTime() + 800)); // ainda 12:00:00
    expect((await redefinir(OUTRA_TEMPORARIA)).status).toBe(204);

    const res = await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${tokenEntreAsDuas}`)
      .send({ senhaAtual: OUTRA_TEMPORARIA, novaSenha: SENHA_NOVA });
    expect(res.status).toBe(401);
  });

  it('controle: troca em segundo posterior ao iat forçado invalida o token normalmente', async () => {
    const tokenGestao = await tokenPorLogin('gestao.qa@sisto.exemplo', SENHA_INICIAL);
    await request(app)
      .put('/usuarios/2/senha')
      .set('Authorization', `Bearer ${tokenGestao}`)
      .send({ novaSenha: SENHA_TEMPORARIA });
    const tokenPendente = await tokenPorLogin('professor.qa@sisto.exemplo', SENHA_TEMPORARIA);

    vi.setSystemTime(new Date(INSTANTE.getTime() + 2000)); // 12:00:02
    await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${tokenPendente}`)
      .send({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_NOVA });

    const depois = await request(app)
      .get('/rota-inexistente')
      .set('Authorization', `Bearer ${tokenPendente}`);
    expect(depois.status).toBe(401);
  });
});
