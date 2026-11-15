// QA — Issue #80: testes complementares do script de recuperação da Gestão
// (RN07, RN09, RN10, RN11, RN12, RNF04, RNF06; SSD 1.8, Seção 10).
// Somente dados fictícios (RN05). Não depende do banco: src/lib/prisma.js é
// substituído por um "banco" em memória compartilhado com a API (login,
// middleware de sessão e PUT /conta/senha).
//
// Diferente de tests/recuperar-gestao.test.js, aqui services/senha.js NÃO é
// substituído: o script usa o hash real (custo 12), como em produção.
//
// O último bloco executa o ponto de entrada real (prisma/recuperar-gestao-cli.js)
// num processo filho, só em cenários que param ANTES de qualquer banco ou com
// DATABASE_URL apontando para uma porta local sem serviço (127.0.0.1:1) —
// nunca para o banco de desenvolvimento.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { findUnique, findMany, update, $transaction, $queryRaw, criarLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  criarLog: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique, findMany, update },
    logAuditoria: { create: criarLog },
    $transaction,
  },
  criarPrismaClient: vi.fn(),
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const { CUSTO_BCRYPT } = await import('../src/services/senha.js');
const {
  recuperarGestao,
  executarRecuperacaoGestao,
  VARIAVEL_SENHA_TEMPORARIA,
  MENSAGEM_ARGUMENTOS_INVALIDOS,
  MENSAGEM_EMAIL_AUSENTE,
  MENSAGEM_SENHA_AUSENTE,
  MENSAGEM_USUARIO_NAO_ENCONTRADO,
  MENSAGEM_USUARIO_NAO_GESTAO,
  MENSAGEM_DATABASE_URL_AUSENTE,
  MENSAGEM_FALHA_BANCO,
} = await import('../prisma/recuperar-gestao.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_INICIAL = 'SenhaInicialFicticia1';
const SENHA_TEMPORARIA = 'Temporaria#Ficticia2026';
const SENHA_DEFINITIVA = 'Definitiva#Ficticia2026';
const URL_FICTICIA = 'postgresql://usuario_ficticio:senha_ficticia@localhost:5432/banco_ficticio';

const PREFIXO_RECUSA = 'Recuperação recusada — nada foi alterado. ';
const MSG_SENHA_CURTA = `${VARIAVEL_SENHA_TEMPORARIA}: A senha deve ter no mínimo 8 caracteres.`;
const MSG_SENHA_LONGA = `${VARIAVEL_SENHA_TEMPORARIA}: A senha deve ter no máximo 72 bytes (letras acentuadas contam 2 bytes).`;

const ID_GESTAO = 1;
const ID_GESTAO_2 = 2;
const ID_GESTAO_DESATIVADA = 3;
const ID_PROFESSOR_BLOQUEADO = 4;

const EMAIL_GESTAO = 'gestao.qa@sisto.exemplo';
const EMAIL_GESTAO_2 = 'gestao.dois.qa@sisto.exemplo';
const EMAIL_GESTAO_DESATIVADA = 'gestao.desativada.qa@sisto.exemplo';
const EMAIL_PROFESSOR_BLOQUEADO = 'professor.bloqueado.qa@sisto.exemplo';
const EMAIL_TUTOR = 'tutor.qa@sisto.exemplo';
const EMAIL_PEDAGOGICO = 'pedagogico.qa@sisto.exemplo';
const EMAIL_TECNICO = 'tecnico.qa@sisto.exemplo';

let hashInicial;
let banco;
let logs;

beforeAll(async () => {
  // Custo baixo só no hash da senha INICIAL (fixture) para acelerar o login
  // com ela; o hash gravado pelo script é o real (custo 12).
  hashInicial = await bcrypt.hash(SENHA_INICIAL, 4);
});

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma ${code}`);
  erro.code = code;
  return erro;
}

function novoUsuario(id, perfil, email, status = 'ATIVO') {
  return {
    id,
    nome: `Usuário Fictício QA ${id}`,
    email,
    senha_hash: hashInicial,
    perfil,
    status,
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  };
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

const db = {
  usuario: { findUnique, findMany, update },
  logAuditoria: { create: criarLog },
  $transaction,
  $disconnect: vi.fn(async () => {}),
};

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    novoUsuario(ID_GESTAO, 'GESTAO', EMAIL_GESTAO),
    novoUsuario(ID_GESTAO_2, 'GESTAO', EMAIL_GESTAO_2),
    novoUsuario(ID_GESTAO_DESATIVADA, 'GESTAO', EMAIL_GESTAO_DESATIVADA, 'DESATIVADO'),
    novoUsuario(ID_PROFESSOR_BLOQUEADO, 'PROFESSOR', EMAIL_PROFESSOR_BLOQUEADO, 'BLOQUEADO'),
    novoUsuario(5, 'TUTOR', EMAIL_TUTOR),
    novoUsuario(6, 'PEDAGOGICO', EMAIL_PEDAGOGICO),
    novoUsuario(7, 'TECNICO_ADMINISTRATIVO', EMAIL_TECNICO),
  ];
  logs = [];

  findUnique.mockReset().mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });
  findMany.mockReset().mockImplementation(async ({ select } = {}) => banco.map((u) => selecionar(u, select)));
  update.mockReset().mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    if (!registro) throw erroPrisma('P2025');
    Object.assign(registro, data);
    return selecionar(registro, select);
  });
  criarLog.mockReset().mockImplementation(async ({ data }) => {
    logs.push(data);
    return { id: logs.length };
  });
  // Relógio do banco (SELECT clock_timestamp()): por padrão, em sincronia com
  // o relógio real, para os tokens emitidos pela API serem comparáveis (RN12).
  $queryRaw.mockReset().mockImplementation(async () => [{ agora: new Date() }]);
  $transaction.mockReset().mockImplementation(async (fn) => {
    const copiaBanco = structuredClone(banco);
    const copiaLogs = [...logs];
    try {
      return await fn({
        usuario: { findUnique, findMany, update },
        logAuditoria: { create: criarLog },
        $queryRaw,
      });
    } catch (erro) {
      banco = copiaBanco;
      logs = copiaLogs;
      throw erro;
    }
  });
  db.$disconnect.mockClear();
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.restoreAllMocks();
});

/** Fotografia do banco e dos logs, para provar que nada mudou numa recusa. */
function fotografar() {
  return { banco: structuredClone(banco), logs: structuredClone(logs) };
}

function esperarIgualA(foto) {
  expect(banco).toEqual(foto.banco);
  expect(logs).toEqual(foto.logs);
  expect(update).not.toHaveBeenCalled();
  expect(criarLog).not.toHaveBeenCalled();
}

/** Nada de senha, hash, e-mail ou DATABASE_URL no texto. */
function esperarSemSegredos(texto, extras = []) {
  for (const proibido of [SENHA_TEMPORARIA, URL_FICTICIA, 'senha_ficticia', ...extras]) {
    expect(texto).not.toContain(proibido);
  }
  expect(texto).not.toMatch(/\$2[aby]\$\d\d\$/); // hash bcrypt
  expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // qualquer e-mail
  expect(texto).not.toMatch(/postgres(ql)?:\/\//i);
}

function executar({ args = ['--email', EMAIL_GESTAO], env, gerarHash } = {}) {
  const saida = [];
  const erros = [];
  const criarCliente = vi.fn(() => db);
  return executarRecuperacaoGestao({
    args,
    env: env ?? { DATABASE_URL: URL_FICTICIA, [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
    criarCliente,
    escrever: (t) => saida.push(t),
    escreverErro: (t) => erros.push(t),
    deps: gerarHash ? { gerarHash } : undefined,
  }).then((codigo) => ({ codigo, saida, erros, criarCliente }));
}

function login(email, senha) {
  return request(app).post('/auth/login').send({ email, senha });
}

// ---------------------------------------------------------------------------
// Recusas pelo ponto de entrada: mensagem exata, código ≠ 0 e nada gravado
// ---------------------------------------------------------------------------

describe('executarRecuperacaoGestao — recusas antes de abrir conexão (mensagem exata, nada gravado)', () => {
  it.each([
    ['variável da senha ausente', {}, MENSAGEM_SENHA_AUSENTE],
    ['variável da senha vazia', { [VARIAVEL_SENHA_TEMPORARIA]: '' }, MENSAGEM_SENHA_AUSENTE],
    ['senha com 7 caracteres', { [VARIAVEL_SENHA_TEMPORARIA]: 'Abc#123' }, MSG_SENHA_CURTA],
    ['senha só com espaços (7)', { [VARIAVEL_SENHA_TEMPORARIA]: '       ' }, MSG_SENHA_CURTA],
    ['senha com 73 bytes ASCII', { [VARIAVEL_SENHA_TEMPORARIA]: 'x'.repeat(73) }, MSG_SENHA_LONGA],
    ['senha com 37 "á" (74 bytes)', { [VARIAVEL_SENHA_TEMPORARIA]: 'á'.repeat(37) }, MSG_SENHA_LONGA],
  ])('%s: código 1, só a mensagem exata no erro', async (_caso, envSenha, mensagem) => {
    const foto = fotografar();
    const gerarHash = vi.fn();
    const senhaInformada = envSenha[VARIAVEL_SENHA_TEMPORARIA];

    const { codigo, saida, erros, criarCliente } = await executar({
      env: { DATABASE_URL: URL_FICTICIA, ...envSenha },
      gerarHash,
    });

    expect(codigo).toBe(1);
    expect(codigo).not.toBe(0);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${mensagem}`]);
    expect(criarCliente).not.toHaveBeenCalled();
    expect(gerarHash).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    esperarIgualA(foto);
    if (senhaInformada && senhaInformada.trim()) {
      expect(erros.join('\n')).not.toContain(senhaInformada);
    }
    esperarSemSegredos(erros.join('\n'));
  });

  it.each([
    ['--email= vazio', ['--email='], MENSAGEM_EMAIL_AUSENTE],
    ['--email só com espaços', ['--email', '   '], MENSAGEM_EMAIL_AUSENTE],
    ['--password (outro nome)', ['--email', EMAIL_GESTAO, '--password', 'OutraSenha#2026'], MENSAGEM_ARGUMENTOS_INVALIDOS],
    ['-e (forma curta não aceita)', ['-e', EMAIL_GESTAO], MENSAGEM_ARGUMENTOS_INVALIDOS],
  ])('%s: código 1, mensagem exata, sem repetir valores', async (_caso, args, mensagem) => {
    const foto = fotografar();

    const { codigo, saida, erros, criarCliente } = await executar({ args });

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${mensagem}`]);
    expect(criarCliente).not.toHaveBeenCalled();
    esperarIgualA(foto);
    esperarSemSegredos(erros.join('\n'), ['OutraSenha#2026']);
  });

  it('sem DATABASE_URL: código 1, mensagem exata e não abre conexão', async () => {
    const foto = fotografar();

    const { codigo, saida, erros, criarCliente } = await executar({
      env: { [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
    });

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${MENSAGEM_DATABASE_URL_AUSENTE}`]);
    expect(criarCliente).not.toHaveBeenCalled();
    esperarIgualA(foto);
  });
});

describe('executarRecuperacaoGestao — recusas depois de consultar o usuário (nada gravado)', () => {
  it.each([
    ['PROFESSOR (bloqueado — não é reativado)', EMAIL_PROFESSOR_BLOQUEADO],
    ['TUTOR', EMAIL_TUTOR],
    ['PEDAGOGICO', EMAIL_PEDAGOGICO],
    ['TECNICO_ADMINISTRATIVO', EMAIL_TECNICO],
  ])('perfil %s: código 1 e mensagem exata de "não é Gestão"', async (_perfil, email) => {
    const foto = fotografar();
    const gerarHash = vi.fn();

    const { codigo, saida, erros } = await executar({ args: ['--email', email], gerarHash });

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${MENSAGEM_USUARIO_NAO_GESTAO}`]);
    expect(gerarHash).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    esperarIgualA(foto);
    esperarSemSegredos(erros.join('\n'));
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('o Professor bloqueado continua sem acesso depois da recusa (RN09)', async () => {
    await executar({ args: ['--email', EMAIL_PROFESSOR_BLOQUEADO] });

    expect(buscar(ID_PROFESSOR_BLOQUEADO).status).toBe('BLOQUEADO');
    expect((await login(EMAIL_PROFESSOR_BLOQUEADO, SENHA_INICIAL)).status).toBe(401);
    expect((await login(EMAIL_PROFESSOR_BLOQUEADO, SENHA_TEMPORARIA)).status).toBe(401);
  });

  it('e-mail inexistente: código 1, mensagem exata, nada gravado', async () => {
    const foto = fotografar();

    const { codigo, saida, erros } = await executar({ args: ['--email', 'ninguem.qa@sisto.exemplo'] });

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${MENSAGEM_USUARIO_NAO_ENCONTRADO}`]);
    esperarIgualA(foto);
    esperarSemSegredos(erros.join('\n'));
  });

  it('usuário removido entre a leitura e o update (P2025): mensagem de não encontrado e nada gravado', async () => {
    update.mockImplementationOnce(async () => {
      throw erroPrisma('P2025');
    });
    const fotoBanco = structuredClone(banco);

    const { codigo, erros } = await executar();

    expect(codigo).toBe(1);
    expect(erros).toEqual([`${PREFIXO_RECUSA}${MENSAGEM_USUARIO_NAO_ENCONTRADO}`]);
    expect(banco).toEqual(fotoBanco);
    expect(logs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sucesso: o que é gravado (hash real de produção) e o que NÃO é tocado
// ---------------------------------------------------------------------------

describe('recuperarGestao — gravação (hash real, custo de produção)', () => {
  it('grava hash bcrypt com o custo de produção que confere com bcrypt.compare', async () => {
    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });

    const { senha_hash } = buscar(ID_GESTAO);
    expect(senha_hash).toMatch(new RegExp(`^\\$2[aby]\\$${String(CUSTO_BCRYPT).padStart(2, '0')}\\$`));
    expect(bcrypt.getRounds(senha_hash)).toBe(12);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, senha_hash)).toBe(true);
    expect(await bcrypt.compare(SENHA_INICIAL, senha_hash)).toBe(false);
  });

  it('Gestão ativa: só altera senha_hash, troca_senha_obrigatoria e senha_alterada_em (status não é enviado)', async () => {
    const antes = structuredClone(buscar(ID_GESTAO));

    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });

    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0];
    expect(where).toEqual({ id: ID_GESTAO });
    expect(Object.keys(data).sort()).toEqual(['senha_alterada_em', 'senha_hash', 'troca_senha_obrigatoria']);
    const depois = buscar(ID_GESTAO);
    expect({ ...depois, senha_hash: null, senha_alterada_em: null, troca_senha_obrigatoria: null }).toEqual({
      ...antes,
      senha_hash: null,
      senha_alterada_em: null,
      troca_senha_obrigatoria: null,
    });
    // Nenhum outro usuário é tocado.
    for (const outro of banco.filter((u) => u.id !== ID_GESTAO)) {
      expect(outro.senha_hash).toBe(hashInicial);
      expect(outro.senha_alterada_em).toBeNull();
    }
  });

  it('Gestão desativada: envia status ATIVO e registra as duas ações, nessa ordem, sem senha/hash/e-mail', async () => {
    await recuperarGestao(db, { email: EMAIL_GESTAO_DESATIVADA, senha: SENHA_TEMPORARIA });

    expect(update.mock.calls[0][0].data.status).toBe('ATIVO');
    expect(logs).toEqual([
      { usuario_id: null, acao: ACOES_AUDITORIA.SENHA_REDEFINIDA_PELO_SCRIPT_DE_RECUPERACAO, recurso: 'usuarios/3' },
      { usuario_id: null, acao: ACOES_AUDITORIA.USUARIO_REATIVADO_PELO_SCRIPT_DE_RECUPERACAO, recurso: 'usuarios/3' },
    ]);
    expect(ACOES_AUDITORIA.SENHA_REDEFINIDA_PELO_SCRIPT_DE_RECUPERACAO).toBe(
      'senha redefinida pelo script de recuperação',
    );
    expect(ACOES_AUDITORIA.USUARIO_REATIVADO_PELO_SCRIPT_DE_RECUPERACAO).toBe(
      'usuário reativado pelo script de recuperação',
    );
    const texto = JSON.stringify(logs);
    esperarSemSegredos(texto, [buscar(ID_GESTAO_DESATIVADA).senha_hash]);
    // Os logs foram gravados dentro da transação (mesmo client tx).
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Saída padrão real (console): nada de senha, hash ou e-mail
// ---------------------------------------------------------------------------

describe('saída no terminal com console padrão (sem escrever/escreverErro injetados)', () => {
  function espiarConsole() {
    const metodos = ['log', 'error', 'warn', 'info', 'debug', 'trace'];
    const espias = metodos.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    return () => espias.flatMap((e) => e.mock.calls.map((args) => args.map(String).join(' '))).join('\n');
  }

  it.each([
    ['sucesso com reativação', ['--email', EMAIL_GESTAO_DESATIVADA], 0],
    ['e-mail inexistente', ['--email', 'ninguem.qa@sisto.exemplo'], 1],
    ['não é Gestão', ['--email', EMAIL_TUTOR], 1],
  ])('%s: nada sensível em nenhum método do console', async (_caso, args, esperado) => {
    const textoConsole = espiarConsole();

    const codigo = await executarRecuperacaoGestao({
      args,
      env: { DATABASE_URL: URL_FICTICIA, [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
      criarCliente: () => db,
    });

    expect(codigo).toBe(esperado);
    const texto = textoConsole();
    expect(texto.length).toBeGreaterThan(0);
    esperarSemSegredos(texto, [args[1]]);
    for (const usuario of banco) expect(texto).not.toContain(usuario.senha_hash);
  });

  it('falha do banco com detalhes internos: só a mensagem genérica no console', async () => {
    const textoConsole = espiarConsole();
    findUnique.mockRejectedValueOnce(
      new Error(`connect ECONNREFUSED ${URL_FICTICIA} user=usuario_ficticio email=${EMAIL_GESTAO}`),
    );

    const codigo = await executarRecuperacaoGestao({
      args: ['--email', EMAIL_GESTAO],
      env: { DATABASE_URL: URL_FICTICIA, [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
      criarCliente: () => db,
    });

    expect(codigo).toBe(1);
    const texto = textoConsole();
    // Falha inesperada: só a mensagem genérica, sem afirmar que nada foi alterado.
    expect(texto).toBe(MENSAGEM_FALHA_BANCO);
    expect(texto).not.toContain('nada foi alterado');
    esperarSemSegredos(texto, ['usuario_ficticio']);
  });
});

// ---------------------------------------------------------------------------
// Efeito na API: senha temporária → 403 em tudo, exceto PUT /conta/senha
// ---------------------------------------------------------------------------

describe('API depois da recuperação (RN10, RN12, RN09)', () => {
  const ROTAS_BLOQUEADAS = [
    ['get', '/usuarios'],
    ['post', '/usuarios'],
    ['put', `/usuarios/${ID_GESTAO_2}`],
    ['put', `/usuarios/${ID_GESTAO_2}/senha`],
    ['get', '/categorias'],
    ['get', '/turmas'],
    ['get', '/estudantes'],
    ['get', '/ocorrencias'],
    ['post', '/ocorrencias'],
    ['get', '/rota-inexistente-qa'],
  ];

  it('com a senha temporária: 403 com a mensagem de troca obrigatória em todas as rotas protegidas', async () => {
    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });
    const resLogin = await login(EMAIL_GESTAO, SENHA_TEMPORARIA);
    expect(resLogin.status).toBe(200);
    expect(resLogin.body.trocaSenhaObrigatoria).toBe(true);
    const { token } = resLogin.body;

    for (const [metodo, rota] of ROTAS_BLOQUEADAS) {
      const res = await request(app)[metodo](rota).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status, `${metodo.toUpperCase()} ${rota}`).toBe(403);
      expect(res.body.erro, `${metodo.toUpperCase()} ${rota}`).toBe(MENSAGEM_TROCA_SENHA_OBRIGATORIA);
    }
    // Nenhuma das tentativas gravou nada além da recuperação.
    expect(logs).toHaveLength(1);
  });

  it('PUT /conta/senha funciona com a senha temporária, zera a troca obrigatória e encerra a sessão (RN12)', async () => {
    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });
    const { token } = (await login(EMAIL_GESTAO, SENHA_TEMPORARIA)).body;

    const resTroca = await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_DEFINITIVA });

    expect(resTroca.status).toBe(204);
    const gestao = buscar(ID_GESTAO);
    expect(gestao.troca_senha_obrigatoria).toBe(false);
    expect(await bcrypt.compare(SENHA_DEFINITIVA, gestao.senha_hash)).toBe(true);
    expect(logs.map((l) => [l.usuario_id, l.acao])).toEqual([
      [null, 'senha redefinida pelo script de recuperação'],
      [ID_GESTAO, 'senha alterada pelo usuário'],
    ]);

    // O token usado na troca deixa de valer (RN12).
    const resTokenAntigo = await request(app).put('/conta/senha').set('Authorization', `Bearer ${token}`).send({});
    expect(resTokenAntigo.status).toBe(401);
    expect(resTokenAntigo.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });

    // A temporária não entra mais; a definitiva entra sem troca pendente e acessa as rotas.
    expect((await login(EMAIL_GESTAO, SENHA_TEMPORARIA)).status).toBe(401);
    const resLogin = await login(EMAIL_GESTAO, SENHA_DEFINITIVA);
    expect(resLogin.status).toBe(200);
    expect(resLogin.body.trocaSenhaObrigatoria).toBe(false);
    const resUsuarios = await request(app).get('/usuarios').set('Authorization', `Bearer ${resLogin.body.token}`);
    expect(resUsuarios.status).toBe(200);
  });

  it('PUT /conta/senha recusa nova senha igual à temporária (400) e mantém a troca obrigatória', async () => {
    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });
    const { token } = (await login(EMAIL_GESTAO, SENHA_TEMPORARIA)).body;

    const res = await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_TEMPORARIA });

    expect(res.status).toBe(400);
    expect(buscar(ID_GESTAO).troca_senha_obrigatoria).toBe(true);
  });

  it('só as sessões da Gestão recuperada caem: o token de outra Gestão continua valendo', async () => {
    const tokenAlvo = (await login(EMAIL_GESTAO, SENHA_INICIAL)).body.token;
    const tokenOutra = (await login(EMAIL_GESTAO_2, SENHA_INICIAL)).body.token;

    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });

    expect((await request(app).get('/usuarios').set('Authorization', `Bearer ${tokenAlvo}`)).status).toBe(401);
    expect((await request(app).get('/usuarios').set('Authorization', `Bearer ${tokenOutra}`)).status).toBe(200);
  });

  it('o token emitido antes da execução não serve nem para PUT /conta/senha (RN12)', async () => {
    const tokenAntigo = (await login(EMAIL_GESTAO, SENHA_INICIAL)).body.token;

    await recuperarGestao(db, { email: EMAIL_GESTAO, senha: SENHA_TEMPORARIA });

    const res = await request(app)
      .put('/conta/senha')
      .set('Authorization', `Bearer ${tokenAntigo}`)
      .send({ senhaAtual: SENHA_TEMPORARIA, novaSenha: SENHA_DEFINITIVA });
    expect(res.status).toBe(401);
    expect(buscar(ID_GESTAO).troca_senha_obrigatoria).toBe(true);
  });

  it('Gestão DESATIVADA: sem acesso antes; depois da recuperação entra com troca obrigatória (RN07, RN09)', async () => {
    expect((await login(EMAIL_GESTAO_DESATIVADA, SENHA_INICIAL)).status).toBe(401);

    await recuperarGestao(db, { email: EMAIL_GESTAO_DESATIVADA, senha: SENHA_TEMPORARIA });

    expect(buscar(ID_GESTAO_DESATIVADA).status).toBe('ATIVO');
    const resLogin = await login(EMAIL_GESTAO_DESATIVADA, SENHA_TEMPORARIA);
    expect(resLogin.status).toBe(200);
    expect(resLogin.body.trocaSenhaObrigatoria).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ponto de entrada real (processo filho): código de saída do processo
// ---------------------------------------------------------------------------

const DIR_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(DIR_BACKEND, 'prisma', 'recuperar-gestao-cli.js');

/**
 * Executa o CLI como o script do package.json (sem --env-file: o .env de
 * desenvolvimento não é lido) e com DATABASE_URL e a senha removidas do
 * ambiente herdado; cada caso define as suas. Devolve código de saída,
 * stdout e stderr.
 */
function rodarCli(args, envExtra) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env[VARIAVEL_SENHA_TEMPORARIA];
  delete env.JWT_SECRET;
  Object.assign(env, envExtra);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: DIR_BACKEND, env, timeout: 30000, windowsHide: true },
      (erro, stdout, stderr) => {
        resolve({ codigo: erro ? erro.code : 0, stdout, stderr });
      },
    );
  });
}

describe('script recuperar-gestao do package.json', () => {
  it('não carrega o .env implicitamente: usa só a DATABASE_URL do terminal', () => {
    const pacote = JSON.parse(readFileSync(path.join(DIR_BACKEND, 'package.json'), 'utf8'));

    expect(pacote.scripts['recuperar-gestao']).toBe('node prisma/recuperar-gestao-cli.js');
    expect(pacote.scripts['recuperar-gestao']).not.toMatch(/env-file/);
  });
});

describe('recuperar-gestao-cli.js (processo real) — código de saída ≠ 0 nas recusas', () => {
  const EMAIL_CLI = 'gestao.cli.qa@sisto.exemplo';

  it.each([
    ['variável da senha ausente', ['--email', EMAIL_CLI], {}, MENSAGEM_SENHA_AUSENTE],
    ['senha curta', ['--email', EMAIL_CLI], { [VARIAVEL_SENHA_TEMPORARIA]: 'Curta#1' }, MSG_SENHA_CURTA],
    ['senha longa', ['--email', EMAIL_CLI], { [VARIAVEL_SENHA_TEMPORARIA]: 'y'.repeat(73) }, MSG_SENHA_LONGA],
    [
      'senha por argumento',
      ['--email', EMAIL_CLI, '--senha', SENHA_TEMPORARIA],
      { [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
      MENSAGEM_ARGUMENTOS_INVALIDOS,
    ],
    ['sem --email', [], { [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA }, MENSAGEM_EMAIL_AUSENTE],
    [
      'sem DATABASE_URL',
      ['--email', EMAIL_CLI],
      { [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
      MENSAGEM_DATABASE_URL_AUSENTE,
    ],
  ])('%s: sai com código 1 e só a mensagem de recusa no stderr', async (_caso, args, env, mensagem) => {
    const { codigo, stdout, stderr } = await rodarCli(args, env);

    expect(codigo).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.trim()).toBe(`${PREFIXO_RECUSA}${mensagem}`);
    esperarSemSegredos(`${stdout}\n${stderr}`, ['Curta#1', 'y'.repeat(73)]);
  }, 30000);

  it('banco inacessível (porta local sem serviço): código 1, mensagem genérica, sem URL/credenciais/e-mail', async () => {
    const urlInacessivel = 'postgresql://usuario_ficticio:senha_ficticia@127.0.0.1:1/banco_ficticio';

    const { codigo, stdout, stderr } = await rodarCli(['--email', EMAIL_CLI], {
      DATABASE_URL: urlInacessivel,
      [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA,
    });

    expect(codigo).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.trim()).toBe(MENSAGEM_FALHA_BANCO);
    esperarSemSegredos(`${stdout}\n${stderr}`, ['usuario_ficticio', '127.0.0.1', 'banco_ficticio']);
  }, 30000);
});
