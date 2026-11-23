// Testes do diagnóstico temporário do 'trust proxy' (Issue #127).
// Com DIAGNOSTICO_PROXY=1, cada POST /auth/login registra UMA linha com
// req.ip, a quantidade de endereços do X-Forwarded-For e o próprio cabeçalho;
// sem a variável (padrão), nada é registrado. Nunca e-mail, senha ou corpo.
// Somente dados fictícios (RN05): IPs de documentação (RFC 5737) e e-mails
// @sisto.exemplo. Não dependem do banco.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique } },
}));

const { default: app } = await import('../src/app.js');
const {
  PREFIXO_DIAGNOSTICO_PROXY,
  TAMANHO_MAXIMO_CABECALHO,
  VARIAVEL_DIAGNOSTICO_PROXY,
  contarEnderecos,
  criarDiagnosticoProxy,
} = await import('../src/middlewares/diagnostico-proxy.js');
const { CHAVE_LIMITADORES, criarLimitadoresTentativas } = await import(
  '../src/middlewares/limite-tentativas.js'
);

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const EMAIL = 'diagnostico.ficticio@sisto.exemplo';
const SENHA = 'SenhaFicticiaDiagnostico9';

let valorOriginal;
let espiaoInfo;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  valorOriginal = process.env[VARIAVEL_DIAGNOSTICO_PROXY];
  delete process.env[VARIAVEL_DIAGNOSTICO_PROXY];
  app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas();
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
  espiaoInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  if (valorOriginal === undefined) delete process.env[VARIAVEL_DIAGNOSTICO_PROXY];
  else process.env[VARIAVEL_DIAGNOSTICO_PROXY] = valorOriginal;
  vi.restoreAllMocks();
});

/** Linhas do diagnóstico registradas em QUALQUER método do console. */
function linhasDiagnostico(espioes) {
  return espioes
    .flatMap((espiao) => espiao.mock.calls)
    .map((argumentos) => argumentos.join(' '))
    .filter((linha) => linha.includes(PREFIXO_DIAGNOSTICO_PROXY));
}

function dadosDaLinha(linha) {
  return JSON.parse(linha.slice(PREFIXO_DIAGNOSTICO_PROXY.length + 1));
}

function login(xForwardedFor) {
  const req = request(app).post('/auth/login');
  if (xForwardedFor !== undefined) req.set('X-Forwarded-For', xForwardedFor);
  return req.send({ email: EMAIL, senha: SENHA });
}

describe('Diagnóstico do trust proxy — ligado (DIAGNOSTICO_PROXY=1)', () => {
  it('registra uma linha por login com req.ip, quantidade de endereços e o cabeçalho', async () => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = '1';

    // O cliente inventa um endereço; o proxy (único confiável) acrescenta o real.
    const res = await login('198.51.100.7, 203.0.113.10');

    expect(res.status).toBe(401);
    const linhas = linhasDiagnostico([espiaoInfo]);
    expect(linhas).toHaveLength(1);
    expect(dadosDaLinha(linhas[0])).toEqual({
      // trust proxy = 1: req.ip é o ÚLTIMO endereço (o que o proxy viu).
      ip: '203.0.113.10',
      quantidadeEnderecos: 2,
      xForwardedFor: '198.51.100.7, 203.0.113.10',
    });
  });

  it('sem X-Forwarded-For: quantidade 0 e cabeçalho null', async () => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = '1';

    await login();

    const linhas = linhasDiagnostico([espiaoInfo]);
    expect(linhas).toHaveLength(1);
    const dados = dadosDaLinha(linhas[0]);
    expect(dados.quantidadeEnderecos).toBe(0);
    expect(dados.xForwardedFor).toBeNull();
    expect(typeof dados.ip).toBe('string');
  });

  it('nunca registra e-mail, senha nem corpo (em nenhum método do console)', async () => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = '1';
    const espioes = [espiaoInfo, ...['log', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )];

    await login('203.0.113.10');

    const tudo = espioes
      .flatMap((espiao) => espiao.mock.calls)
      .map((argumentos) => argumentos.join(' '))
      .join('\n');
    expect(linhasDiagnostico(espioes)).toHaveLength(1);
    expect(tudo).not.toContain(EMAIL);
    expect(tudo).not.toContain('diagnostico.ficticio');
    expect(tudo).not.toContain(SENHA);
    expect(tudo).not.toMatch(/senha|email/i);
  });

  it('registra também a tentativa recusada com 429 (uma linha por requisição)', async () => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = '1';
    app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas({ maximo: 1 });

    expect((await login('203.0.113.10')).status).toBe(401);
    expect((await login('203.0.113.10')).status).toBe(429);

    expect(linhasDiagnostico([espiaoInfo])).toHaveLength(2);
  });

  it('cabeçalho forjado com quebra de linha não cria linha falsa no log e é cortado', async () => {
    const registradas = [];
    const middleware = criarDiagnosticoProxy({
      env: { [VARIAVEL_DIAGNOSTICO_PROXY]: '1' },
      registrar: (linha) => registradas.push(linha),
    });
    const longo = `203.0.113.10\n[diagnostico-proxy] falso, ${'9'.repeat(2000)}`;
    const next = vi.fn();

    middleware({ ip: '203.0.113.10', get: () => longo }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(registradas).toHaveLength(1);
    expect(registradas[0]).not.toContain('\n');
    const dados = dadosDaLinha(registradas[0]);
    expect(dados.xForwardedFor).toHaveLength(TAMANHO_MAXIMO_CABECALHO);
    expect(dados.quantidadeEnderecos).toBe(2);
  });
});

describe('Diagnóstico do trust proxy — desligado (padrão)', () => {
  it('sem a variável, não registra nada', async () => {
    await login('198.51.100.7, 203.0.113.10');

    expect(linhasDiagnostico([espiaoInfo])).toHaveLength(0);
    expect(espiaoInfo).not.toHaveBeenCalled();
  });

  it.each(['0', 'true', 'sim', ' 1', ''])('valor "%s" (diferente de "1") não liga', async (valor) => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = valor;

    await login('203.0.113.10');

    expect(espiaoInfo).not.toHaveBeenCalled();
  });

  it('outras rotas não registram, mesmo ligado', async () => {
    process.env[VARIAVEL_DIAGNOSTICO_PROXY] = '1';

    await request(app).get('/categorias').set('X-Forwarded-For', '203.0.113.10');

    expect(espiaoInfo).not.toHaveBeenCalled();
  });
});

describe('contarEnderecos', () => {
  it('conta os endereços não vazios', () => {
    expect(contarEnderecos(undefined)).toBe(0);
    expect(contarEnderecos('')).toBe(0);
    expect(contarEnderecos('203.0.113.10')).toBe(1);
    expect(contarEnderecos('198.51.100.7, 203.0.113.10')).toBe(2);
    expect(contarEnderecos('198.51.100.7,, 203.0.113.10, ')).toBe(2);
  });
});
