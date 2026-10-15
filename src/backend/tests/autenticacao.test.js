// Testes dos middlewares de autenticação JWT e de permissão por perfil (Issue #11).
// Somente dados fictícios (RN05). Não dependem do banco: src/lib/prisma.js é
// substituído por um fake. As rotas de teste existem apenas neste arquivo
// (criarApp({ registrarRotasExtras })) — nenhuma rota de teste no app real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Router } from 'express';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique } },
}));

const { default: app, criarApp } = await import('../src/app.js');
const { exigirAutenticacao, permitirPerfis, extrairTokenBearer, MENSAGEM_PERFIL_SEM_PERMISSAO } =
  await import('../src/middlewares/autenticacao.js');
const { MENSAGEM_NAO_AUTENTICADO, verificarSessao } = await import('../src/services/sessao.js');
const { tratarErros } = await import('../src/middlewares/erros.js');
const { protegidas } = await import('../src/routes/index.js');
const { ErroHttp } = await import('../src/lib/erros.js');

// Rota registrada no sub-roteador `protegidas`, como farão as próximas Issues
// (o registro vale só para o processo deste arquivo de teste).
protegidas.get('/teste-protegidas/eco', (req, res) => res.json({ usuario: req.usuario }));

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const OUTRO_SEGREDO = 'outro-segredo-ficticio-diferente-com-mais-de-32-chars';
const RESPOSTA_401 = { erro: MENSAGEM_NAO_AUTENTICADO };
const RESPOSTA_403 = { erro: MENSAGEM_PERFIL_SEM_PERMISSAO };

/** Usuários fictícios indexados pelo id (como no banco). */
const usuarios = {
  1: { id: 1, perfil: 'GESTAO', status: 'ATIVO' },
  2: { id: 2, perfil: 'PROFESSOR', status: 'ATIVO' },
  3: { id: 3, perfil: 'TUTOR', status: 'BLOQUEADO' },
  4: { id: 4, perfil: 'PEDAGOGICO', status: 'DESATIVADO' },
  5: { id: 5, perfil: 'TUTOR', status: 'ATIVO' },
  6: { id: 6, perfil: 'PEDAGOGICO', status: 'ATIVO' },
  7: { id: 7, perfil: 'TECNICO_ADMINISTRATIVO', status: 'ATIVO' },
};

/** App com rotas auxiliares de teste (todas sob a autenticação global). */
const appTeste = criarApp({
  registrarRotasExtras: (a) => {
    // Sem nenhum middleware explícito: prova que rotas novas nascem protegidas.
    a.get('/teste/protegida', (req, res) => res.json({ usuario: req.usuario }));
    a.get('/teste/so-gestao', permitirPerfis('GESTAO'), (req, res) => res.json({ ok: true }));
    a.get(
      '/teste/gestao-ou-pedagogico',
      permitirPerfis('GESTAO', 'PEDAGOGICO'),
      (req, res) => res.json({ ok: true }),
    );
  },
});

let segredoOriginal;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where }) => {
    const usuario = usuarios[where.id];
    return usuario ? { ...usuario } : null;
  });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
});

/** Gera um token como o do POST /auth/login (HS256, 8h). */
function gerarToken(payload, { segredo = SEGREDO_TESTE, ...opcoes } = {}) {
  return jwt.sign(payload, segredo, { algorithm: 'HS256', expiresIn: '8h', ...opcoes });
}

function tokenDe(id) {
  return gerarToken({ id, perfil: usuarios[id]?.perfil ?? 'PROFESSOR' });
}

function get(caminho, autorizacao, aplicacao = appTeste) {
  const req = request(aplicacao).get(caminho);
  return autorizacao === undefined ? req : req.set('Authorization', autorizacao);
}

function esperar401(res) {
  expect(res.status).toBe(401);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.headers['www-authenticate']).toBe('Bearer');
  expect(res.body).toEqual(RESPOSTA_401);
}

describe('Autenticação — token ausente ou malformado (401)', () => {
  it('sem cabeçalho Authorization: 401 sem consultar o banco', async () => {
    const res = await get('/teste/protegida');

    esperar401(res);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['sem o esquema Bearer', () => tokenDe(1)],
    ['esquema Basic', () => 'Basic dXN1YXJpbzpzZW5oYQ=='],
    ['Bearer sem token', () => 'Bearer '],
    ['Bearer só com espaços', () => 'Bearer    '],
    ['token com espaço no meio', () => `Bearer ${tokenDe(1)} extra`],
    ['vazio', () => ''],
  ])('cabeçalho %s: 401', async (_caso, cabecalho) => {
    const res = await get('/teste/protegida', cabecalho());

    esperar401(res);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['texto qualquer', 'nao-e-um-jwt'],
    ['três partes inválidas', 'aaa.bbb.ccc'],
    ['token truncado', null],
  ])('token malformado (%s): 401', async (_caso, valor) => {
    const token = valor ?? tokenDe(1).slice(0, -10);
    const res = await get('/teste/protegida', `Bearer ${token}`);

    esperar401(res);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('esquema "bearer" em minúsculas é aceito (RFC 6750)', async () => {
    const res = await get('/teste/protegida', `bearer ${tokenDe(1)}`);

    expect(res.status).toBe(200);
  });
});

describe('Autenticação — token inválido ou expirado (401)', () => {
  it('assinatura com outro segredo: 401', async () => {
    const token = gerarToken({ id: 1, perfil: 'GESTAO' }, { segredo: OUTRO_SEGREDO });

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token expirado: 401', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { id: 1, perfil: 'GESTAO', iat: agora - 9 * 3600, exp: agora - 3600 },
      SEGREDO_TESTE,
      { algorithm: 'HS256' },
    );

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token com validade maior que 8h (emitido há mais de 8h): 401', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { id: 1, perfil: 'GESTAO', iat: agora - 9 * 3600, exp: agora + 3600 },
      SEGREDO_TESTE,
      { algorithm: 'HS256' },
    );

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
  });

  it('token sem expiração (exp): 401', async () => {
    const token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, { algorithm: 'HS256' });

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token com "alg: none" (sem assinatura): 401', async () => {
    const token = jwt.sign({ id: 1, perfil: 'GESTAO' }, null, {
      algorithm: 'none',
      expiresIn: '8h',
    });

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('token assinado com HS512 (mesmo segredo): 401', async () => {
    const token = gerarToken({ id: 1, perfil: 'GESTAO' }, { algorithm: 'HS512' });

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['sem id', { perfil: 'GESTAO' }],
    ['id texto', { id: '1', perfil: 'GESTAO' }],
    ['id decimal', { id: 1.5, perfil: 'GESTAO' }],
    ['id zero', { id: 0, perfil: 'GESTAO' }],
    ['id negativo', { id: -1, perfil: 'GESTAO' }],
    ['id objeto', { id: { gt: 0 }, perfil: 'GESTAO' }],
  ])('payload %s: 401 sem consultar o banco', async (_caso, payload) => {
    const token = gerarToken(payload);

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('payload que não é objeto (texto assinado): 401', async () => {
    const token = jwt.sign('texto-qualquer', SEGREDO_TESTE, { algorithm: 'HS256' });

    esperar401(await get('/teste/protegida', `Bearer ${token}`));
  });
});

describe('Autenticação — status do usuário no banco (RN09)', () => {
  it('usuário inexistente com token válido: 401', async () => {
    const res = await get('/teste/protegida', `Bearer ${gerarToken({ id: 999, perfil: 'GESTAO' })}`);

    esperar401(res);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 999 },
      select: {
        id: true,
        perfil: true,
        status: true,
        troca_senha_obrigatoria: true,
        senha_alterada_em: true,
      },
    });
  });

  it.each([
    ['BLOQUEADO', 3],
    ['DESATIVADO', 4],
  ])('usuário %s com token ainda válido: 401', async (_status, id) => {
    esperar401(await get('/teste/protegida', `Bearer ${tokenDe(id)}`));
  });

  it.each(['BLOQUEADO', 'DESATIVADO'])(
    'usuário ativo que passa a %s perde o acesso na requisição seguinte',
    async (novoStatus) => {
      const token = tokenDe(2);

      const antes = await get('/teste/protegida', `Bearer ${token}`);
      expect(antes.status).toBe(200);

      findUnique.mockResolvedValueOnce({ id: 2, perfil: 'PROFESSOR', status: novoStatus });
      esperar401(await get('/teste/protegida', `Bearer ${token}`));
    },
  );

  it('a mesma mensagem 401 para token expirado e para usuário bloqueado (não revela o motivo)', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const expirado = jwt.sign(
      { id: 1, perfil: 'GESTAO', iat: agora - 9 * 3600, exp: agora - 3600 },
      SEGREDO_TESTE,
      { algorithm: 'HS256' },
    );

    const r1 = await get('/teste/protegida', `Bearer ${expirado}`);
    const r2 = await get('/teste/protegida', `Bearer ${tokenDe(3)}`);
    const r3 = await get('/teste/protegida');

    expect(r1.body).toEqual(r2.body);
    expect(r2.body).toEqual(r3.body);
  });

  it('consulta o banco a cada requisição (sem cache)', async () => {
    const token = tokenDe(2);

    for (let i = 0; i < 3; i += 1) {
      expect((await get('/teste/protegida', `Bearer ${token}`)).status).toBe(200);
    }

    expect(findUnique).toHaveBeenCalledTimes(3);
  });
});

describe('Autenticação — sucesso', () => {
  it('usuário ATIVO passa e req.usuario tem só id, perfil e trocaSenhaObrigatoria (do banco)', async () => {
    const res = await get('/teste/protegida', `Bearer ${tokenDe(2)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: { id: 2, perfil: 'PROFESSOR', trocaSenhaObrigatoria: false },
    });
    expect(res.text).not.toMatch(/status|senha_hash/);
  });

  it('perfil alterado no banco prevalece sobre o perfil do token', async () => {
    // Token emitido quando o usuário 2 era GESTAO; hoje ele é PROFESSOR no banco.
    const tokenAntigo = gerarToken({ id: 2, perfil: 'GESTAO' });

    const protegida = await get('/teste/protegida', `Bearer ${tokenAntigo}`);
    expect(protegida.body).toEqual({
      usuario: { id: 2, perfil: 'PROFESSOR', trocaSenhaObrigatoria: false },
    });

    const soGestao = await get('/teste/so-gestao', `Bearer ${tokenAntigo}`);
    expect(soGestao.status).toBe(403);
  });

  it('promoção a GESTAO no banco libera a rota só-Gestão na hora', async () => {
    const tokenAntigo = gerarToken({ id: 2, perfil: 'PROFESSOR' });
    findUnique.mockResolvedValueOnce({ id: 2, perfil: 'GESTAO', status: 'ATIVO' });

    const res = await get('/teste/so-gestao', `Bearer ${tokenAntigo}`);

    expect(res.status).toBe(200);
  });

  it('token emitido pelo POST /auth/login é aceito pelo middleware', async () => {
    // Fluxo completo usando o service real de login, com bcrypt real.
    const bcrypt = (await import('bcrypt')).default;
    const senha_hash = await bcrypt.hash('SenhaFicticia123', 4);
    findUnique.mockImplementation(async ({ where }) => {
      if (where.email === 'gestao@sisto.exemplo') {
        return { id: 1, nome: 'Gestão Exemplo', perfil: 'GESTAO', status: 'ATIVO', senha_hash };
      }
      return usuarios[where.id] ? { ...usuarios[where.id] } : null;
    });

    const login = await request(appTeste)
      .post('/auth/login')
      .send({ email: 'gestao@sisto.exemplo', senha: 'SenhaFicticia123' });
    expect(login.status).toBe(200);

    const res = await get('/teste/so-gestao', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
  });
});

describe('Permissão por perfil (RN01 / RF14)', () => {
  it.each([
    ['PROFESSOR', 2],
    ['TUTOR', 5],
    ['PEDAGOGICO', 6],
    ['TECNICO_ADMINISTRATIVO', 7],
  ])('%s em rota restrita à Gestão: 403', async (_perfil, id) => {
    const res = await get('/teste/so-gestao', `Bearer ${tokenDe(id)}`);

    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(RESPOSTA_403);
  });

  it('GESTAO em rota restrita à Gestão: 200', async () => {
    const res = await get('/teste/so-gestao', `Bearer ${tokenDe(1)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it.each([
    ['GESTAO', 1, 200],
    ['PEDAGOGICO', 6, 200],
    ['PROFESSOR', 2, 403],
    ['TUTOR', 5, 403],
    ['TECNICO_ADMINISTRATIVO', 7, 403],
  ])('rota permitida a Gestão e Pedagógico: %s recebe %i', async (_perfil, id, esperado) => {
    const res = await get('/teste/gestao-ou-pedagogico', `Bearer ${tokenDe(id)}`);

    expect(res.status).toBe(esperado);
  });

  it('sem token em rota restrita: 401 (autenticação antes da permissão)', async () => {
    esperar401(await get('/teste/so-gestao'));
  });

  it('bloqueado com token válido em rota restrita: 401, não 403', async () => {
    esperar401(await get('/teste/so-gestao', `Bearer ${tokenDe(3)}`));
  });

  it('usado sem exigirAutenticacao antes (req.usuario ausente): 401', async () => {
    const express = (await import('express')).default;
    const appSemAuth = express();
    appSemAuth.get('/x', permitirPerfis('GESTAO'), (req, res) => res.json({ ok: true }));
    appSemAuth.use(tratarErros);

    const res = await request(appSemAuth).get('/x');

    expect(res.status).toBe(401);
    expect(res.body).toEqual(RESPOSTA_401);
  });

  it('aceita a lista de perfis como array', () => {
    expect(() => permitirPerfis(['GESTAO', 'PEDAGOGICO'])).not.toThrow();
  });

  it.each([
    ['lista vazia', []],
    ['perfil inexistente', ['ADMIN']],
    ['perfil em minúsculas', ['gestao']],
    ['um válido e um inexistente', ['GESTAO', 'DIRETOR']],
  ])('na criação, %s é erro de programação', (_caso, perfis) => {
    expect(() => permitirPerfis(...perfis)).toThrow(/permitirPerfis/);
  });
});

describe('Erros internos', () => {
  it('falha do banco: 500 genérico sem detalhes', async () => {
    findUnique.mockRejectedValueOnce(new Error('falha de conexão com detalhe interno'));

    const res = await get('/teste/protegida', `Bearer ${tokenDe(1)}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/detalhe interno/);
  });

  it.each([
    ['ausente', undefined],
    ['curto demais', 'curto'],
    ['valor de exemplo do .env.example', 'TROQUE_POR_UM_SEGREDO_ALEATORIO_DE_96_CARACTERES_HEX'],
  ])('JWT_SECRET %s com token presente: 500 genérico, sem consultar o banco', async (_caso, valor) => {
    const token = tokenDe(1);
    if (valor === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = valor;

    const res = await get('/teste/protegida', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(res.text).not.toMatch(/JWT_SECRET/);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('Escopo da autenticação global (Seção 12)', () => {
  it('POST /auth/login continua sem exigir token', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ninguem@sisto.exemplo', senha: 'SenhaFicticia123' });

    // 401 de credenciais (do login), não o 401 do middleware.
    expect(res.status).toBe(401);
    expect(res.body).not.toEqual(RESPOSTA_401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('POST /auth/login com token inválido no cabeçalho também não é barrado', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Authorization', 'Bearer token-invalido')
      .send({});

    expect(res.status).toBe(400);
  });

  it.each([
    ['GET', '/usuarios'],
    ['POST', '/ocorrencias'],
    ['GET', '/qualquer/rota/futura'],
  ])('%s %s sem token: 401 (rotas fora de /auth nascem protegidas)', async (metodo, caminho) => {
    const res = await request(app)[metodo.toLowerCase()](caminho);

    esperar401(res);
  });

  it('rota registrada sem nenhum middleware explícito exige token', async () => {
    esperar401(await get('/teste/protegida'));
    expect((await get('/teste/protegida', `Bearer ${tokenDe(1)}`)).status).toBe(200);
  });

  it('rota inexistente com token válido: 404', async () => {
    const res = await get('/nao-existe', `Bearer ${tokenDe(1)}`, app);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });

  it('roteador montado com exigirAutenticacao explícito também funciona', async () => {
    const r = Router();
    r.use(exigirAutenticacao);
    r.get('/eco', (req, res) => res.json(req.usuario));
    const outro = criarApp({ registrarRotasExtras: (a) => a.use('/extra', r) });

    const res = await get('/extra/eco', `Bearer ${tokenDe(6)}`, outro);

    expect(res.body).toEqual({ id: 6, perfil: 'PEDAGOGICO', trocaSenhaObrigatoria: false });
    // Autenticação global + a do sub-roteador: 2 consultas (aceitável; o
    // normal é usar só a global).
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('Sub-roteador protegidas (proteção estrutural)', () => {
  it('rota registrada em protegidas sem token: 401', async () => {
    esperar401(await get('/teste-protegidas/eco', undefined, app));
  });

  it('rota registrada em protegidas com token inválido: 401', async () => {
    esperar401(await get('/teste-protegidas/eco', 'Bearer abc.def.ghi', app));
  });

  it('rota registrada em protegidas com usuário bloqueado: 401', async () => {
    esperar401(await get('/teste-protegidas/eco', `Bearer ${tokenDe(3)}`, app));
  });

  it('rota registrada em protegidas com token válido: 200 e req.usuario', async () => {
    const res = await get('/teste-protegidas/eco', `Bearer ${tokenDe(5)}`, app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: { id: 5, perfil: 'TUTOR', trocaSenhaObrigatoria: false },
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('Middleware de erros — cabeçalhos', () => {
  function appQueLanca(erro) {
    return criarApp({
      registrarRotasExtras: (a) => {
        a.get('/teste/lanca', () => {
          throw erro;
        });
      },
    });
  }

  it('erro comum com cabecalhos e expose não injeta cabeçalho', async () => {
    const erro = Object.assign(new Error('mensagem'), {
      status: 401,
      expose: true,
      cabecalhos: { 'WWW-Authenticate': 'Basic realm="x"', 'X-Injetado': 'sim' },
    });

    const res = await get('/teste/lanca', `Bearer ${tokenDe(1)}`, appQueLanca(erro));

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.headers['x-injetado']).toBeUndefined();
  });

  it('ErroHttp só aplica cabeçalhos da lista permitida', async () => {
    const erro = new ErroHttp(401, 'mensagem', {
      cabecalhos: {
        'WWW-Authenticate': 'Bearer',
        'Set-Cookie': 'sessao=ficticia',
        'X-Injetado': 'sim',
      },
    });

    const res = await get('/teste/lanca', `Bearer ${tokenDe(1)}`, appQueLanca(erro));

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-injetado']).toBeUndefined();
  });

  it('ErroHttp com valor de cabeçalho não-texto é ignorado', async () => {
    const erro = new ErroHttp(401, 'mensagem', { cabecalhos: { 'WWW-Authenticate': ['a', 'b'] } });

    const res = await get('/teste/lanca', `Bearer ${tokenDe(1)}`, appQueLanca(erro));

    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});

describe('Unidades', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['BEARER abc.def.ghi', 'abc.def.ghi'],
    ['Bearer  abc.def.ghi ', 'abc.def.ghi'],
    ['Token abc.def.ghi', null],
    ['Bearer abc def', null],
  ])('extrairTokenBearer(%j) = %j', (entrada, esperado) => {
    expect(extrairTokenBearer(entrada)).toBe(esperado);
  });

  it('verificarSessao aceita db e env injetados', async () => {
    const db = { usuario: { findUnique: vi.fn().mockResolvedValue(usuarios[7]) } };
    const env = { JWT_SECRET: OUTRO_SEGREDO };
    const token = gerarToken({ id: 7, perfil: 'TECNICO_ADMINISTRATIVO' }, { segredo: OUTRO_SEGREDO });

    await expect(verificarSessao(token, { db, env })).resolves.toEqual({
      id: 7,
      perfil: 'TECNICO_ADMINISTRATIVO',
      trocaSenhaObrigatoria: false,
    });
  });
});
