// Testes da Issue #91 — auditoria do cadastro e da edição de usuários
// (RNF04, RNF06, RF01, RF04). Somente dados fictícios (RN05).
// - POST /usuarios grava "usuário criado"; PUT /usuarios/{id} (inclusive
//   bloqueio, desativação e reativação) grava "usuário editado"; recurso
//   "usuarios/<id>" e usuario_id da Gestão logada.
// - Operações recusadas (400, 401, 403, 404, 409) não gravam auditoria.
// - acao/recurso sem e-mail, nome, perfil, senha, hash ou token.
// - Falha na gravação da auditoria desfaz a alteração (mesma transação).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória cujo $transaction desfaz as gravações quando o callback falha, como
// o PostgreSQL faria com o ROLLBACK.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  estudanteCount: vi.fn(),
  criarLogTx: vi.fn(),
  criarLogForaDaTransacao: vi.fn(),
  $transaction: vi.fn(),
}));
const {
  findUnique,
  findMany,
  create,
  update,
  count,
  estudanteCount,
  criarLogTx,
  criarLogForaDaTransacao,
  $transaction,
} = mocks;

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
      create: mocks.create,
      update: mocks.update,
      count: mocks.count,
    },
    estudante: { count: mocks.estudanteCount },
    // Fora da transação: se a auditoria fosse gravada aqui, os testes falhariam.
    logAuditoria: { create: mocks.criarLogForaDaTransacao },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  MENSAGEM_EMAIL_DUPLICADO,
  MENSAGEM_USUARIO_NAO_ENCONTRADO,
  MENSAGEM_ALTERAR_PROPRIO_ACESSO,
  MENSAGEM_MINIMO_GESTOES_ATIVAS,
  MENSAGEM_TUTOR_COM_TUTORADOS,
  RECURSO_USUARIOS,
  atualizarUsuario,
  cadastrarUsuario,
} = await import('../src/services/usuarios.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const SENHA_TEMPORARIA = 'Temporaria123';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const ID_TUTOR = 2; // usuário-base TUTOR
const ID_GESTAO = 3; // usuário-base GESTAO
const ID_GESTAO_2 = 7; // segunda Gestão ativa (RN11)
const ID_GESTAO_3 = 8; // terceira Gestão ativa (permite bloquear uma Gestão)
const ID_ALVO = 6; // professor fictício editado nos testes
const EMAIL_ALVO = 'docente.alvo@sisto.exemplo';
const NOME_ALVO = 'Docente Alvo Ficticio';
const HASH_FICTICIO = '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234';

/** "Banco" em memória. */
let banco;
let logs;
let estudantes;
let proximoId;

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function erroPrisma(code, mensagem) {
  const erro = new Error(mensagem);
  erro.code = code;
  return erro;
}

function usuarioBase(id, perfil, extra = {}) {
  return {
    id,
    nome: `Usuário ${perfil} Exemplo ${id}`,
    email: `${perfil.toLowerCase()}.${id}@sisto.exemplo`,
    senha_hash: HASH_FICTICIO,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    ...extra,
  };
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

/** Client da transação: o mesmo "banco", mas com o logAuditoria da transação. */
const clienteTransacao = {
  usuario: { findUnique, findMany, create, update, count },
  estudante: { count: estudanteCount },
  logAuditoria: { create: criarLogTx },
};

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = PERFIS.map((perfil, i) => usuarioBase(i + 1, perfil));
  banco.push(usuarioBase(ID_ALVO, 'PROFESSOR', { nome: NOME_ALVO, email: EMAIL_ALVO }));
  banco.push(usuarioBase(ID_GESTAO_2, 'GESTAO'));
  banco.push(usuarioBase(ID_GESTAO_3, 'GESTAO'));
  proximoId = 100;
  logs = [];
  estudantes = [];

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  create.mockReset();
  create.mockImplementation(async ({ data, select }) => {
    if (banco.some((u) => u.email === data.email)) {
      throw erroPrisma('P2002', 'Unique constraint failed on the fields: (`email`)');
    }
    const registro = { id: proximoId++, ...data };
    banco.push(registro);
    return selecionar(registro, select);
  });

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    if (!registro) throw erroPrisma('P2025', 'Record to update not found.');
    if (data.email !== undefined && banco.some((u) => u.email === data.email && u.id !== where.id)) {
      throw erroPrisma('P2002', 'Unique constraint failed on the fields: (`email`)');
    }
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  count.mockReset();
  count.mockImplementation(
    async ({ where }) =>
      banco.filter(
        (u) => u.perfil === where.perfil && u.status === where.status && u.id !== where.id?.not,
      ).length,
  );

  estudanteCount.mockReset();
  estudanteCount.mockImplementation(
    async ({ where }) => estudantes.filter((e) => e.tutor_id === where.tutor_id).length,
  );

  findMany.mockReset();

  criarLogTx.mockReset();
  criarLogTx.mockImplementation(async ({ data }) => {
    const registro = { id: logs.length + 1, ...data };
    logs.push(registro);
    return { id: registro.id };
  });

  criarLogForaDaTransacao.mockReset();
  criarLogForaDaTransacao.mockRejectedValue(new Error('LogAuditoria gravado fora da transação'));

  // ROLLBACK simulado: se o callback falhar, o banco e os logs voltam ao
  // estado anterior à transação.
  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) => {
    const bancoAntes = structuredClone(banco);
    const logsAntes = structuredClone(logs);
    try {
      return await fn(clienteTransacao);
    } catch (erro) {
      banco = bancoAntes;
      logs = logsAntes;
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDe(id) {
  const usuario = buscar(id);
  return jwt.sign({ id, perfil: usuario.perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

function post(corpo, token = tokenDe(ID_GESTAO)) {
  const req = request(app).post('/usuarios');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(corpo);
}

function put(id, corpo, token = tokenDe(ID_GESTAO)) {
  const req = request(app).put(`/usuarios/${id}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(corpo);
}

function corpoCadastro(extra = {}) {
  return {
    nome: 'Docente Novo Ficticio',
    email: 'docente.novo@sisto.exemplo',
    perfil: 'PROFESSOR',
    senha: SENHA_TEMPORARIA,
    ...extra,
  };
}

function esperarLogUnico(acao, recurso, usuarioId = ID_GESTAO) {
  expect(logs).toHaveLength(1);
  expect(logs[0]).toEqual({ id: 1, usuario_id: usuarioId, acao, recurso });
  expect(criarLogForaDaTransacao).not.toHaveBeenCalled();
}

describe('POST /usuarios — auditoria "usuário criado" (#91)', () => {
  it('grava "usuário criado" com recurso usuarios/<id> e a Gestão que cadastrou', async () => {
    const res = await post(corpoCadastro());

    expect(res.status).toBe(201);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_CRIADO, `usuarios/${res.body.id}`);
    expect(ACOES_AUDITORIA.USUARIO_CRIADO).toBe('usuário criado');
  });

  it('usuario_id é o da Gestão logada (outra Gestão)', async () => {
    const res = await post(corpoCadastro(), tokenDe(ID_GESTAO_2));

    expect(res.status).toBe(201);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_CRIADO, `usuarios/${res.body.id}`, ID_GESTAO_2);
  });

  it('o create e o log rodam na mesma transação, nessa ordem', async () => {
    await post(corpoCadastro());

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(criarLogTx).toHaveBeenCalledTimes(1);
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      criarLogTx.mock.invocationCallOrder[0],
    );
  });

  it('cada cadastro gera o seu próprio registro', async () => {
    const r1 = await post(corpoCadastro({ email: 'primeiro.novo@sisto.exemplo' }));
    const r2 = await post(corpoCadastro({ email: 'segundo.novo@sisto.exemplo' }));

    expect(logs.map((l) => l.recurso)).toEqual([`usuarios/${r1.body.id}`, `usuarios/${r2.body.id}`]);
  });
});

describe('PUT /usuarios/{id} — auditoria "usuário editado" (#91)', () => {
  it.each([
    ['nome', { nome: 'Docente Renomeado' }],
    ['e-mail', { email: 'docente.renomeado@sisto.exemplo' }],
    ['perfil', { perfil: 'PEDAGOGICO' }],
    ['bloqueio', { status: 'BLOQUEADO' }],
    ['desativação', { status: 'DESATIVADO' }],
    ['vários campos', { nome: 'Outro Nome', perfil: 'TUTOR', status: 'ATIVO' }],
  ])('%s grava "usuário editado"', async (_caso, corpo) => {
    const res = await put(ID_ALVO, corpo);

    expect(res.status).toBe(200);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_ALVO}`);
    expect(ACOES_AUDITORIA.USUARIO_EDITADO).toBe('usuário editado');
  });

  it.each(['BLOQUEADO', 'DESATIVADO'])('reativação de usuário %s grava "usuário editado"', async (status) => {
    buscar(ID_ALVO).status = status;

    const res = await put(ID_ALVO, { status: 'ATIVO' });

    expect(res.status).toBe(200);
    expect(buscar(ID_ALVO).status).toBe('ATIVO');
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_ALVO}`);
  });

  it('bloqueio de uma Gestão (com outras duas ativas) grava "usuário editado"', async () => {
    const res = await put(ID_GESTAO_3, { status: 'BLOQUEADO' });

    expect(res.status).toBe(200);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_GESTAO_3}`);
  });

  it('a Gestão editando o próprio nome grava o próprio id nos dois campos', async () => {
    const res = await put(ID_GESTAO, { nome: 'Gestão Renomeada' });

    expect(res.status).toBe(200);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_GESTAO}`);
  });

  it('usuario_id é o da Gestão logada (outra Gestão)', async () => {
    const res = await put(ID_ALVO, { status: 'BLOQUEADO' }, tokenDe(ID_GESTAO_2));

    expect(res.status).toBe(200);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_ALVO}`, ID_GESTAO_2);
  });

  it('o update e o log rodam na mesma transação serializável', async () => {
    await put(ID_ALVO, { nome: 'Docente Renomeado' });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(criarLogTx.mock.invocationCallOrder[0]);
  });

  it('conflito de serialização repetido grava um único log', async () => {
    $transaction.mockImplementationOnce(async () => {
      throw erroPrisma('P2034', 'Transaction failed due to a write conflict or a deadlock.');
    });

    const res = await put(ID_ALVO, { nome: 'Docente Renomeado' });

    expect(res.status).toBe(200);
    esperarLogUnico(ACOES_AUDITORIA.USUARIO_EDITADO, `usuarios/${ID_ALVO}`);
  });
});

describe('Operações recusadas não gravam auditoria (#91)', () => {
  function esperarSemLog() {
    expect(logs).toEqual([]);
    expect(criarLogTx).not.toHaveBeenCalled();
    expect(criarLogForaDaTransacao).not.toHaveBeenCalled();
  }

  describe('POST /usuarios', () => {
    it('400: corpo inválido', async () => {
      expect((await post({ nome: 'Só Nome' })).status).toBe(400);
      expect((await post(corpoCadastro({ perfil: 'DIRETOR' }))).status).toBe(400);
      expect((await post(corpoCadastro({ senha: 'curta' }))).status).toBe(400);
      esperarSemLog();
    });

    it('401: sem token', async () => {
      expect((await post(corpoCadastro(), null)).status).toBe(401);
      esperarSemLog();
    });

    it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      '403: perfil %s',
      async (perfil) => {
        const id = banco.find((u) => u.perfil === perfil).id;
        expect((await post(corpoCadastro(), tokenDe(id))).status).toBe(403);
        esperarSemLog();
      },
    );

    it('409: e-mail já cadastrado (pré-checagem)', async () => {
      const res = await post(corpoCadastro({ email: EMAIL_ALVO }));

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO });
      esperarSemLog();
    });

    it('409: e-mail cadastrado por outra requisição ao mesmo tempo (P2002 no create)', async () => {
      // A pré-checagem não vê o e-mail; o create esbarra no índice único.
      findUnique.mockImplementationOnce(async ({ where, select }) =>
        selecionar(buscar(where.id), select),
      );
      findUnique.mockImplementationOnce(async () => null);
      create.mockImplementationOnce(async () => {
        throw erroPrisma('P2002', 'Unique constraint failed on the fields: (`email`)');
      });

      const res = await post(corpoCadastro());

      expect(res.status).toBe(409);
      esperarSemLog();
    });
  });

  describe('PUT /usuarios/{id}', () => {
    it('400: id ou corpo inválido', async () => {
      expect((await put('abc', { nome: 'Nome Qualquer' })).status).toBe(400);
      expect((await put(ID_ALVO, {})).status).toBe(400);
      expect((await put(ID_ALVO, { status: 'SUSPENSO' })).status).toBe(400);
      esperarSemLog();
    });

    it('401: sem token', async () => {
      expect((await put(ID_ALVO, { status: 'BLOQUEADO' }, null)).status).toBe(401);
      esperarSemLog();
    });

    it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      '403: perfil %s',
      async (perfil) => {
        const id = banco.find((u) => u.perfil === perfil).id;
        expect((await put(ID_ALVO, { status: 'BLOQUEADO' }, tokenDe(id))).status).toBe(403);
        esperarSemLog();
      },
    );

    it('404: usuário inexistente', async () => {
      const res = await put(9999, { nome: 'Nome Qualquer' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: MENSAGEM_USUARIO_NAO_ENCONTRADO });
      esperarSemLog();
    });

    it('404: usuário removido entre a leitura e o update (P2025)', async () => {
      update.mockImplementationOnce(async () => {
        throw erroPrisma('P2025', 'Record to update not found.');
      });

      expect((await put(ID_ALVO, { nome: 'Nome Qualquer' })).status).toBe(404);
      esperarSemLog();
    });

    it('409: e-mail de outro usuário', async () => {
      const res = await put(ID_ALVO, { email: buscar(ID_GESTAO).email });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_EMAIL_DUPLICADO });
      esperarSemLog();
    });

    it('409: Gestão bloqueando a si mesma', async () => {
      const res = await put(ID_GESTAO, { status: 'BLOQUEADO' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_ALTERAR_PROPRIO_ACESSO });
      esperarSemLog();
    });

    it('409: RN11 — ficariam menos de duas Gestões ativas', async () => {
      buscar(ID_GESTAO_3).status = 'DESATIVADO';

      const res = await put(ID_GESTAO_2, { status: 'BLOQUEADO' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_MINIMO_GESTOES_ATIVAS });
      expect(buscar(ID_GESTAO_2).status).toBe('ATIVO');
      esperarSemLog();
    });

    it('409: RN13 — Tutor com estudantes vinculados não muda de perfil', async () => {
      estudantes.push({ id: 1, tutor_id: ID_TUTOR });

      const res = await put(ID_TUTOR, { perfil: 'PROFESSOR' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ erro: MENSAGEM_TUTOR_COM_TUTORADOS });
      esperarSemLog();
    });

    it('409: conflito de serialização em todas as tentativas', async () => {
      $transaction.mockImplementation(async () => {
        throw erroPrisma('P2034', 'Transaction failed due to a write conflict or a deadlock.');
      });

      expect((await put(ID_ALVO, { nome: 'Nome Qualquer' })).status).toBe(409);
      esperarSemLog();
    });
  });
});

describe('Nenhum registro de auditoria contém dados pessoais (#91, RNF06)', () => {
  it('acao e recurso só com textos fixos e ids numéricos após cadastro e edições', async () => {
    const novo = corpoCadastro({
      nome: 'Pessoa Ficticia Auditada',
      email: 'pessoa.auditada@sisto.exemplo',
      perfil: 'TECNICO_ADMINISTRATIVO',
      senha: 'SenhaSecreta987',
    });
    const tokenGestao = tokenDe(ID_GESTAO);

    const criado = await post(novo, tokenGestao);
    expect(criado.status).toBe(201);
    const id = criado.body.id;

    const edicoes = [
      { nome: 'Pessoa Ficticia Renomeada' },
      { email: 'pessoa.renomeada@sisto.exemplo' },
      { perfil: 'PEDAGOGICO' },
      { status: 'BLOQUEADO' },
      { status: 'DESATIVADO' },
      { status: 'ATIVO' },
    ];
    for (const corpo of edicoes) {
      expect((await put(id, corpo, tokenGestao)).status).toBe(200);
    }

    expect(logs).toHaveLength(1 + edicoes.length);

    const proibidos = [
      novo.nome,
      novo.email,
      novo.senha,
      'Pessoa Ficticia Renomeada',
      'pessoa.renomeada@sisto.exemplo',
      'pessoa',
      'sisto.exemplo',
      '@',
      HASH_FICTICIO,
      '$2b$',
      tokenGestao,
      'Bearer',
      ...PERFIS,
      ...PERFIS.map((p) => p.toLowerCase()),
      'ATIVO',
      'BLOQUEADO',
      'DESATIVADO',
    ];
    const acoesPermitidas = [ACOES_AUDITORIA.USUARIO_CRIADO, ACOES_AUDITORIA.USUARIO_EDITADO];

    for (const log of logs) {
      // Só as colunas da Seção 11 preenchidas pela API (data_hora vem do banco).
      expect(Object.keys(log).sort()).toEqual(['acao', 'id', 'recurso', 'usuario_id']);
      expect(acoesPermitidas).toContain(log.acao);
      expect(log.recurso).toBe(`${RECURSO_USUARIOS}/${id}`);
      expect(log.recurso).toMatch(/^usuarios\/\d+$/);
      expect(log.usuario_id).toBe(ID_GESTAO);
      const texto = `${log.acao} ${log.recurso}`;
      for (const proibido of proibidos) {
        expect(texto).not.toContain(proibido);
      }
    }

    // O hash gravado no usuário (criado com a senha real) também não aparece.
    const hashCriado = buscar(id).senha_hash;
    expect(JSON.stringify(logs)).not.toContain(hashCriado);
  });

  it('as constantes novas são textos fixos sem dados pessoais', () => {
    expect(ACOES_AUDITORIA.USUARIO_CRIADO).toBe('usuário criado');
    expect(ACOES_AUDITORIA.USUARIO_EDITADO).toBe('usuário editado');
    expect(Object.isFrozen(ACOES_AUDITORIA)).toBe(true);
  });
});

describe('Falha simulada na auditoria desfaz a operação (#91)', () => {
  beforeEach(() => {
    criarLogTx.mockReset();
    criarLogTx.mockRejectedValue(new Error('falha simulada ao gravar o LogAuditoria'));
  });

  it('POST /usuarios: 500 e o usuário não fica cadastrado', async () => {
    const quantidadeAntes = banco.length;

    const res = await post(corpoCadastro());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(banco).toHaveLength(quantidadeAntes);
    expect(banco.some((u) => u.email === 'docente.novo@sisto.exemplo')).toBe(false);
    expect(logs).toEqual([]);

    // Sem o resíduo do cadastro desfeito, o mesmo e-mail pode ser cadastrado depois.
    criarLogTx.mockReset();
    criarLogTx.mockImplementation(async ({ data }) => {
      logs.push({ id: logs.length + 1, ...data });
      return { id: logs.length };
    });
    expect((await post(corpoCadastro())).status).toBe(201);
    expect(logs).toHaveLength(1);
  });

  it.each([
    ['nome', { nome: 'Docente Renomeado' }],
    ['e-mail', { email: 'docente.renomeado@sisto.exemplo' }],
    ['perfil', { perfil: 'PEDAGOGICO' }],
    ['bloqueio', { status: 'BLOQUEADO' }],
    ['desativação', { status: 'DESATIVADO' }],
  ])('PUT /usuarios/{id} (%s): 500 e o usuário fica como estava', async (_caso, corpo) => {
    const antes = structuredClone(buscar(ID_ALVO));

    const res = await put(ID_ALVO, corpo);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ erro: 'Erro interno do servidor' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(buscar(ID_ALVO)).toEqual(antes);
    expect(logs).toEqual([]);
  });

  it('PUT /usuarios/{id} (reativação): 500 e o usuário continua bloqueado', async () => {
    buscar(ID_ALVO).status = 'BLOQUEADO';

    const res = await put(ID_ALVO, { status: 'ATIVO' });

    expect(res.status).toBe(500);
    expect(buscar(ID_ALVO).status).toBe('BLOQUEADO');
    expect(logs).toEqual([]);
  });

  it('service: o erro da auditoria é propagado (não é engolido nem convertido)', async () => {
    await expect(
      cadastrarUsuario(corpoCadastro(), { id: ID_GESTAO }, { gerarHash: async () => HASH_FICTICIO }),
    ).rejects.toThrow('falha simulada ao gravar o LogAuditoria');
    await expect(
      atualizarUsuario(String(ID_ALVO), { nome: 'Docente Renomeado' }, { id: ID_GESTAO, perfil: 'GESTAO' }),
    ).rejects.toThrow('falha simulada ao gravar o LogAuditoria');
    expect(buscar(ID_ALVO).nome).toBe(NOME_ALVO);
    expect(banco.some((u) => u.email === 'docente.novo@sisto.exemplo')).toBe(false);
  });
});
