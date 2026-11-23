// Testes do limite de tentativas com falha (Issue #90 — RF02, RF03, RNF03,
// RNF06; SSD 1.8, Seção 12 "Limite de tentativas"): POST /auth/login (chave
// IP + e-mail) e PUT /conta/senha (chave IP + usuário logado), 5 falhas em
// 15 minutos, 429 com Retry-After, contador em memória, trust proxy.
// Somente dados fictícios (RN05). Não dependem do banco: src/lib/prisma.js é
// substituído por um "banco" em memória.
// Isolamento: cada teste cria o seu app com criarApp(), que tem os seus
// próprios contadores (nada vaza entre os testes).
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
  MENSAGEM_MUITAS_TENTATIVAS,
  LIMITE_TENTATIVAS_COM_FALHA,
  JANELA_TENTATIVAS_MS,
  chaveTentativasLogin,
  limitarTentativasLogin,
} = await import('../src/middlewares/limite-tentativas.js');
const { MENSAGEM_CREDENCIAIS_INVALIDAS } = await import('../src/services/auth.js');
const { MENSAGEM_SENHA_ATUAL_INCORRETA } = await import('../src/services/troca-senha.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_CORRETA = 'SenhaFicticia123';
const SENHA_ERRADA = 'SenhaErradaFicticia9';
const SENHA_NOVA = 'NovaSenhaFicticia77';

const EMAIL_PROFESSOR = 'professor.limite@sisto.exemplo';
const EMAIL_TUTOR = 'tutor.limite@sisto.exemplo';
const EMAIL_BLOQUEADO = 'bloqueado.limite@sisto.exemplo';
const EMAIL_INEXISTENTE = 'ninguem.limite@sisto.exemplo';

// IPs de documentação (RFC 5737), fictícios.
const IP_A = '203.0.113.10';
const IP_B = '203.0.113.20';
// Saltos fictícios da cadeia do Render (cliente → borda → balanceador → API):
// 198.51.100.0/24 (RFC 5737) para a borda e 10.0.0.0/8 (rede privada) para o
// balanceador interno. Mudam entre requisições, como no Render.
const BORDA_1 = '198.51.100.35';
const BORDA_2 = '198.51.100.69';
const BALANCEADOR_1 = '10.0.0.91';
const BALANCEADOR_2 = '10.0.0.140';

/** X-Forwarded-For como chega à API no Render: "cliente, borda, balanceador". */
function cadeiaRender(cliente, borda = BORDA_1, balanceador = BALANCEADOR_1) {
  return `${cliente}, ${borda}, ${balanceador}`;
}

let hashSenha;
let banco;

beforeAll(async () => {
  hashSenha = await bcrypt.hash(SENHA_CORRETA, 4);
});

function novoUsuario(id, perfil, email, status = 'ATIVO') {
  return {
    id,
    nome: `Usuário Fictício ${id}`,
    email,
    senha_hash: hashSenha,
    perfil,
    status,
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
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

let app;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    novoUsuario(1, 'PROFESSOR', EMAIL_PROFESSOR),
    novoUsuario(2, 'TUTOR', EMAIL_TUTOR),
    novoUsuario(3, 'TUTOR', EMAIL_BLOQUEADO, 'BLOQUEADO'),
  ];

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

  app = criarApp({
    // Rota auxiliar autenticada, para provar que as demais rotas não são limitadas.
    registrarRotasExtras: (a) => a.get('/teste-livre', (req, res) => res.json({ ok: true })),
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auxiliares HTTP
// ---------------------------------------------------------------------------

function login(email, senha, { ip = IP_A, alvo = app } = {}) {
  return request(alvo).post('/auth/login').set('X-Forwarded-For', ip).send({ email, senha });
}

function trocar(corpo, token, { ip = IP_A, alvo = app } = {}) {
  return request(alvo)
    .put('/conta/senha')
    .set('X-Forwarded-For', ip)
    .set('Authorization', `Bearer ${token}`)
    .send(corpo);
}

async function falharLogin(vezes, email = EMAIL_PROFESSOR, opcoes = {}) {
  for (let i = 0; i < vezes; i += 1) {
    const res = await login(email, SENHA_ERRADA, opcoes);
    expect(res.status).toBe(401);
  }
}

async function tokenPorLogin(email = EMAIL_PROFESSOR, senha = SENHA_CORRETA, opcoes = {}) {
  const res = await login(email, senha, opcoes);
  expect(res.status).toBe(200);
  return res.body.token;
}

async function falharTroca(vezes, token, opcoes = {}) {
  for (let i = 0; i < vezes; i += 1) {
    const res = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token, opcoes);
    expect(res.status).toBe(400);
  }
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

describe('Configuração (SSD 1.8, Seção 12)', () => {
  it('padrão de produção: 5 falhas em 15 minutos', () => {
    expect(LIMITE_TENTATIVAS_COM_FALHA).toBe(5);
    expect(JANELA_TENTATIVAS_MS).toBe(15 * 60 * 1000);
  });

  it('trust proxy = 3 (borda Cloudflare + balanceador interno, como no Render)', () => {
    expect(app.get('trust proxy')).toBe(3);
    expect(appPadrao.get('trust proxy')).toBe(3);
  });

  it('a chave do login normaliza o e-mail como o login faz', () => {
    const chave = (email) => chaveTentativasLogin({ ip: IP_A, body: { email } });
    expect(chave('  Professor.Limite@SISTO.exemplo ')).toBe(chave(EMAIL_PROFESSOR));
    expect(chave(EMAIL_TUTOR)).not.toBe(chave(EMAIL_PROFESSOR));
  });

  it('a chave do login tem tamanho fixo e não contém o e-mail (resumo SHA-256)', () => {
    const chave = (email) => chaveTentativasLogin({ ip: IP_A, body: { email } });
    const longo = `${'a'.repeat(50_000)}@sisto.exemplo`;
    const chaveLonga = chave(longo);
    const chaveCurta = chave(EMAIL_PROFESSOR);

    expect(chaveLonga).toMatch(/^203\.0\.113\.10:[0-9a-f]{64}$/);
    expect(chaveCurta).toMatch(/^203\.0\.113\.10:[0-9a-f]{64}$/);
    expect(chaveLonga).toHaveLength(chaveCurta.length);
    expect(chaveCurta).not.toContain('professor');
    // Variações de maiúsculas/espaços do e-mail longo continuam na mesma chave.
    expect(chave(`  ${longo.toUpperCase()}  `)).toBe(chaveLonga);
    expect(chave(`${longo}x`)).not.toBe(chaveLonga);
  });

  it('e-mail muito longo: o limite vale e a resposta 429 não ecoa o e-mail', async () => {
    const longo = `${'b'.repeat(50_000)}@sisto.exemplo`;
    await falharLogin(5, longo);
    const res = await login(`  ${longo.toUpperCase()} `, SENHA_ERRADA);
    esperar429(res);
    expect(res.text.length).toBeLessThan(200);
  });

  it('sem limitadores no app (montado fora de criarApp), falha fechada', () => {
    expect(() => limitarTentativasLogin({ app: { locals: {} } }, {}, () => {})).toThrow();
  });
});

describe('POST /auth/login — limite por IP + e-mail', () => {
  it('na 6ª tentativa com falha responde 429 com Retry-After e mensagem em português', async () => {
    await falharLogin(5);
    const res = await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    esperar429(res);
  });

  it('o app padrão (export default) também aplica o limite', async () => {
    // IP exclusivo deste teste: o app padrão é compartilhado no arquivo.
    const opcoes = { ip: '198.51.100.77', alvo: appPadrao };
    await falharLogin(5, EMAIL_PROFESSOR, opcoes);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA, opcoes));
  });

  it('depois de exceder, até a senha correta recebe 429 naquela chave', async () => {
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_CORRETA));
  });

  it('variações de maiúsculas/espaços no e-mail contam na mesma chave', async () => {
    await falharLogin(3);
    await falharLogin(2, '  PROFESSOR.Limite@sisto.EXEMPLO ');
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
  });

  it('e-mail inexistente e usuário bloqueado também contam (resposta 401)', async () => {
    await falharLogin(5, EMAIL_INEXISTENTE);
    const inexistente = await login(EMAIL_INEXISTENTE, SENHA_ERRADA);
    esperar429(inexistente);

    await falharLogin(5, EMAIL_BLOQUEADO);
    const bloqueado = await login(EMAIL_BLOQUEADO, SENHA_CORRETA);
    esperar429(bloqueado);

    // Mesma resposta para e-mail que existe e que não existe (RNF06).
    expect(bloqueado.body).toEqual(inexistente.body);
  });

  it('a resposta 429 não revela se o e-mail existe', async () => {
    await falharLogin(5, EMAIL_PROFESSOR);
    await falharLogin(5, EMAIL_INEXISTENTE);
    const existente = await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    const inexistente = await login(EMAIL_INEXISTENTE, SENHA_ERRADA);
    expect(existente.status).toBe(429);
    expect(inexistente.status).toBe(429);
    expect(existente.body).toEqual(inexistente.body);
    expect(existente.text).not.toContain(EMAIL_PROFESSOR);
  });

  it('tentativas bem-sucedidas não contam', async () => {
    await falharLogin(4);
    for (let i = 0; i < 3; i += 1) await tokenPorLogin();
    // 5ª falha ainda é aceita (401); só a 6ª é barrada.
    await falharLogin(1);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
  });

  it('corpo incompleto (400) não conta como falha', async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', IP_A)
        .send({ email: EMAIL_PROFESSOR });
      expect(res.status).toBe(400);
    }
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
  });

  it('outro e-mail no mesmo IP continua com as suas próprias 5 tentativas', async () => {
    await falharLogin(5, EMAIL_PROFESSOR);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));

    await falharLogin(5, EMAIL_TUTOR);
    expect((await login(EMAIL_TUTOR, SENHA_CORRETA)).status).toBe(429);
    // ...e um terceiro e-mail entra normalmente.
    const outro = novoUsuario(4, 'GESTAO', 'gestao.limite@sisto.exemplo');
    banco.push(outro);
    await tokenPorLogin(outro.email);
  });

  it('o mesmo e-mail em outro IP tem contagem separada', async () => {
    await falharLogin(5, EMAIL_PROFESSOR, { ip: IP_A });
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: IP_A }));
    await tokenPorLogin(EMAIL_PROFESSOR, SENHA_CORRETA, { ip: IP_B });
  });

  it('depois da janela de 15 minutos, novas tentativas voltam a ser aceitas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00-03:00'));

    await falharLogin(5);
    const bloqueado = await login(EMAIL_PROFESSOR, SENHA_ERRADA);
    esperar429(bloqueado);
    expect(Number(bloqueado.headers['retry-after'])).toBe(15 * 60);

    // Um pouco antes do fim da janela: continua barrado.
    vi.setSystemTime(new Date('2026-11-12T10:14:59-03:00'));
    esperar429(await login(EMAIL_PROFESSOR, SENHA_CORRETA));

    // Fim da janela: aceita de novo, com 5 novas tentativas.
    vi.setSystemTime(new Date('2026-11-12T10:15:01-03:00'));
    await tokenPorLogin();
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
  });

  it('limite e janela configuráveis por criarApp (só para testes)', async () => {
    const appCurto = criarApp({ limiteTentativas: { maximo: 2, janelaMs: 60_000 } });
    await falharLogin(2, EMAIL_PROFESSOR, { alvo: appCurto });
    const res = await login(EMAIL_PROFESSOR, SENHA_ERRADA, { alvo: appCurto });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('cada app tem os seus contadores (sem vazar estado)', async () => {
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
    const outroApp = criarApp();
    expect((await login(EMAIL_PROFESSOR, SENHA_ERRADA, { alvo: outroApp })).status).toBe(401);
  });

  it('não altera o status do usuário nem grava nada no banco (não bloqueia a conta)', async () => {
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));
    expect(banco.find((u) => u.email === EMAIL_PROFESSOR).status).toBe('ATIVO');
    expect(update).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    // Em outro IP, o mesmo usuário entra normalmente.
    await tokenPorLogin(EMAIL_PROFESSOR, SENHA_CORRETA, { ip: IP_B });
  });
});

describe('PUT /conta/senha — limite por IP + usuário logado', () => {
  it('na 6ª tentativa com falha responde 429 com Retry-After', async () => {
    const token = await tokenPorLogin();
    await falharTroca(5, token);
    const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, token);
    esperar429(res);
    // A senha não foi trocada.
    expect(banco[0].senha_hash).toBe(hashSenha);
  });

  it('nova senha inválida (400) também conta como falha', async () => {
    const token = await tokenPorLogin();
    for (let i = 0; i < 5; i += 1) {
      const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: 'curta' }, token);
      expect(res.status).toBe(400);
    }
    esperar429(await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, token));
  });

  it('a troca bem-sucedida não conta', async () => {
    const token = await tokenPorLogin();
    await falharTroca(4, token);
    const ok = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, token);
    expect(ok.status).toBe(204);

    // RN12: é preciso entrar de novo com a senha nova.
    const novoToken = await tokenPorLogin(EMAIL_PROFESSOR, SENHA_NOVA);
    // 5ª falha ainda é aceita (400); só a 6ª é barrada.
    const quinta = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_CORRETA }, novoToken);
    expect(quinta.status).toBe(400);
    expect(quinta.body).toEqual({ erro: MENSAGEM_SENHA_ATUAL_INCORRETA });
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_CORRETA }, novoToken));
  });

  it('outro usuário no mesmo IP tem as suas próprias 5 tentativas', async () => {
    const tokenProfessor = await tokenPorLogin(EMAIL_PROFESSOR);
    const tokenTutor = await tokenPorLogin(EMAIL_TUTOR);
    await falharTroca(5, tokenProfessor);
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, tokenProfessor));

    await falharTroca(5, tokenTutor);
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, tokenTutor));
  });

  it('o mesmo usuário em outro IP tem contagem separada', async () => {
    const token = await tokenPorLogin();
    await falharTroca(5, token, { ip: IP_A });
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token));
    const res = await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token, { ip: IP_B });
    expect(res.status).toBe(400);
  });

  it('depois da janela de 15 minutos, volta a aceitar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00-03:00'));
    const token = await tokenPorLogin();
    await falharTroca(5, token);
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token));

    vi.setSystemTime(new Date('2026-11-12T10:15:01-03:00'));
    const res = await trocar({ senhaAtual: SENHA_CORRETA, novaSenha: SENHA_NOVA }, token);
    expect(res.status).toBe(204);
  });

  it('não bloqueia a conta nem afeta o login e as demais rotas', async () => {
    const token = await tokenPorLogin();
    await falharTroca(5, token);
    esperar429(await trocar({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA }, token));

    expect(banco[0].status).toBe('ATIVO');
    expect(update).not.toHaveBeenCalled();
    // Login (outro limitador) e outras rotas seguem normais.
    await tokenPorLogin();
    const livre = await request(app)
      .get('/teste-livre')
      .set('X-Forwarded-For', IP_A)
      .set('Authorization', `Bearer ${token}`);
    expect(livre.status).toBe(200);
  });

  it('sem token continua 401 (a autenticação vem antes do limite)', async () => {
    for (let i = 0; i < 7; i += 1) {
      const res = await request(app)
        .put('/conta/senha')
        .set('X-Forwarded-For', IP_A)
        .send({ senhaAtual: SENHA_ERRADA, novaSenha: SENHA_NOVA });
      expect(res.status).toBe(401);
    }
  });
});

describe('Demais rotas não são afetadas', () => {
  it('rotas autenticadas e caminhos inexistentes não recebem 429 nem cabeçalhos de limite', async () => {
    const token = await tokenPorLogin();
    await falharLogin(5);
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA));

    for (let i = 0; i < 10; i += 1) {
      const livre = await request(app)
        .get('/teste-livre')
        .set('X-Forwarded-For', IP_A)
        .set('Authorization', `Bearer ${token}`);
      expect(livre.status).toBe(200);
      expect(livre.headers['ratelimit']).toBeUndefined();
      expect(livre.headers['retry-after']).toBeUndefined();

      const inexistente = await request(app)
        .get('/rota-inexistente')
        .set('X-Forwarded-For', IP_A)
        .set('Authorization', `Bearer ${token}`);
      expect(inexistente.status).toBe(404);

      const semToken = await request(app).get('/teste-livre').set('X-Forwarded-For', IP_A);
      expect(semToken.status).toBe(401);

      const authInexistente = await request(app)
        .post('/auth/inexistente')
        .set('X-Forwarded-For', IP_A)
        .send({ email: EMAIL_PROFESSOR, senha: SENHA_ERRADA });
      expect(authInexistente.status).toBe(404);
    }
  });
});

describe('trust proxy com X-Forwarded-For', () => {
  it('req.ip é o cliente na cadeia "cliente, borda, balanceador" (3º endereço do fim)', async () => {
    const appIp = criarApp({
      registrarRotasExtras: (a) => a.get('/ip', (req, res) => res.json({ ip: req.ip })),
    });
    // Rotas extras passam pela autenticação global: precisa de token.
    const token = await tokenPorLogin(EMAIL_PROFESSOR, SENHA_CORRETA, { alvo: appIp });
    const ipDe = async (xForwardedFor) => {
      const req = request(appIp).get('/ip').set('Authorization', `Bearer ${token}`);
      if (xForwardedFor !== undefined) req.set('X-Forwarded-For', xForwardedFor);
      const res = await req;
      expect(res.status).toBe(200);
      return res.body.ip;
    };

    expect(await ipDe(cadeiaRender(IP_A))).toBe(IP_A);
    expect(await ipDe(cadeiaRender(IP_A, BORDA_2, BALANCEADOR_2))).toBe(IP_A);
    // Forjado no começo: continua o cliente real.
    expect(await ipDe(`198.51.100.1, ${cadeiaRender(IP_A)}`)).toBe(IP_A);
    // Sem X-Forwarded-For (local/testes): o IP da conexão.
    expect(await ipDe()).toMatch(/127\.0\.0\.1|::1/);
  });

  it('separa dois clientes reais que passam pela mesma borda e pelo mesmo balanceador', async () => {
    // Todas as requisições chegam do mesmo socket (127.0.0.1) e com os mesmos
    // 2 saltos finais; só o cliente muda. Se o limite usasse o balanceador
    // (trust proxy = 1) ou o IP da conexão, o IP_B também estaria barrado.
    await falharLogin(5, EMAIL_PROFESSOR, { ip: cadeiaRender(IP_A) });
    esperar429(await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: cadeiaRender(IP_A) }));
    const outroCliente = await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: cadeiaRender(IP_B) });
    expect(outroCliente.status).toBe(401);
    expect(outroCliente.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
  });

  it('o mesmo cliente continua barrado quando a borda e o balanceador mudam', async () => {
    await falharLogin(5, EMAIL_PROFESSOR, { ip: cadeiaRender(IP_A, BORDA_1, BALANCEADOR_1) });
    esperar429(
      await login(EMAIL_PROFESSOR, SENHA_ERRADA, {
        ip: cadeiaRender(IP_A, BORDA_2, BALANCEADOR_2),
      }),
    );
  });

  it('X-Forwarded-For forjado ("forjado, cliente, borda, balanceador") ainda resulta no cliente real', async () => {
    await falharLogin(5, EMAIL_PROFESSOR, { ip: cadeiaRender(IP_A) });
    // O cliente inventa um endereço no começo; os proxies acrescentam ao fim,
    // então a contagem a partir do fim continua chegando ao IP_A.
    for (const forjado of ['198.51.100.1', IP_B, '10.0.0.1']) {
      const res = await login(EMAIL_PROFESSOR, SENHA_ERRADA, {
        ip: `${forjado}, ${cadeiaRender(IP_A)}`,
      });
      esperar429(res);
    }
    // E o forjado não "rouba" o limite de quem ele imitou: o IP_B real segue livre.
    const real = await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: cadeiaRender(IP_B) });
    expect(real.status).toBe(401);
  });

  it('sem X-Forwarded-For (local e testes), usa o IP da conexão e o limite continua funcionando', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: EMAIL_PROFESSOR, senha: SENHA_ERRADA });
      expect(res.status).toBe(401);
    }
    const res = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL_PROFESSOR, senha: SENHA_ERRADA });
    esperar429(res);
    // Um cliente atrás dos proxies (outro IP) não é afetado.
    expect(
      (await login(EMAIL_PROFESSOR, SENHA_ERRADA, { ip: cadeiaRender(IP_A) })).status,
    ).toBe(401);
  });
});
