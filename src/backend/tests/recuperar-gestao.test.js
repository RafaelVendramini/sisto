// Testes do script de recuperação da Gestão (Issue #80 — RN07, RN09, RN10,
// RN11, RN12, RNF04, RNF06; SSD 1.8, Seção 10). Somente dados fictícios (RN05).
// Não dependem do banco (mesmo padrão de tests/troca-senha.test.js):
// src/lib/prisma.js é substituído por um "banco" em memória, compartilhado
// com o login e o middleware de sessão da API — o que o script grava é o que
// a API enxerga (prova de que os tokens anteriores deixam de valer).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

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

// Custo bcrypt baixo só para acelerar os testes (a política de senha é a real).
vi.mock('../src/services/senha.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, gerarHashSenha: (senha) => original.gerarHashSenha(senha, 4) };
});

const { default: app } = await import('../src/app.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const { gerarHashSenha } = await import('../src/services/senha.js');
const {
  recuperarGestao,
  executarRecuperacaoGestao,
  lerEmailDosArgumentos,
  ErroRecuperacaoGestao,
  VARIAVEL_SENHA_TEMPORARIA,
  MENSAGEM_ARGUMENTOS_INVALIDOS,
  MENSAGEM_EMAIL_AUSENTE,
  MENSAGEM_SENHA_AUSENTE,
  MENSAGEM_USUARIO_NAO_ENCONTRADO,
  MENSAGEM_USUARIO_NAO_GESTAO,
  MENSAGEM_CONFLITO,
  MENSAGEM_DATABASE_URL_AUSENTE,
  MENSAGEM_FALHA_BANCO,
} = await import('../prisma/recuperar-gestao.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_INICIAL = 'SenhaInicialFicticia1';
const SENHA_TEMPORARIA = 'Recuperacao#Ficticia2026';
const URL_FICTICIA = 'postgresql://usuario_ficticio:senha_ficticia@localhost:5432/banco_ficticio';

const ID_GESTAO = 1;
const ID_GESTAO_BLOQUEADA = 2;
const ID_GESTAO_DESATIVADA = 3;
const ID_PROFESSOR = 4;

const EMAIL_GESTAO = 'gestao.recuperacao@sisto.exemplo';
const EMAIL_GESTAO_BLOQUEADA = 'gestao.bloqueada@sisto.exemplo';
const EMAIL_GESTAO_DESATIVADA = 'gestao.desativada@sisto.exemplo';
const EMAIL_PROFESSOR = 'professor.recuperacao@sisto.exemplo';

let hashInicial;
let banco;
let logs;

beforeAll(async () => {
  hashInicial = await gerarHashSenha(SENHA_INICIAL);
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
    nome: `Usuário Fictício ${id}`,
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

/** Hash com custo baixo (só nos testes); a função real usa CUSTO_BCRYPT = 12. */
const gerarHash = vi.fn((senha) => gerarHashSenha(senha));

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    novoUsuario(ID_GESTAO, 'GESTAO', EMAIL_GESTAO),
    novoUsuario(ID_GESTAO_BLOQUEADA, 'GESTAO', EMAIL_GESTAO_BLOQUEADA, 'BLOQUEADO'),
    novoUsuario(ID_GESTAO_DESATIVADA, 'GESTAO', EMAIL_GESTAO_DESATIVADA, 'DESATIVADO'),
    novoUsuario(ID_PROFESSOR, 'PROFESSOR', EMAIL_PROFESSOR),
  ];
  logs = [];

  findUnique.mockReset().mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });
  findMany.mockReset().mockImplementation(async ({ select }) => banco.map((u) => selecionar(u, select)));
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
  // Transação "tudo ou nada": trabalha numa cópia e só aplica se não houver erro.
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
  gerarHash.mockClear();
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function recuperar(email, senha = SENHA_TEMPORARIA, deps = {}) {
  return recuperarGestao(db, { email, senha }, { gerarHash, ...deps });
}

async function esperarRecusa(promessa, mensagem) {
  const erro = await promessa.then(
    () => null,
    (e) => e,
  );
  expect(erro).toBeInstanceOf(ErroRecuperacaoGestao);
  expect(erro.message).toBe(mensagem);
  return erro;
}

function esperarNadaAlterado() {
  for (const usuario of banco) {
    expect(usuario.senha_hash).toBe(hashInicial);
    expect(usuario.troca_senha_obrigatoria).toBe(false);
    expect(usuario.senha_alterada_em).toBeNull();
  }
  expect(buscar(ID_GESTAO_BLOQUEADA).status).toBe('BLOQUEADO');
  expect(buscar(ID_GESTAO_DESATIVADA).status).toBe('DESATIVADO');
  expect(logs).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// recuperarGestao — sucesso
// ---------------------------------------------------------------------------

describe('recuperarGestao — sucesso', () => {
  it('redefine a senha de uma Gestão ativa: hash bcrypt, troca obrigatória e senha_alterada_em', async () => {
    const antes = Date.now();

    const resultado = await recuperar(EMAIL_GESTAO);

    expect(resultado).toEqual({ usuarioId: ID_GESTAO, reativado: false });
    const gestao = buscar(ID_GESTAO);
    expect(gestao.senha_hash).not.toBe(SENHA_TEMPORARIA);
    expect(gestao.senha_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, gestao.senha_hash)).toBe(true);
    expect(gestao.troca_senha_obrigatoria).toBe(true);
    expect(gestao.senha_alterada_em).toBeInstanceOf(Date);
    expect(gestao.senha_alterada_em.getTime()).toBeGreaterThanOrEqual(antes);
    expect(gestao.status).toBe('ATIVO');
    // Os demais usuários não são tocados.
    expect(buscar(ID_PROFESSOR).senha_hash).toBe(hashInicial);
  });

  it('grava tudo numa única transação serializável', async () => {
    await recuperar(EMAIL_GESTAO);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('grava "senha redefinida pelo script de recuperação" com usuario_id nulo e sem a senha', async () => {
    await recuperar(EMAIL_GESTAO);

    expect(logs).toEqual([
      {
        usuario_id: null,
        acao: ACOES_AUDITORIA.SENHA_REDEFINIDA_PELO_SCRIPT_DE_RECUPERACAO,
        recurso: `usuarios/${ID_GESTAO}`,
      },
    ]);
    expect(logs[0].acao).toBe('senha redefinida pelo script de recuperação');
    const texto = JSON.stringify(logs);
    expect(texto).not.toContain(SENHA_TEMPORARIA);
    expect(texto).not.toContain(EMAIL_GESTAO);
    expect(texto).not.toMatch(/\$2[aby]\$/);
  });

  it('encontra o usuário pelo e-mail normalizado (espaços nas pontas e maiúsculas)', async () => {
    const resultado = await recuperar(`  ${EMAIL_GESTAO.toUpperCase()}  `);

    expect(resultado.usuarioId).toBe(ID_GESTAO);
  });

  it.each([
    ['BLOQUEADO', ID_GESTAO_BLOQUEADA, EMAIL_GESTAO_BLOQUEADA],
    ['DESATIVADO', ID_GESTAO_DESATIVADA, EMAIL_GESTAO_DESATIVADA],
  ])('reativa a Gestão com status %s e registra as duas ações na auditoria', async (_status, id, email) => {
    const resultado = await recuperar(email);

    expect(resultado).toEqual({ usuarioId: id, reativado: true });
    const gestao = buscar(id);
    expect(gestao.status).toBe('ATIVO');
    expect(gestao.troca_senha_obrigatoria).toBe(true);
    expect(await bcrypt.compare(SENHA_TEMPORARIA, gestao.senha_hash)).toBe(true);
    expect(logs).toEqual([
      {
        usuario_id: null,
        acao: 'senha redefinida pelo script de recuperação',
        recurso: `usuarios/${id}`,
      },
      {
        usuario_id: null,
        acao: 'usuário reativado pelo script de recuperação',
        recurso: `usuarios/${id}`,
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain(SENHA_TEMPORARIA);
  });

  it('usa o mesmo critério de senha_alterada_em da API (anterior + 1s quando a troca anterior é recente)', async () => {
    const agora = new Date('2026-11-11T12:00:00.000Z');
    buscar(ID_GESTAO).senha_alterada_em = new Date(agora.getTime());

    await recuperar(EMAIL_GESTAO, SENHA_TEMPORARIA, { agora: () => agora });

    expect(buscar(ID_GESTAO).senha_alterada_em).toEqual(new Date(agora.getTime() + 1000));
    // Com agora injetado, o relógio do banco não é consultado.
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('sem agora injetado, usa o relógio do BANCO (clock_timestamp() dentro da transação), não o da máquina', async () => {
    // Relógio do banco fictício bem diferente do relógio local.
    const relogioBanco = new Date('2031-03-15T08:30:45.123Z');
    $queryRaw.mockResolvedValueOnce([{ agora: relogioBanco }]);

    await recuperar(EMAIL_GESTAO);

    expect(buscar(ID_GESTAO).senha_alterada_em).toEqual(relogioBanco);
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const [partesSql] = $queryRaw.mock.calls[0];
    expect(partesSql.join('')).toMatch(/clock_timestamp\(\)/);
  });

  it('relógio do banco também passa pelo desempate de 1s da RN12', async () => {
    const relogioBanco = new Date('2031-03-15T08:30:45.000Z');
    buscar(ID_GESTAO).senha_alterada_em = new Date(relogioBanco.getTime());
    $queryRaw.mockResolvedValueOnce([{ agora: relogioBanco }]);

    await recuperar(EMAIL_GESTAO);

    expect(buscar(ID_GESTAO).senha_alterada_em).toEqual(new Date(relogioBanco.getTime() + 1000));
  });

  it('se o banco não devolver um instante válido, falha sem gravar nada', async () => {
    $queryRaw.mockResolvedValueOnce([{ agora: null }]);

    await expect(recuperar(EMAIL_GESTAO)).rejects.toThrow(/instante válido/);
    expect(update).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it('aceita a senha com exatamente 8 caracteres e com exatamente 72 bytes', async () => {
    await expect(recuperar(EMAIL_GESTAO, 'Abcdef1!')).resolves.toEqual({
      usuarioId: ID_GESTAO,
      reativado: false,
    });
    const senha72Bytes = 'á'.repeat(36); // 36 caracteres, 72 bytes em UTF-8
    await expect(recuperar(EMAIL_GESTAO, senha72Bytes)).resolves.toMatchObject({
      usuarioId: ID_GESTAO,
    });
    expect(await bcrypt.compare(senha72Bytes, buscar(ID_GESTAO).senha_hash)).toBe(true);
  });

  it('não retira os espaços das pontas da senha', async () => {
    const senhaComEspacos = '  Espacos#2026  ';

    await recuperar(EMAIL_GESTAO, senhaComEspacos);

    const { senha_hash } = buscar(ID_GESTAO);
    expect(await bcrypt.compare(senhaComEspacos, senha_hash)).toBe(true);
    expect(await bcrypt.compare(senhaComEspacos.trim(), senha_hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recuperarGestao — recusas
// ---------------------------------------------------------------------------

describe('recuperarGestao — recusas (nada é gravado)', () => {
  it('recusa usuário que não é Gestão', async () => {
    const erro = await esperarRecusa(recuperar(EMAIL_PROFESSOR), MENSAGEM_USUARIO_NAO_GESTAO);

    expect(erro.message).not.toContain(EMAIL_PROFESSOR);
    expect(gerarHash).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it('recusa e-mail inexistente sem repetir o e-mail na mensagem', async () => {
    const email = 'inexistente@sisto.exemplo';

    const erro = await esperarRecusa(recuperar(email), MENSAGEM_USUARIO_NAO_ENCONTRADO);

    expect(erro.message).not.toContain(email);
    expect(gerarHash).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it.each([
    ['ausente (undefined)', undefined],
    ['vazio', '   '],
  ])('recusa e-mail %s', async (_caso, email) => {
    await esperarRecusa(recuperar(email), MENSAGEM_EMAIL_AUSENTE);
    expect(findUnique).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['texto vazio', ''],
  ])('recusa senha ausente (%s)', async (_caso, senha) => {
    // Chamada direta: o auxiliar recuperar() trocaria undefined pela senha padrão.
    await esperarRecusa(
      recuperarGestao(db, { email: EMAIL_GESTAO, senha }, { gerarHash }),
      MENSAGEM_SENHA_AUSENTE,
    );
    expect(findUnique).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it('recusa senha com menos de 8 caracteres (espaços contam, sem trim)', async () => {
    for (const senha of ['Abc1234', '  abc  ']) {
      const erro = await esperarRecusa(
        recuperar(EMAIL_GESTAO, senha),
        `${VARIAVEL_SENHA_TEMPORARIA}: A senha deve ter no mínimo 8 caracteres.`,
      );
      expect(erro.message).not.toContain(senha.trim());
    }
    esperarNadaAlterado();
  });

  it('recusa senha com mais de 72 bytes em UTF-8, mesmo com menos de 72 caracteres', async () => {
    const senha = 'á'.repeat(37); // 37 caracteres, 74 bytes
    const erro = await esperarRecusa(
      recuperar(EMAIL_GESTAO, senha),
      `${VARIAVEL_SENHA_TEMPORARIA}: A senha deve ter no máximo 72 bytes (letras acentuadas contam 2 bytes).`,
    );

    expect(erro.message).not.toContain(senha);
    await esperarRecusa(
      recuperar(EMAIL_GESTAO, 'a'.repeat(73)),
      `${VARIAVEL_SENHA_TEMPORARIA}: A senha deve ter no máximo 72 bytes (letras acentuadas contam 2 bytes).`,
    );
    esperarNadaAlterado();
  });

  it('confere o perfil de novo dentro da transação (perfil alterado depois da pré-checagem)', async () => {
    gerarHash.mockImplementationOnce(async (senha) => {
      buscar(ID_GESTAO).perfil = 'PROFESSOR'; // alteração concorrente fictícia
      return gerarHashSenha(senha);
    });

    await esperarRecusa(recuperar(EMAIL_GESTAO), MENSAGEM_USUARIO_NAO_GESTAO);
    expect(buscar(ID_GESTAO).senha_hash).toBe(hashInicial);
    expect(logs).toHaveLength(0);
  });

  it('repete a transação em conflito serializável (P2034) e conclui', async () => {
    const original = $transaction.getMockImplementation();
    $transaction
      .mockImplementationOnce(async () => {
        throw erroPrisma('P2034');
      })
      .mockImplementationOnce(async () => {
        throw erroPrisma('P2034');
      })
      .mockImplementation(original);

    await expect(recuperar(EMAIL_GESTAO)).resolves.toEqual({ usuarioId: ID_GESTAO, reativado: false });
    expect($transaction).toHaveBeenCalledTimes(3);
    expect(logs).toHaveLength(1);
  });

  it('desiste com mensagem clara após 3 conflitos seguidos', async () => {
    $transaction.mockImplementation(async () => {
      throw erroPrisma('P2034');
    });

    await esperarRecusa(recuperar(EMAIL_GESTAO), MENSAGEM_CONFLITO);
    expect($transaction).toHaveBeenCalledTimes(3);
    esperarNadaAlterado();
  });

  it('conflito detectado no COMMIT (DriverAdapterError "TransactionWriteConflict") também é repetido (Issue #129)', async () => {
    // Formato medido no PostgreSQL real (Prisma 7.10 + adapter-pg): sem `code`.
    const conflitoNoCommit = () =>
      Object.assign(new Error('TransactionWriteConflict'), {
        name: 'DriverAdapterError',
        cause: { originalCode: '40001', kind: 'TransactionWriteConflict' },
      });
    const original = $transaction.getMockImplementation();
    $transaction
      .mockImplementationOnce(async () => {
        throw conflitoNoCommit();
      })
      .mockImplementation(original);

    await expect(recuperar(EMAIL_GESTAO)).resolves.toEqual({ usuarioId: ID_GESTAO, reativado: false });
    expect($transaction).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(1);
  });

  it('conflito no COMMIT 3 vezes seguidas: mesma recusa clara do P2034', async () => {
    $transaction.mockImplementation(async () => {
      throw Object.assign(new Error('TransactionWriteConflict'), {
        name: 'DriverAdapterError',
        cause: { originalCode: '40P01', kind: 'TransactionWriteConflict' },
      });
    });

    await esperarRecusa(recuperar(EMAIL_GESTAO), MENSAGEM_CONFLITO);
    expect($transaction).toHaveBeenCalledTimes(3);
    esperarNadaAlterado();
  });

  it('se a gravação da auditoria falhar, nada é gravado (mesma transação)', async () => {
    criarLog.mockImplementationOnce(async () => {
      throw new Error('falha fictícia ao gravar o log');
    });

    await expect(recuperar(EMAIL_GESTAO_BLOQUEADA)).rejects.toThrow('falha fictícia');
    esperarNadaAlterado();
  });
});

// ---------------------------------------------------------------------------
// RN12 / RN10 — efeito na API (Supertest)
// ---------------------------------------------------------------------------

describe('efeito na API — sessões encerradas (RN12) e troca obrigatória (RN10)', () => {
  function login(email, senha) {
    return request(app).post('/auth/login').send({ email, senha });
  }

  function listarUsuarios(token) {
    return request(app).get('/usuarios').set('Authorization', `Bearer ${token}`);
  }

  it('o token emitido antes da execução deixa de valer (401), inclusive no mesmo segundo', async () => {
    const resLogin = await login(EMAIL_GESTAO, SENHA_INICIAL);
    expect(resLogin.status).toBe(200);
    const tokenAntigo = resLogin.body.token;
    expect((await listarUsuarios(tokenAntigo)).status).toBe(200);

    await recuperar(EMAIL_GESTAO);

    const res = await listarUsuarios(tokenAntigo);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
  });

  it('depois da execução, a senha antiga não entra; a temporária entra com troca obrigatória (403 nas demais rotas)', async () => {
    await recuperar(EMAIL_GESTAO);

    expect((await login(EMAIL_GESTAO, SENHA_INICIAL)).status).toBe(401);

    const resLogin = await login(EMAIL_GESTAO, SENHA_TEMPORARIA);
    expect(resLogin.status).toBe(200);
    expect(resLogin.body.trocaSenhaObrigatoria).toBe(true);

    const res = await listarUsuarios(resLogin.body.token);
    expect(res.status).toBe(403);
    expect(res.body.erro).toBe(MENSAGEM_TROCA_SENHA_OBRIGATORIA);
  });

  it('a Gestão bloqueada, sem acesso antes, volta a entrar depois da recuperação (RN07, RN09)', async () => {
    expect((await login(EMAIL_GESTAO_BLOQUEADA, SENHA_INICIAL)).status).toBe(401);

    await recuperar(EMAIL_GESTAO_BLOQUEADA);

    const resLogin = await login(EMAIL_GESTAO_BLOQUEADA, SENHA_TEMPORARIA);
    expect(resLogin.status).toBe(200);
    expect(resLogin.body.trocaSenhaObrigatoria).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Argumentos da linha de comando
// ---------------------------------------------------------------------------

describe('lerEmailDosArgumentos', () => {
  it.each([
    [['--email', EMAIL_GESTAO]],
    [[`--email=${EMAIL_GESTAO}`]],
    [['--email', `  ${EMAIL_GESTAO.toUpperCase()} `]],
  ])('lê e normaliza o e-mail de %j', (args) => {
    expect(lerEmailDosArgumentos(args)).toBe(EMAIL_GESTAO);
  });

  it('recusa --email ausente', () => {
    expect(() => lerEmailDosArgumentos([])).toThrow(MENSAGEM_EMAIL_AUSENTE);
  });

  it.each([
    ['--email sem valor', ['--email']],
    ['senha por argumento', ['--email', EMAIL_GESTAO, '--senha', 'SenhaPorArgumento1']],
    ['senha por argumento com =', [`--email=${EMAIL_GESTAO}`, '--senha=SenhaPorArgumento1']],
    ['argumento solto', ['--email', EMAIL_GESTAO, 'SenhaPorArgumento1']],
  ])('recusa %s sem repetir o valor', (_caso, args) => {
    let erro;
    try {
      lerEmailDosArgumentos(args);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroRecuperacaoGestao);
    expect(erro.message).toBe(MENSAGEM_ARGUMENTOS_INVALIDOS);
    expect(erro.message).not.toContain('SenhaPorArgumento1');
  });
});

// ---------------------------------------------------------------------------
// executarRecuperacaoGestao — ponto de entrada (saída e código de saída)
// ---------------------------------------------------------------------------

describe('executarRecuperacaoGestao', () => {
  function executar({ args = ['--email', EMAIL_GESTAO], env } = {}) {
    const saida = [];
    const erros = [];
    const criarCliente = vi.fn(() => db);
    const resultado = executarRecuperacaoGestao({
      args,
      env: env ?? { DATABASE_URL: URL_FICTICIA, [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
      criarCliente,
      escrever: (t) => saida.push(t),
      escreverErro: (t) => erros.push(t),
      deps: { gerarHash },
    });
    return resultado.then((codigo) => ({ codigo, saida, erros, criarCliente }));
  }

  function esperarSemSegredos(textos) {
    const tudo = textos.join('\n');
    expect(tudo).not.toContain(SENHA_TEMPORARIA);
    expect(tudo).not.toContain(EMAIL_GESTAO);
    expect(tudo).not.toContain(URL_FICTICIA);
    expect(tudo).not.toMatch(/postgresql:|\$2[aby]\$/);
  }

  it('sucesso: código 0, mostra só o id e fecha a conexão', async () => {
    const { codigo, saida, erros, criarCliente } = await executar();

    expect(codigo).toBe(0);
    expect(erros).toEqual([]);
    expect(criarCliente).toHaveBeenCalledWith(URL_FICTICIA);
    expect(saida.join('\n')).toContain(`id ${ID_GESTAO}`);
    expect(saida.join('\n')).not.toMatch(/reativado/);
    esperarSemSegredos(saida);
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('sucesso com reativação: avisa que o usuário foi reativado', async () => {
    const { codigo, saida } = await executar({ args: ['--email', EMAIL_GESTAO_BLOQUEADA] });

    expect(codigo).toBe(0);
    expect(saida.join('\n')).toContain('reativado (status ATIVO)');
    expect(saida.join('\n')).not.toContain(EMAIL_GESTAO_BLOQUEADA);
  });

  it('sem a variável da senha: código 1, mensagem clara e não abre conexão', async () => {
    const { codigo, saida, erros, criarCliente } = await executar({
      env: { DATABASE_URL: URL_FICTICIA },
    });

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([`Recuperação recusada — nada foi alterado. ${MENSAGEM_SENHA_AUSENTE}`]);
    expect(criarCliente).not.toHaveBeenCalled();
    esperarNadaAlterado();
  });

  it('sem --email: código 1 e não abre conexão', async () => {
    const { codigo, erros, criarCliente } = await executar({ args: [] });

    expect(codigo).toBe(1);
    expect(erros[0]).toContain(MENSAGEM_EMAIL_AUSENTE);
    expect(criarCliente).not.toHaveBeenCalled();
  });

  it('senha por argumento: código 1, recusa sem repetir o valor', async () => {
    const { codigo, erros } = await executar({
      args: ['--email', EMAIL_GESTAO, '--senha', 'SenhaPorArgumento1'],
    });

    expect(codigo).toBe(1);
    expect(erros[0]).toContain(MENSAGEM_ARGUMENTOS_INVALIDOS);
    expect(erros.join('\n')).not.toContain('SenhaPorArgumento1');
    esperarNadaAlterado();
  });

  it('senha curta: código 1, sem mostrar a senha', async () => {
    const { codigo, erros } = await executar({
      env: { DATABASE_URL: URL_FICTICIA, [VARIAVEL_SENHA_TEMPORARIA]: 'Curta12' },
    });

    expect(codigo).toBe(1);
    expect(erros[0]).toContain('no mínimo 8 caracteres');
    expect(erros.join('\n')).not.toContain('Curta12');
  });

  it('sem DATABASE_URL: código 1 com mensagem clara', async () => {
    const { codigo, erros, criarCliente } = await executar({
      env: { [VARIAVEL_SENHA_TEMPORARIA]: SENHA_TEMPORARIA },
    });

    expect(codigo).toBe(1);
    expect(erros[0]).toContain(MENSAGEM_DATABASE_URL_AUSENTE);
    expect(criarCliente).not.toHaveBeenCalled();
  });

  it.each([
    ['e-mail inexistente', ['--email', 'inexistente@sisto.exemplo'], MENSAGEM_USUARIO_NAO_ENCONTRADO],
    ['usuário sem perfil Gestão', ['--email', EMAIL_PROFESSOR], MENSAGEM_USUARIO_NAO_GESTAO],
  ])('%s: código 1, mensagem clara e conexão fechada', async (_caso, args, mensagem) => {
    const { codigo, erros } = await executar({ args });

    expect(codigo).toBe(1);
    expect(erros).toEqual([`Recuperação recusada — nada foi alterado. ${mensagem}`]);
    expect(erros.join('\n')).not.toContain(args[1]);
    expect(db.$disconnect).toHaveBeenCalledTimes(1);
    esperarNadaAlterado();
  });

  it('falha do banco: código 1 com mensagem genérica, sem detalhes internos', async () => {
    findUnique.mockRejectedValueOnce(
      new Error(`Can't reach database server at ${URL_FICTICIA} (senha_ficticia)`),
    );

    const { codigo, erros } = await executar();

    expect(codigo).toBe(1);
    // Falha inesperada: não afirma que nada foi alterado (pode ter sido no COMMIT).
    expect(erros).toEqual([MENSAGEM_FALHA_BANCO]);
    expect(erros[0]).not.toContain('nada foi alterado');
    expect(erros[0]).toContain('confira o resultado antes de executar de novo');
    expect(erros.join('\n')).not.toMatch(/senha_ficticia|localhost/);
    esperarSemSegredos(erros);
  });

  it('falha ao confirmar a transação (COMMIT): mensagem genérica, sem "nada foi alterado"', async () => {
    // Simula o banco gravando tudo e a conexão caindo na resposta do COMMIT.
    const original = $transaction.getMockImplementation();
    $transaction.mockImplementationOnce(async (fn, opcoes) => {
      await original(fn, opcoes);
      throw new Error('Connection terminated unexpectedly (fictício)');
    });

    const { codigo, saida, erros } = await executar();

    expect(codigo).toBe(1);
    expect(saida).toEqual([]);
    expect(erros).toEqual([MENSAGEM_FALHA_BANCO]);
    esperarSemSegredos(erros);
  });

  it('sem DATABASE_URL: orienta a definir a variável no terminal, não no .env', () => {
    expect(MENSAGEM_DATABASE_URL_AUSENTE).toContain('no próprio terminal');
    expect(MENSAGEM_DATABASE_URL_AUSENTE).toContain('não lê o .env');
    expect(MENSAGEM_DATABASE_URL_AUSENTE).toContain('docs/deploy.md');
  });

  it('a mensagem de uso mostra --silent e aponta o npm.cmd/docs/deploy.md para o PowerShell', () => {
    expect(MENSAGEM_EMAIL_AUSENTE).toContain('npm run --silent recuperar-gestao -- --email');
    expect(MENSAGEM_EMAIL_AUSENTE).toContain('npm.cmd');
    expect(MENSAGEM_EMAIL_AUSENTE).toContain('docs/deploy.md');
  });
});
