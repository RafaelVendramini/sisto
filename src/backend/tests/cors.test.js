// Testes de CORS (Issue #14). Somente dados fictícios (RN05): as origens
// usadas são de exemplo (localhost e domínios .exemplo).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique } },
}));

const { criarApp } = await import('../src/app.js');
const { resolverOrigensPermitidas, ORIGEM_PADRAO_DESENVOLVIMENTO } = await import(
  '../src/middlewares/cors.js'
);

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ORIGEM_VITE = 'http://localhost:5173';
const ORIGEM_FICTICIA = 'https://sisto.exemplo';
const ORIGEM_NAO_PERMITIDA = 'https://site-malicioso.exemplo';

let segredoOriginal;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  findUnique.mockReset();
  findUnique.mockResolvedValue({ id: 1, perfil: 'GESTAO', status: 'ATIVO' });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
});

/** App com CORS configurado explicitamente (não depende do .env da máquina). */
function appCom({ corsOrigin = '', ambiente = 'test', avisar = () => {} } = {}) {
  return criarApp({ cors: { corsOrigin, ambiente, avisar } });
}

function preflight(app, caminho, origem, { metodo = 'POST', cabecalhos = 'content-type' } = {}) {
  return request(app)
    .options(caminho)
    .set('Origin', origem)
    .set('Access-Control-Request-Method', metodo)
    .set('Access-Control-Request-Headers', cabecalhos);
}

function esperarPreflightLiberado(res, origem) {
  expect(res.status).toBe(204);
  expect(res.headers['access-control-allow-origin']).toBe(origem);
  expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,OPTIONS');
  expect(res.headers['access-control-allow-methods']).not.toMatch(/DELETE/);
  expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
  expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  expect(res.headers.vary).toMatch(/Origin/);
}

describe('CORS — preflight com origem permitida (padrão de desenvolvimento)', () => {
  const app = appCom();

  it('OPTIONS /auth/login responde 204 com os cabeçalhos de CORS', async () => {
    const res = await preflight(app, '/auth/login', ORIGEM_VITE);
    esperarPreflightLiberado(res, ORIGEM_VITE);
    expect(res.text).toBe('');
  });

  it('OPTIONS /usuarios (rota protegida) responde 204 sem exigir token', async () => {
    const res = await preflight(app, '/usuarios', ORIGEM_VITE, {
      metodo: 'GET',
      cabecalhos: 'authorization',
    });
    esperarPreflightLiberado(res, ORIGEM_VITE);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('OPTIONS de rota protegida com parâmetro (/usuarios/:id) também responde 204', async () => {
    const res = await preflight(app, '/usuarios/1', ORIGEM_VITE, {
      metodo: 'PUT',
      cabecalhos: 'authorization,content-type',
    });
    esperarPreflightLiberado(res, ORIGEM_VITE);
  });

  it('OPTIONS de rota protegida com PATCH (ex.: /ocorrencias/1/status) responde 204', async () => {
    const res = await preflight(app, '/ocorrencias/1/status', ORIGEM_VITE, {
      metodo: 'PATCH',
      cabecalhos: 'authorization,content-type',
    });
    esperarPreflightLiberado(res, ORIGEM_VITE);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('nunca responde com Access-Control-Allow-Origin "*"', async () => {
    const res = await preflight(app, '/auth/login', ORIGEM_VITE);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('CORS — origem não permitida', () => {
  const app = appCom();

  it('preflight não recebe Access-Control-Allow-Origin', async () => {
    const res = await preflight(app, '/auth/login', ORIGEM_NAO_PERMITIDA);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight de rota protegida não recebe Access-Control-Allow-Origin', async () => {
    const res = await preflight(app, '/usuarios', ORIGEM_NAO_PERMITIDA, {
      metodo: 'GET',
      cabecalhos: 'authorization',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requisição normal não recebe Access-Control-Allow-Origin', async () => {
    const res = await request(app).post('/auth/login').set('Origin', ORIGEM_NAO_PERMITIDA).send({});
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('origem parecida (outra porta) não é liberada', async () => {
    const res = await preflight(app, '/auth/login', 'http://localhost:5174');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — requisições normais com origem permitida', () => {
  const app = appCom();

  it('resposta de erro de validação do login inclui Access-Control-Allow-Origin', async () => {
    const res = await request(app).post('/auth/login').set('Origin', ORIGEM_VITE).send({});
    expect(res.status).toBe(400);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_VITE);
  });

  it('401 de rota protegida inclui Access-Control-Allow-Origin e expõe WWW-Authenticate', async () => {
    const res = await request(app).get('/usuarios').set('Origin', ORIGEM_VITE);
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_VITE);
    expect(res.headers['access-control-expose-headers']).toBe('WWW-Authenticate');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('rota protegida com token válido inclui Access-Control-Allow-Origin', async () => {
    const token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app)
      .get('/rota-que-nao-existe')
      .set('Origin', ORIGEM_VITE)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_VITE);
  });

  it('requisição sem Origin (ex.: curl, servidor) continua funcionando sem cabeçalho de CORS', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — múltiplas origens em CORS_ORIGIN', () => {
  const app = appCom({ corsOrigin: ` ${ORIGEM_VITE} , ${ORIGEM_FICTICIA}/ ` });

  it('libera a primeira origem da lista', async () => {
    const res = await preflight(app, '/auth/login', ORIGEM_VITE);
    esperarPreflightLiberado(res, ORIGEM_VITE);
  });

  it('libera a segunda origem da lista (espaços e barra final são ignorados)', async () => {
    const res = await preflight(app, '/usuarios', ORIGEM_FICTICIA, {
      metodo: 'GET',
      cabecalhos: 'authorization',
    });
    esperarPreflightLiberado(res, ORIGEM_FICTICIA);
  });

  it('continua recusando origem fora da lista', async () => {
    const res = await preflight(app, '/auth/login', ORIGEM_NAO_PERMITIDA);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('com CORS_ORIGIN definida, o padrão localhost:5173 não é adicionado', async () => {
    const appSoFicticia = appCom({ corsOrigin: ORIGEM_FICTICIA });
    const res = await preflight(appSoFicticia, '/auth/login', ORIGEM_VITE);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS — produção sem CORS_ORIGIN (falha fechada)', () => {
  it('não libera nenhuma origem, nem a padrão de desenvolvimento', async () => {
    const avisar = vi.fn();
    const app = appCom({ corsOrigin: '', ambiente: 'production', avisar });

    const res = await preflight(app, '/auth/login', ORIGEM_VITE);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    const normal = await request(app).post('/auth/login').set('Origin', ORIGEM_VITE).send({});
    expect(normal.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('registra um aviso sem dados sensíveis', () => {
    const avisar = vi.fn();
    const vazio = resolverOrigensPermitidas({ corsOrigin: '', ambiente: 'production', avisar });

    expect(vazio).toEqual([]);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith(expect.stringMatching(/CORS_ORIGIN não definida em produção/));
    expect(avisar.mock.calls[0][0]).not.toMatch(/JWT_SECRET|DATABASE_URL|senha|postgresql:/i);
  });

  it('lê CORS_ORIGIN e NODE_ENV de process.env por padrão', () => {
    const corsOriginal = process.env.CORS_ORIGIN;
    const ambienteOriginal = process.env.NODE_ENV;
    try {
      delete process.env.CORS_ORIGIN;
      process.env.NODE_ENV = 'production';
      const avisar = vi.fn();
      expect(resolverOrigensPermitidas({ avisar })).toEqual([]);
      expect(avisar).toHaveBeenCalledTimes(1);

      process.env.CORS_ORIGIN = ORIGEM_FICTICIA;
      expect(resolverOrigensPermitidas({ avisar })).toEqual([ORIGEM_FICTICIA]);
    } finally {
      if (corsOriginal === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = corsOriginal;
      if (ambienteOriginal === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = ambienteOriginal;
    }
  });

  it('produção com CORS_ORIGIN definida libera somente as origens configuradas', async () => {
    const app = appCom({ corsOrigin: ORIGEM_FICTICIA, ambiente: 'production' });
    const res = await preflight(app, '/auth/login', ORIGEM_FICTICIA);
    esperarPreflightLiberado(res, ORIGEM_FICTICIA);
  });
});

describe('resolverOrigensPermitidas', () => {
  it('sem CORS_ORIGIN fora de produção usa http://localhost:5173', () => {
    expect(ORIGEM_PADRAO_DESENVOLVIMENTO).toBe('http://localhost:5173');
    expect(resolverOrigensPermitidas({ corsOrigin: '', ambiente: 'development' })).toEqual([
      'http://localhost:5173',
    ]);
    expect(resolverOrigensPermitidas({ corsOrigin: '   ', ambiente: 'test' })).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('ignora "*" e entradas inválidas, avisando', () => {
    const avisar = vi.fn();
    const origens = resolverOrigensPermitidas({
      corsOrigin: `*, ftp://arquivos.exemplo, nao-e-url, https://sisto.exemplo/caminho, ${ORIGEM_FICTICIA}`,
      ambiente: 'development',
      avisar,
    });
    expect(origens).toEqual([ORIGEM_FICTICIA]);
    expect(avisar).toHaveBeenCalledWith(expect.stringMatching(/4 entrada\(s\) inválida\(s\)/));
  });

  it('CORS_ORIGIN só com entradas inválidas não libera nada (nem o padrão)', async () => {
    const avisar = vi.fn();
    expect(resolverOrigensPermitidas({ corsOrigin: '*', ambiente: 'development', avisar })).toEqual(
      [],
    );
    const app = appCom({ corsOrigin: '*' });
    const res = await preflight(app, '/auth/login', ORIGEM_VITE);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('remove duplicatas e normaliza maiúsculas no host', () => {
    expect(
      resolverOrigensPermitidas({
        corsOrigin: 'http://LOCALHOST:5173,http://localhost:5173/',
        ambiente: 'development',
      }),
    ).toEqual(['http://localhost:5173']);
  });
});
