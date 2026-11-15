// Limite de tentativas com falha, de ponta a ponta pela API (Issue #93,
// item 4; Issue #90; SSD 1.8, Seção 12): 5 falhas seguidas de 429.
// App real com os valores de PRODUÇÃO (criarApp() sem opções: 5 falhas em
// 15 minutos) + banco de testes real, somente dados fictícios (RN05).
//
// Cada teste usa um app novo: o contador fica em memória, por app.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { criarApp } from '../../src/app.js';
import {
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
