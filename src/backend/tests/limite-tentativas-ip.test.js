// Testes do limite por IP no login (Issue #134; SSD 1.13, Seção 12, "Limite
// por IP no login"): além do limite por IP + e-mail (5 falhas), o
// POST /auth/login aceita até 100 falhas (401) em 15 minutos por IP, com
// qualquer e-mail; acima disso responde 429 com Retry-After e a mesma
// mensagem. O primeiro limite atingido recusa. O PUT /conta/senha não muda.
// Somente dados fictícios (RN05): e-mails em sisto.exemplo e IPs de
// documentação (RFC 5737). Não dependem do banco (prisma em memória).
// Isolamento: cada teste cria o seu app com criarApp() (contadores próprios).
// Portas TCP: cada requisição do Supertest abre uma porta, e no Windows a
// suíte inteira em sequência pode esgotá-las (falhas falsas EADDRINUSE). Por
// isso só os testes marcados "(produção)" usam o limite real de 100; os
// demais usam um limite menor (LIMITE_IP_TESTE), com o mesmo comportamento.
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

// Custo bcrypt baixo só para acelerar os testes (a política de senha é a real).
vi.mock('../src/services/senha.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, gerarHashSenha: (senha) => original.gerarHashSenha(senha, 4) };
});

const { criarApp, default: appPadrao } = await import('../src/app.js');
const {
  LIMITE_FALHAS_LOGIN_POR_IP,
  LIMITE_TENTATIVAS_COM_FALHA,
  JANELA_TENTATIVAS_MS,
  MENSAGEM_MUITAS_TENTATIVAS,
  CHAVE_LIMITADORES,
  chaveTentativasLogin,
  chaveTentativasLoginPorIp,
} = await import('../src/middlewares/limite-tentativas.js');
const { MENSAGEM_CREDENCIAIS_INVALIDAS } = await import('../src/services/auth.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_CORRETA = 'SenhaFicticia123';
const SENHA_ERRADA = 'SenhaErradaFicticia9';
const SENHA_NOVA = 'NovaSenhaFicticia77';

/** Limite por IP dos testes de comportamento (o padrão de produção é 100). */
const LIMITE_IP_TESTE = 10;

// Usuários fictícios suficientes para 100+ e-mails diferentes, todos com o
// mesmo hash de custo baixo (as falhas com e-mail existente são rápidas).
const QUANTIDADE_USUARIOS = 120;
const emailDe = (n) => `usuario${n}.limiteip@sisto.exemplo`;

// IPs de documentação (RFC 5737) e saltos fictícios da cadeia do Render.
const IP_A = '203.0.113.40';
const IP_B = '203.0.113.50';
const BORDA = '198.51.100.35';
const BALANCEADOR = '10.0.0.91';

/** X-Forwarded-For como chega à API no Render ('trust proxy' = 3): "cliente, borda, balanceador". */
function cadeiaRender(cliente) {
  return `${cliente}, ${BORDA}, ${BALANCEADOR}`;
}

let hashSenha;
let banco;
let app;

beforeAll(async () => {
  hashSenha = await bcrypt.hash(SENHA_CORRETA, 4);
});

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
  banco = Array.from({ length: QUANTIDADE_USUARIOS }, (_, i) => ({
    id: i + 1,
    nome: `Usuário Fictício ${i + 1}`,
    email: emailDe(i + 1),
    senha_hash: hashSenha,
    perfil: 'PROFESSOR',
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  }));

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
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

  app = criarApp({ limiteTentativas: { maximoPorIp: LIMITE_IP_TESTE } });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auxiliares HTTP
// ---------------------------------------------------------------------------

function login(email, senha, { ip = cadeiaRender(IP_A), alvo = app } = {}) {
  return request(alvo).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha });
}

function trocar(corpo, token, { ip = cadeiaRender(IP_A) } = {}) {
  return request(app)
    .put('/conta/senha')
    .set('X-Forwarded-For', ip)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
}

/**
 * `vezes` falhas (401) do mesmo IP, cada uma com um e-mail diferente
 * (usuários `inicio`, `inicio + 1`, ...): nenhuma chega ao limite por IP + e-mail.
 */
async function falharComEmailsDiferentes(vezes, { inicio = 1, ...opcoes } = {}) {
  for (let i = 0; i < vezes; i += 1) {
    const res = await login(emailDe(inicio + i), SENHA_ERRADA, opcoes);
    expect(res.status, `falha ${i + 1}`).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
  }
}

async function tokenPorLogin(email, opcoes = {}) {
  const res = await login(email, SENHA_CORRETA, opcoes);
  expect(res.status).toBe(200);
  return res.body.token;
}

function esperar429(res) {
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
  const retryAfter = Number(res.headers['retry-after']);
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(JANELA_TENTATIVAS_MS / 1000);
}

// ---------------------------------------------------------------------------

describe('Configuração (SSD 1.13, Seção 12)', () => {
  it('padrão: 100 falhas por IP na mesma janela de 15 minutos; o limite por IP + e-mail segue 5', () => {
    expect(LIMITE_FALHAS_LOGIN_POR_IP).toBe(100);
    expect(LIMITE_TENTATIVAS_COM_FALHA).toBe(5);
    expect(JANELA_TENTATIVAS_MS).toBe(15 * 60 * 1000);
  });

  it('cada app tem os três limitadores (login por IP, login por IP + e-mail e troca de senha)', () => {
    expect(Object.keys(app.locals[CHAVE_LIMITADORES]).sort()).toEqual(
      ['login', 'loginPorIp', 'trocaSenha'].sort(),
    );
  });

  it('a chave do limite por IP não depende do e-mail e difere da chave por IP + e-mail', () => {
    const chave = (email) => chaveTentativasLoginPorIp({ ip: IP_A, body: { email } });
    expect(chave(emailDe(1))).toBe(chave(emailDe(2)));
    expect(chave(undefined)).toBe(chave(emailDe(1)));
    expect(chave(emailDe(1))).not.toContain('limiteip');
    expect(chaveTentativasLoginPorIp({ ip: IP_B })).not.toBe(chave(emailDe(1)));
    expect(chave(emailDe(1))).not.toBe(chaveTentativasLogin({ ip: IP_A, body: { email: emailDe(1) } }));
  });
});

describe('POST /auth/login — limite só por IP', () => {
  it('(produção) a 101ª falha do mesmo IP com e-mails diferentes recebe 429 com Retry-After e a mesma mensagem', async () => {
    const appProducao = criarApp();
    await falharComEmailsDiferentes(100, { alvo: appProducao });

    // Um e-mail que ainda não falhou nenhuma vez: só o limite por IP o barra.
    const res = await login(emailDe(101), SENHA_ERRADA, { alvo: appProducao });
    esperar429(res);
    expect(res.text).not.toContain('limiteip');
    expect(res.headers['ratelimit-policy']).toBe(`${LIMITE_FALHAS_LOGIN_POR_IP};w=900`);
  });

  it('(produção) o app padrão (export default) também aplica o limite por IP', async () => {
    // IP exclusivo deste teste: o app padrão é compartilhado no arquivo.
    const opcoes = { ip: cadeiaRender('203.0.113.77'), alvo: appPadrao };
    await falharComEmailsDiferentes(100, opcoes);
    esperar429(await login(emailDe(101), SENHA_ERRADA, opcoes));
  });

  it('acima do limite, até a senha correta de um e-mail novo recebe 429 naquele IP', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(110), SENHA_CORRETA));
  });

  it('e-mails inexistentes também contam (401) e o 429 é igual ao de um e-mail existente', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE - 2);
    for (const n of [1, 2]) {
      const res = await login(`inexistente${n}.limiteip@sisto.exemplo`, SENHA_ERRADA);
      expect(res.status).toBe(401);
    }
    const inexistente = await login('inexistente3.limiteip@sisto.exemplo', SENHA_ERRADA);
    const existente = await login(emailDe(105), SENHA_ERRADA);
    esperar429(inexistente);
    esperar429(existente);
    expect(inexistente.body).toEqual(existente.body);
  });

  it('um IP diferente não é afetado', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(101), SENHA_ERRADA));

    const outroIp = { ip: cadeiaRender(IP_B) };
    const falha = await login(emailDe(101), SENHA_ERRADA, outroIp);
    expect(falha.status).toBe(401);
    await tokenPorLogin(emailDe(102), outroIp);
  });

  it('o mesmo cliente continua barrado com outro endereço forjado no começo do X-Forwarded-For', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(101), SENHA_ERRADA, { ip: `198.51.100.1, ${cadeiaRender(IP_A)}` }));
  });

  it('logins bem-sucedidos não contam', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE - 1);
    for (let n = 100; n < 110; n += 1) await tokenPorLogin(emailDe(n));
    // A última falha permitida ainda é aceita (401); só a seguinte é barrada.
    expect((await login(emailDe(110), SENHA_ERRADA)).status).toBe(401);
    esperar429(await login(emailDe(111), SENHA_ERRADA));
  });

  it('respostas 400 (corpo incompleto e caractere nulo) não contam', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE - 1);
    for (let i = 0; i < 10; i += 1) {
      const incompleto = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', cadeiaRender(IP_A))
        .send({ email: emailDe(1) });
      expect(incompleto.status).toBe(400);

      const nulo = await login(`usuario\u00001.limiteip@sisto.exemplo`, SENHA_ERRADA);
      expect(nulo.status).toBe(400);
    }
    expect((await login(emailDe(100), SENHA_ERRADA)).status).toBe(401);
    esperar429(await login(emailDe(101), SENHA_ERRADA));
  });

  it('o 429 do limite por IP + e-mail não soma no limite por IP', async () => {
    // 5 falhas do mesmo e-mail e várias tentativas já barradas (429) nele.
    for (let i = 0; i < 5; i += 1) expect((await login(emailDe(1), SENHA_ERRADA)).status).toBe(401);
    for (let i = 0; i < 20; i += 1) esperar429(await login(emailDe(1), SENHA_ERRADA));

    // Só as 5 falhas contaram: ainda cabem LIMITE_IP_TESTE - 5 falhas com outros e-mails.
    await falharComEmailsDiferentes(LIMITE_IP_TESTE - 5, { inicio: 2 });
    esperar429(await login(emailDe(LIMITE_IP_TESTE + 2), SENHA_ERRADA));
  });

  it('as tentativas recusadas pelo limite por IP não prolongam o bloqueio nem contam no outro limite', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T10:00:00-03:00'));

    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    const primeiro = await login(emailDe(101), SENHA_ERRADA);
    esperar429(primeiro);
    expect(Number(primeiro.headers['retry-after'])).toBe(15 * 60);
    for (let i = 0; i < 10; i += 1) esperar429(await login(emailDe(101), SENHA_ERRADA));

    // Fim da janela: volta a aceitar, e o e-mail 101 tem as suas 5 falhas
    // inteiras (os 429 acima não somaram no limite por IP + e-mail).
    vi.setSystemTime(new Date('2026-11-23T10:15:01-03:00'));
    for (let i = 0; i < 5; i += 1) expect((await login(emailDe(101), SENHA_ERRADA)).status).toBe(401);
    esperar429(await login(emailDe(101), SENHA_ERRADA));
  });

  it('não altera o status de nenhum usuário nem grava nada (não bloqueia a conta — RN07)', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(101), SENHA_ERRADA));
    expect(banco.every((u) => u.status === 'ATIVO')).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('limite por IP configurável por criarApp (só para testes)', async () => {
    const appCurto = criarApp({ limiteTentativas: { maximoPorIp: 3 } });
    await falharComEmailsDiferentes(3, { alvo: appCurto });
    esperar429(await login(emailDe(4), SENHA_ERRADA, { alvo: appCurto }));
  });
});

describe('POST /auth/login — o limite por IP + e-mail continua valendo', () => {
  it('a 6ª falha do mesmo e-mail recebe 429, antes do limite do IP', async () => {
    for (let i = 0; i < 5; i += 1) expect((await login(emailDe(1), SENHA_ERRADA)).status).toBe(401);
    esperar429(await login(emailDe(1), SENHA_ERRADA));

    // O IP segue liberado para outros e-mails.
    expect((await login(emailDe(2), SENHA_ERRADA)).status).toBe(401);
    await tokenPorLogin(emailDe(3));
  });

  it('numa tentativa aceita, os cabeçalhos RateLimit continuam sendo os do limite por IP + e-mail', async () => {
    const res = await login(emailDe(1), SENHA_ERRADA);
    expect(res.status).toBe(401);
    expect(res.headers['ratelimit-policy']).toBe(`${LIMITE_TENTATIVAS_COM_FALHA};w=900`);
  });

  it('no 429 do limite por IP, a política informada é a do limite por IP', async () => {
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    const res = await login(emailDe(101), SENHA_ERRADA);
    esperar429(res);
    expect(res.headers['ratelimit-policy']).toBe(`${LIMITE_IP_TESTE};w=900`);
  });
});

describe('PUT /conta/senha — não é afetado pelo limite por IP', () => {
  it('com o login barrado no IP, a troca da própria senha segue normal', async () => {
    const token = await tokenPorLogin(emailDe(120));
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(101), SENHA_ERRADA));

    const falha = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token);
    expect(falha.status).toBe(400);
    const ok = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, token);
    expect(ok.status).toBe(204);
  });

  it('a troca continua só com o limite por IP + usuário (5 falhas) e não soma no login', async () => {
    const token = await tokenPorLogin(emailDe(120));
    for (let i = 0; i < 5; i += 1) {
      const res = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token);
      expect(res.status).toBe(400);
      expect(res.headers['ratelimit-policy']).toBe(`${LIMITE_TENTATIVAS_COM_FALHA};w=900`);
    }
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token));

    // As falhas da troca não entram no limite por IP do login: todas as falhas ainda cabem.
    await falharComEmailsDiferentes(LIMITE_IP_TESTE);
    esperar429(await login(emailDe(101), SENHA_ERRADA));
  });
});
