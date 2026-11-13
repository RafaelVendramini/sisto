// Testes complementares do QA — Issue #90 (limite de tentativas com falha no
// login e na troca da própria senha; SSD 1.8, Seção 12). Cobrem lacunas dos
// testes do dev: requisições simultâneas, CORS no 429, Retry-After decrescente,
// bloqueio sem consultar o banco, troca com senha temporária pendente (RN10),
// 409 da troca que não conta e IPv6.
// Somente dados fictícios (RN05); o banco é substituído por um mock em memória.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

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

const { criarApp } = await import('../src/app.js');
const { MENSAGEM_MUITAS_TENTATIVAS } = await import('../src/middlewares/limite-tentativas.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_CORRETA = 'SenhaFicticia123';
const SENHA_ERRADA = 'SenhaErradaFicticia9';
const SENHA_NOVA = 'NovaSenhaFicticia77';
const EMAIL_PROFESSOR = 'professor.qa90@sisto.exemplo';
const EMAIL_PENDENTE = 'pendente.qa90@sisto.exemplo';
const ORIGEM_FRONT = 'https://front.exemplo.test';
const IP_A = '203.0.113.30';

let hashSenha;
let banco;
let app;

beforeAll(async () => {
  hashSenha = await bcrypt.hash(SENHA_CORRETA, 4);
});

function novoUsuario(id, perfil, email, extra = {}) {
  return {
    id,
    nome: `Usuário Fictício ${id}`,
    email,
    senha_hash: hashSenha,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  };
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
  banco = [
    novoUsuario(1, 'PROFESSOR', EMAIL_PROFESSOR),
    novoUsuario(2, 'TUTOR', EMAIL_PENDENTE, { troca_senha_obrigatoria: true }),
  ];
  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const u = banco.find((x) =>
      where.id !== undefined ? x.id === where.id : x.email === where.email,
    );
    return u ? selecionar(u, select) : null;
  });
  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = banco.find((u) => u.id === where.id);
    Object.assign(registro, data);
    return selecionar(registro, select);
  });
  criarLog.mockReset();
  criarLog.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({ usuario: { findUnique, update }, logAuditoria: { create: criarLog } }),
  );
  app = criarApp({ cors: { corsOrigin: ORIGEM_FRONT, ambiente: 'test', avisar: () => {} } });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function login(email, senha, { ip = IP_A } = {}) {
  return request(app).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha });
}

function trocar(corpo, token, { ip = IP_A } = {}) {
  return request(app)
    .put('/conta/senha')
    .set('X-Forwarded-For', ip)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
}

async function token(email = EMAIL_PROFESSOR) {
  const res = await login(email, SENHA_CORRETA);
  expect(res.status).toBe(200);
  return res.body.token;
}

describe('QA #90 — login', () => {
  it('10 tentativas com falha simultâneas: só 5 chegam à verificação, 5 recebem 429', async () => {
    const respostas = await Promise.all(
      Array.from({ length: 10 }, () => login(EMAIL_PROFESSOR, SENHA_ERRADA)),
    );
    const status = respostas.map((r) => r.status).sort();
    expect(status.filter((s) => s === 401)).toHaveLength(5);
    expect(status.filter((s) => s === 429)).toHaveLength(5);
  });

  it('bloqueado, o 429 sai sem consultar o banco (sem custo de bcrypt)', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA)).status).toBe(401);
    }
    findUnique.mockClear();
    const res = await login(EMAIL_PROFESSOR, SENHA_CORRETA);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
    expect(res.body.token).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('o 429 leva Access-Control-Allow-Origin para a origem do front (senão o navegador o esconderia)', async () => {
    for (let i = 0; i < 5; i += 1) await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    const res = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', IP_A)
      .set('Origin', ORIGEM_FRONT)
      .send({ email: EMAIL_PROFESSOR, senha: SENHA_ERRADA });
    expect(res.status).toBe(429);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_FRONT);
  });

  it('Retry-After diminui com o tempo dentro da janela', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00-03:00'));
    for (let i = 0; i < 5; i += 1) await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    vi.setSystemTime(new Date('2026-11-12T10:10:00-03:00'));
    const res = await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBe(5 * 60);
  });

  it('IPv6 do mesmo /56 compartilha o contador (trocar o fim do endereço não renova as tentativas)', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: '2001:db8:0:1::1' })).status).toBe(401);
    }
    const res = await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: '2001:db8:0:1::ffff' });
    expect(res.status).toBe(429);
  });

  it('e-mail em formato não-texto (400) não conta e não gera erro 500', async () => {
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', IP_A)
        .send({ email: { $ne: null }, senha: SENHA_ERRADA });
      expect(res.status).toBe(400);
    }
    expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA)).status).toBe(401);
  });
});

describe('QA #90 — troca da própria senha', () => {
  it('usuário com senha temporária pendente (RN10) também é limitado, e o 429 não vira o 403 da RN10', async () => {
    const t = await token(EMAIL_PENDENTE);
    for (let i = 0; i < 5; i += 1) {
      const res = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, t);
      expect(res.status).toBe(400);
    }
    const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, t);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(banco[1].troca_senha_obrigatoria).toBe(true);
    expect(banco[1].status).toBe('ATIVO');
  });

  it('o 409 (conflito concorrente) não conta como falha', async () => {
    const t = await token();
    $transaction.mockImplementation(async () => {
      throw Object.assign(new Error('conflito fictício'), { code: 'P2034' });
    });
    for (let i = 0; i < 6; i += 1) {
      const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, t);
      expect(res.status).toBe(409);
    }
    // Ainda há 5 falhas disponíveis.
    $transaction.mockReset();
    for (let i = 0; i < 5; i += 1) {
      const res = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, t);
      expect(res.status).toBe(400);
    }
    expect((await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, t)).status).toBe(429);
  });

  it('o 429 da troca leva Access-Control-Allow-Origin e não é 401 (o front não encerra a sessão)', async () => {
    const t = await token();
    for (let i = 0; i < 5; i += 1) {
      await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, t);
    }
    const res = await request(app)
      .put('/conta/senha')
      .set('X-Forwarded-For', IP_A)
      .set('Origin', ORIGEM_FRONT)
      .set('Authorization', `Bearer ${t}`)
      .send({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA });
    expect(res.status).toBe(429);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_FRONT);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('falhas no login e na troca têm contadores independentes', async () => {
    const t = await token();
    for (let i = 0; i < 5; i += 1) {
      expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA)).status).toBe(401);
    }
    expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA)).status).toBe(429);
    // O bloqueio do login não impede a troca com o token já emitido.
    const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, t);
    expect(res.status).toBe(204);
  });
});
