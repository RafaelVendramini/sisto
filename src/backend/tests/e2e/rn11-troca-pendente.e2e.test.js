// RN10 e RN11 antes do uso real, de ponta a ponta pela API (Issue #149):
// - o seed de produção cria a Gestão inicial com troca obrigatória de senha;
// - a Gestão com troca de senha pendente não conta como Gestão ativa na RN11;
// - a redefinição de senha entre Gestões continua permitida, mesmo havendo
//   só duas (decisão do Rafael, 23/11/2026).
// App real + banco de testes real, somente dados fictícios (RN05).
//
// Os passos rodam EM ORDEM e dependem uns dos outros (mesmo padrão do
// fluxo-completo.e2e.test.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executarSeedUsuarios } from '../../prisma/seed-usuarios.js';
import { criarApp } from '../../src/app.js';
import { CODIGOS_ERRO } from '../../src/lib/erros.js';
import { MENSAGEM_MINIMO_GESTOES_ATIVAS } from '../../src/services/usuarios.js';
import {
  criarUsuario,
  desconectarPrisma,
  enviar,
  entrar,
  exigirStatus,
  limparBanco,
  prisma,
} from './apoio/dados.js';

const app = criarApp();

const EMAIL_SEED = 'gestao.inicial@escola-ficticia.test';
const SENHA_SEED = 'TemporariaSeed#2026';
const SENHA_DEFINITIVA = 'DefinitivaGestao#2026';
const SENHA_SEGUNDA_TEMPORARIA = 'TemporariaSegunda#2026';
const SENHA_SEGUNDA_DEFINITIVA = 'DefinitivaSegunda#2026';
const EMAIL_SEGUNDA = 'gestao.segunda@escola-ficticia.test';

let tokenInicial;
let segundaId;
let terceira;

async function trocarSenha(token, senhaAtual, novaSenha) {
  const res = await enviar(app, 'PUT', '/conta/senha', { token, corpo: { senhaAtual, novaSenha } });
  exigirStatus(res, 204, 'troca da própria senha');
}

beforeAll(async () => {
  await limparBanco();
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('RN10 e RN11 antes do uso real (Issue #149)', () => {
  it('1. o seed de produção cria a Gestão inicial com troca obrigatória de senha', async () => {
    const resultado = await executarSeedUsuarios(
      prisma,
      { NODE_ENV: 'production', SEED_GESTAO_EMAIL: EMAIL_SEED, SEED_GESTAO_SENHA: SENHA_SEED },
      { custoBcrypt: 4 },
    );
    expect(resultado.criados).toEqual([{ email: EMAIL_SEED, perfil: 'GESTAO' }]);

    const login = await entrar(app, EMAIL_SEED, SENHA_SEED);
    expect(login.trocaSenhaObrigatoria).toBe(true);

    const bloqueada = await enviar(app, 'GET', '/usuarios', { token: login.token });
    expect(bloqueada.status).toBe(403);
    expect(bloqueada.body.codigo).toBe(CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA);
  });

  it('2. no primeiro acesso, a Gestão inicial troca a senha e passa a usar o sistema', async () => {
    const login = await entrar(app, EMAIL_SEED, SENHA_SEED);
    await trocarSenha(login.token, SENHA_SEED, SENHA_DEFINITIVA);

    const novoLogin = await entrar(app, EMAIL_SEED, SENHA_DEFINITIVA);
    expect(novoLogin.trocaSenhaObrigatoria).toBe(false);
    tokenInicial = novoLogin.token;
    exigirStatus(await enviar(app, 'GET', '/usuarios', { token: tokenInicial }), 200, 'GET /usuarios');
  });

  it('3. a Gestão inicial cadastra a segunda Gestão, que nasce com troca pendente', async () => {
    const res = await enviar(app, 'POST', '/usuarios', {
      token: tokenInicial,
      corpo: {
        nome: 'Segunda Gestão Fictícia',
        email: EMAIL_SEGUNDA,
        perfil: 'GESTAO',
        senha: SENHA_SEGUNDA_TEMPORARIA,
      },
    });
    exigirStatus(res, 201, 'cadastro da segunda Gestão');
    segundaId = res.body.id;
    const segunda = await prisma.usuario.findUnique({
      where: { id: segundaId },
      select: { troca_senha_obrigatoria: true },
    });
    expect(segunda.troca_senha_obrigatoria).toBe(true);
  });

  it('4. com a segunda Gestão ainda pendente, retirar uma terceira Gestão confirmada é recusado (409)', async () => {
    terceira = await criarUsuario({ perfil: 'GESTAO', nome: 'Terceira Gestão Fictícia' });
    // Gestões ativas confirmadas: a inicial e a terceira. A segunda não conta.
    const res = await enviar(app, 'PUT', `/usuarios/${terceira.id}`, {
      token: tokenInicial,
      corpo: { status: 'BLOQUEADO' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: MENSAGEM_MINIMO_GESTOES_ATIVAS,
      codigo: CODIGOS_ERRO.GESTAO_ATIVA_MINIMA,
    });
  });

  it('5. depois que a segunda Gestão troca a senha, a mesma retirada é aceita (200)', async () => {
    const login = await entrar(app, EMAIL_SEGUNDA, SENHA_SEGUNDA_TEMPORARIA);
    expect(login.trocaSenhaObrigatoria).toBe(true);
    await trocarSenha(login.token, SENHA_SEGUNDA_TEMPORARIA, SENHA_SEGUNDA_DEFINITIVA);

    const res = await enviar(app, 'PUT', `/usuarios/${terceira.id}`, {
      token: tokenInicial,
      corpo: { status: 'BLOQUEADO' },
    });
    exigirStatus(res, 200, 'bloqueio da terceira Gestão');
    expect(res.body.status).toBe('BLOQUEADO');
  });

  it('6. com só duas Gestões ativas, uma ainda pode redefinir a senha da outra (204)', async () => {
    const res = await enviar(app, 'PUT', `/usuarios/${segundaId}/senha`, {
      token: tokenInicial,
      corpo: { novaSenha: SENHA_SEGUNDA_TEMPORARIA },
    });
    exigirStatus(res, 204, 'redefinição da senha da segunda Gestão');

    const login = await entrar(app, EMAIL_SEGUNDA, SENHA_SEGUNDA_TEMPORARIA);
    expect(login.trocaSenhaObrigatoria).toBe(true);
  });

  it('7. com a segunda de novo pendente: reativar a terceira é aceito, mas bloqueá-la de novo é recusado (409)', async () => {
    // Reativar não reduz Gestões ativas: aceito.
    const reativada = await enviar(app, 'PUT', `/usuarios/${terceira.id}`, {
      token: tokenInicial,
      corpo: { status: 'ATIVO' },
    });
    exigirStatus(reativada, 200, 'reativação da terceira Gestão');

    // Confirmadas: a inicial e a terceira. A segunda (pendente) não conta.
    const res = await enviar(app, 'PUT', `/usuarios/${terceira.id}`, {
      token: tokenInicial,
      corpo: { status: 'BLOQUEADO' },
    });
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe(CODIGOS_ERRO.GESTAO_ATIVA_MINIMA);
  });
});
