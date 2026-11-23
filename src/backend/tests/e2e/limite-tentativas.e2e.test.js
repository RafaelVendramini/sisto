// Limite de tentativas com falha, de ponta a ponta pela API (Issue #93,
// item 4; Issue #90; SSD 1.8, Seção 12): 5 falhas seguidas de 429. E o
// limite só por IP no login (Issue #134; SSD 1.13): 100 falhas com e-mails
// diferentes seguidas de 429.
// App real com os valores de PRODUÇÃO (criarApp() sem opções: 5 falhas em
// 15 minutos) + banco de testes real, somente dados fictícios (RN05).
//
// Cada teste usa um app novo: o contador fica em memória, por app.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { criarApp } from '../../src/app.js';
import {
  LIMITE_FALHAS_LOGIN_POR_IP,
  LIMITE_TENTATIVAS_COM_FALHA,
  MENSAGEM_MUITAS_TENTATIVAS,
} from '../../src/middlewares/limite-tentativas.js';
import { MENSAGEM_CREDENCIAIS_INVALIDAS } from '../../src/services/auth.js';
import {
  criarUsuario,
  desconectarPrisma,
  entrar,
  enviar,
  exigirStatus,
  limparBanco,
  prisma,
} from './apoio/dados.js';

const SENHA_ERRADA = 'SenhaErradaFicticia#0';

beforeAll(async () => {
  await limparBanco();
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('POST /auth/login: 5 falhas seguidas de 429, dentro do fluxo', () => {
  it('usa o limite de produção (5)', () => {
    expect(LIMITE_TENTATIVAS_COM_FALHA).toBe(5);
  });

  it('5 senhas erradas → 401; a 6ª tentativa → 429 com Retry-After, mesmo com a senha certa', async () => {
    const app = criarApp();
    const professor = await criarUsuario({ perfil: 'PROFESSOR' });
    const outro = await criarUsuario({ perfil: 'TUTOR' });

    // Fluxo: o usuário já tem uma sessão aberta.
    const sessao = (await entrar(app, professor.email, professor.senha)).token;

    for (let i = 1; i <= 5; i += 1) {
      const res = await request(app).post('/auth/login').send({ email: professor.email, senha: SENHA_ERRADA });
      expect(res.status, `tentativa ${i}`).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    }

    const bloqueada = await request(app).post('/auth/login').send({ email: professor.email, senha: professor.senha });
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);

    // A mesma mensagem para um e-mail que não existe (não revela — RNF06):
    // o limite é por IP + e-mail, então outro e-mail ainda não está no limite.
    const inexistente = await request(app).post('/auth/login').send({ email: 'ninguem@escola-ficticia.test', senha: SENHA_ERRADA });
    expect(inexistente.status).toBe(401);

    // O limite não bloqueia a conta (RN07): status continua ATIVO e a sessão aberta segue valendo.
    const noBanco = await prisma.usuario.findUnique({ where: { id: professor.id }, select: { status: true } });
    expect(noBanco.status).toBe('ATIVO');
    exigirStatus(await enviar(app, 'GET', '/turmas', { token: sessao }), 200, 'sessão aberta');

    // Chave = IP + e-mail: outro usuário do mesmo IP (escola) continua entrando.
    const doOutro = await entrar(app, outro.email, outro.senha);
    expect(doOutro.token).toEqual(expect.any(String));
  });

  it('login com sucesso não conta como falha', async () => {
    const app = criarApp();
    const usuario = await criarUsuario({ perfil: 'PEDAGOGICO' });
    const falhar = () => request(app).post('/auth/login').send({ email: usuario.email, senha: SENHA_ERRADA });

    for (let i = 1; i <= 4; i += 1) expect((await falhar()).status).toBe(401);
    await entrar(app, usuario.email, usuario.senha); // sucesso no meio
    expect((await falhar()).status, '5ª falha').toBe(401);
    expect((await falhar()).status, '6ª tentativa').toBe(429);
  });
});

describe('PUT /conta/senha: 5 senhas atuais erradas seguidas de 429', () => {
  it('5 falhas → 400; a 6ª → 429, mesmo com a senha atual certa; a senha não muda', async () => {
    const app = criarApp();
    const usuario = await criarUsuario({ perfil: 'GESTAO' });
    const { token } = await entrar(app, usuario.email, usuario.senha);
    const trocar = (senhaAtual) =>
      enviar(app, 'PUT', '/conta/senha', { token, corpo: { senhaAtual, novaSenha: 'NovaSenhaFicticia#2026' } });

    for (let i = 1; i <= 5; i += 1) expect((await trocar(SENHA_ERRADA)).status, `tentativa ${i}`).toBe(400);

    const bloqueada = await trocar(usuario.senha);
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);

    // Nada mudou: a senha antiga ainda entra e a sessão continua válida.
    exigirStatus(await enviar(app, 'GET', '/turmas', { token }), 200, 'sessão');
    await entrar(app, usuario.email, usuario.senha);
  });
});

describe('POST /auth/login: limite só por IP — 100 falhas com e-mails diferentes, a 101ª → 429 (Issue #134)', () => {
  // IPs de documentação (RFC 5737) e saltos fictícios da cadeia do Render
  // ('trust proxy' = 3): o X-Forwarded-For chega como "cliente, borda, balanceador".
  const cadeia = (cliente) => `${cliente}, 198.51.100.35, 10.0.0.91`;
  const IP_ATACANTE = '203.0.113.60';
  const IP_ESCOLA = '203.0.113.70';

  it('usa o limite de produção (100 por IP)', () => {
    expect(LIMITE_FALHAS_LOGIN_POR_IP).toBe(100);
  });

  it('a mesma senha em 100 e-mails diferentes → 401; o 101º e-mail → 429; outro IP segue entrando', async () => {
    const app = criarApp();
    // E-mails de usuários existentes no banco de teste (hash de custo baixo): as
    // falhas são rápidas. Com e-mails inexistentes, o login compara com o hash
    // fictício de custo 12 (contra a medição de tempo — RNF06), o que deixaria
    // as 100 tentativas lentas; o comportamento do limite é o mesmo.
    const usuarios = [];
    for (let i = 0; i < 101; i += 1) usuarios.push(await criarUsuario({ perfil: 'PROFESSOR' }));
    // Alguns e-mails inexistentes no meio, para mostrar que também contam.
    const emails = [
      ...usuarios.slice(0, 97).map((u) => u.email),
      'inexistente1.limiteip@escola-ficticia.test',
      'inexistente2.limiteip@escola-ficticia.test',
      'inexistente3.limiteip@escola-ficticia.test',
    ];
    expect(new Set(emails).size).toBe(100);

    const tentar = (email, senha, ip = IP_ATACANTE) =>
      request(app).post('/auth/login').set('X-Forwarded-For', cadeia(ip)).send({ email, senha });

    for (const [i, email] of emails.entries()) {
      const res = await tentar(email, SENHA_ERRADA);
      expect(res.status, `falha ${i + 1}`).toBe(401);
      expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
    }

    // 101º e-mail, que nunca falhou: só o limite por IP o barra — mesmo com a senha certa.
    const ultimo = usuarios[100];
    const bloqueada = await tentar(ultimo.email, ultimo.senha);
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body).toEqual({ erro: MENSAGEM_MUITAS_TENTATIVAS });
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);

    // Outro IP (ex.: a escola) não é afetado.
    const daEscola = await tentar(ultimo.email, ultimo.senha, IP_ESCOLA);
    expect(daEscola.status).toBe(200);
    expect(daEscola.body.token).toEqual(expect.any(String));

    // Não bloqueia nenhuma conta (RN07): todos continuam ATIVO.
    const inativos = await prisma.usuario.count({
      where: { id: { in: usuarios.map((u) => u.id) }, status: { not: 'ATIVO' } },
    });
    expect(inativos).toBe(0);
  });
});
