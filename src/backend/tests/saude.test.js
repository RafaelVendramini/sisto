// Testes da rota pública de saúde GET/HEAD /saude (Issue #138): chamada por um
// cron externo a cada 10 minutos para manter a API da homologação acordada.
// Deve responder 200 sem token, sem acessar o banco (para não acordar o Neon),
// sem dados internos, com Cache-Control: no-store e fora do limite de
// tentativas. Somente dados fictícios (RN05). Não dependem da data real nem do
// banco.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Banco simulado: TODO acesso ao Prisma é registrado em `acessos`. Com
// `bloquear` ligado, qualquer acesso também lança erro — se a rota tocasse o
// banco, a resposta viraria 500 e o teste falharia.
const mocks = vi.hoisted(() => ({
  acessos: [],
  bloquear: true,
  usuarioFindUnique: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => {
  const real = { usuario: { findUnique: mocks.usuarioFindUnique } };
  const registrarAcesso = (nome) => {
    mocks.acessos.push(String(nome));
    if (mocks.bloquear) {
      throw new Error(`Acesso indevido ao banco na rota /saude: ${String(nome)}`);
    }
  };
  return {
    default: new Proxy(real, {
      get(alvo, propriedade) {
        registrarAcesso(propriedade);
        return Reflect.get(alvo, propriedade);
      },
    }),
    obterPrisma: () => registrarAcesso('obterPrisma'),
    criarPrismaClient: () => registrarAcesso('criarPrismaClient'),
    desconectarPrisma: async () => registrarAcesso('desconectarPrisma'),
  };
});

const { default: app, criarApp } = await import('../src/app.js');
const { RESPOSTA_SAUDE } = await import('../src/controllers/saude.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ORIGEM_PERMITIDA = 'http://localhost:5173';
let segredoOriginal;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  mocks.acessos.length = 0;
  mocks.bloquear = true;
  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockResolvedValue({
    id: 1,
    perfil: 'GESTAO',
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
});

describe('GET /saude (Issue #138)', () => {
  it('responde 200 com exatamente { status: "ok" }, sem token', async () => {
    const res = await request(app).get('/saude');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.text).toBe('{"status":"ok"}');
    expect(RESPOSTA_SAUDE).toEqual({ status: 'ok' });
  });

  it('não exige token nem é afetada por um token inválido', async () => {
    const res = await request(app)
      .get('/saude')
      .set('Authorization', 'Bearer token-ficticio-invalido');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('não expõe dados internos (versão, ambiente, uptime)', async () => {
    const res = await request(app).get('/saude');

    expect(Object.keys(res.body)).toEqual(['status']);
    expect(res.text).not.toMatch(/version|versao|ambiente|env|uptime|node|prisma/i);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('traz Cache-Control: no-store (middleware global)', async () => {
    const res = await request(app).get('/saude');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('não acessa o banco: nenhum acesso ao Prisma (que lançaria erro)', async () => {
    const res = await request(app).get('/saude');
    const head = await request(app).head('/saude');

    expect(res.status).toBe(200);
    expect(head.status).toBe(200);
    expect(mocks.acessos).toEqual([]);
    expect(mocks.usuarioFindUnique).not.toHaveBeenCalled();
  });

  it('o próprio banco simulado detecta acesso (controle do teste acima)', async () => {
    // Garante que a verificação não é vazia: uma rota protegida com token
    // válido consulta o usuário no banco e, com o bloqueio ligado, vira 500.
    const token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app).get('/categorias').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(mocks.acessos.length).toBeGreaterThan(0);
  });
});

describe('GET /saude com corpo JSON malformado (documentado no openapi.yaml)', () => {
  it('o leitor de JSON global responde 400 antes da rota, sem acessar o banco', async () => {
    const res = await request(app)
      .get('/saude')
      .set('Content-Type', 'application/json')
      .send('{"invalido":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: 'JSON inválido no corpo da requisição' });
    expect(mocks.acessos).toEqual([]);
  });
});

describe('HEAD /saude (Issue #138)', () => {
  it('responde 200 sem corpo e com Cache-Control: no-store', async () => {
    const res = await request(app).head('/saude');

    expect(res.status).toBe(200);
    expect(res.text ?? '').toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('/saude e o limite de tentativas (Issue #138)', () => {
  it('muitas chamadas seguidas não geram 429 nem cabeçalhos de limite', async () => {
    // Limites mínimos (1 falha) para tornar a verificação mais rígida: mesmo
    // assim, a rota de saúde nunca é contada nem recusada.
    const appLimiteMinimo = criarApp({
      limiteTentativas: { maximo: 1, maximoPorIp: 1 },
    });

    for (let i = 0; i < 120; i += 1) {
      const res = await request(appLimiteMinimo).get('/saude');
      expect(res.status).toBe(200);
      expect(res.headers['retry-after']).toBeUndefined();
      expect(res.headers['ratelimit']).toBeUndefined();
      expect(res.headers['ratelimit-policy']).toBeUndefined();
    }
    for (let i = 0; i < 20; i += 1) {
      const res = await request(appLimiteMinimo).head('/saude');
      expect(res.status).toBe(200);
    }
    expect(mocks.acessos).toEqual([]);
  });
});

describe('/saude e o CORS (Issue #138)', () => {
  // App com a allowlist FIXA: o teste não pode depender do CORS_ORIGIN do
  // ambiente. No build do Render, o npm test roda com o CORS_ORIGIN de
  // produção (só o endereço do front publicado), e um teste que usasse o app
  // padrão com http://localhost:5173 falharia (foi o que derrubou o primeiro
  // deploy da #138).
  const appCors = criarApp({ cors: { corsOrigin: ORIGEM_PERMITIDA, ambiente: 'test' } });

  it('cron sem cabeçalho Origin recebe 200 (sem Access-Control-Allow-Origin)', async () => {
    const res = await request(appCors).get('/saude');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('origem permitida recebe Access-Control-Allow-Origin', async () => {
    const res = await request(appCors).get('/saude').set('Origin', ORIGEM_PERMITIDA);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_PERMITIDA);
  });

  it('origem fora da allowlist não recebe Access-Control-Allow-Origin', async () => {
    const res = await request(appCors).get('/saude').set('Origin', 'https://site-ficticio.exemplo');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('preflight OPTIONS segue a regra das demais rotas (204, no-store)', async () => {
    const res = await request(appCors)
      .options('/saude')
      .set('Origin', ORIGEM_PERMITIDA)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGEM_PERMITIDA);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('/saude só aceita GET e HEAD (Issue #138)', () => {
  it.each(['post', 'put', 'patch', 'delete'])(
    '%s /saude sem token segue o padrão de rota inexistente (401)',
    async (metodo) => {
      const res = await request(app)[metodo]('/saude');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('erro');
      expect(res.body).not.toHaveProperty('status');
    },
  );

  it('POST /saude com token válido responde 404 (Rota não encontrada)', async () => {
    mocks.bloquear = false; // a autenticação precisa consultar o usuário
    const token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app).post('/saude').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });
});

describe('Ordem da rota /saude no roteador principal (Issue #138)', () => {
  it('fica antes do sub-roteador protegido (autenticação JWT)', async () => {
    const { default: rotas, protegidas } = await import('../src/routes/index.js');
    const { default: rotasSaude } = await import('../src/routes/saude.js');
    const camadas = rotas.stack.map((camada) => camada.handle);

    const posicaoSaude = camadas.indexOf(rotasSaude);
    const posicaoProtegidas = camadas.indexOf(protegidas);
    expect(posicaoSaude).toBeGreaterThan(-1);
    expect(posicaoProtegidas).toBeGreaterThan(posicaoSaude);
  });

  it('o roteador de /saude só tem GET /', async () => {
    const { default: rotasSaude } = await import('../src/routes/saude.js');
    const rotasRegistradas = rotasSaude.stack.map((camada) => ({
      caminho: camada.route?.path,
      metodos: Object.keys(camada.route?.methods ?? {}),
    }));

    expect(rotasRegistradas).toEqual([{ caminho: '/', metodos: ['get'] }]);
  });
});
