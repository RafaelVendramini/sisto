// Testes da RN23 (Issue #134; SSD 1.13, Seção 6, RF04 e Seção 12): o
// PUT /usuarios/{id} recusa com 409 e codigo RESPONSAVEL_COM_OCORRENCIAS a
// mudança de perfil para PROFESSOR ou TECNICO_ADMINISTRATIVO de um usuário que
// é o responsável pelo acompanhamento (responsavel_acompanhamento_id) de ao
// menos uma ocorrência não encerrada. A RN13 (TUTOR_COM_TUTORADOS) é
// verificada antes. Somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória (usuários, estudantes e ocorrências).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  estudanteCount: vi.fn(),
  ocorrenciaCount: vi.fn(),
  $transaction: vi.fn(),
  criarLog: vi.fn(),
}));
const { findUnique, update, count, estudanteCount, ocorrenciaCount, $transaction, criarLog } =
  mocks;

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.findUnique, update: mocks.update, count: mocks.count },
    estudante: { count: mocks.estudanteCount },
    ocorrencia: { count: mocks.ocorrenciaCount },
    logAuditoria: { create: mocks.criarLog },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const {
  MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS,
  MENSAGEM_TUTOR_COM_TUTORADOS,
  MENSAGEM_MINIMO_GESTOES_ATIVAS,
  MENSAGEM_CONFLITO_CONCORRENTE,
  PERFIS_SEM_ACOMPANHAMENTO,
} = await import('../src/services/usuarios.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';

// Quem faz as requisições (Gestão) e as outras Gestões ativas (RN11).
const ID_GESTAO = 1;
const ID_GESTAO_2 = 2;
// Responsáveis pelo acompanhamento (perfis que podem sê-lo — RN15).
const ID_TUTOR_RESPONSAVEL = 10;
const ID_PEDAGOGICO_RESPONSAVEL = 11;
const ID_GESTAO_RESPONSAVEL = 12;
// Tutor com estudantes vinculados E responsável por ocorrência em acompanhamento.
const ID_TUTOR_COM_TUDO = 13;
// Responsável só por ocorrências encerradas.
const ID_TUTOR_SO_ENCERRADAS = 14;
// Tutor sem tutorados e sem ocorrências.
const ID_TUTOR_LIVRE = 15;
// Responsável que já é Professor (dado legado fictício): reenviar o perfil não é mudança.
const ID_PROFESSOR = 16;
// Responsável por ocorrência ABERTO (status diferente de ENCERRADO também conta).
const ID_TUTOR_OCORRENCIA_ABERTA = 17;

const RESPONSAVEIS_EM_ACOMPANHAMENTO = [
  ['TUTOR', ID_TUTOR_RESPONSAVEL],
  ['PEDAGOGICO', ID_PEDAGOGICO_RESPONSAVEL],
  ['GESTAO', ID_GESTAO_RESPONSAVEL],
];

let banco;
/** Estudantes fictícios: só id e tutor_id. */
let estudantes;
/** Ocorrências fictícias: só id, status e responsavel_acompanhamento_id. */
let ocorrencias;

function usuario(id, nome, perfil, status = 'ATIVO') {
  return {
    id,
    nome,
    email: `usuario.${id}@sisto.exemplo`,
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status,
    troca_senha_obrigatoria: false,
  };
}

function selecionar(registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, incluir]) => incluir)
      .map(([campo]) => [campo, registro[campo]]),
  );
}

function buscar(id) {
  return banco.find((u) => u.id === id);
}

/** Interpreta o `where` usado pela RN23: responsável + status { not }. */
function contarOcorrencias({ where }) {
  return ocorrencias.filter((o) => {
    if (o.responsavel_acompanhamento_id !== where.responsavel_acompanhamento_id) return false;
    if (where.status?.not !== undefined && o.status === where.status.not) return false;
    return true;
  }).length;
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuario(ID_GESTAO, 'Gestao Ficticia', 'GESTAO'),
    usuario(ID_GESTAO_2, 'Gestao Ficticia Dois', 'GESTAO'),
    usuario(ID_TUTOR_RESPONSAVEL, 'Tutor Responsavel Ficticio', 'TUTOR'),
    usuario(ID_PEDAGOGICO_RESPONSAVEL, 'Pedagogica Responsavel Ficticia', 'PEDAGOGICO'),
    usuario(ID_GESTAO_RESPONSAVEL, 'Gestao Responsavel Ficticia', 'GESTAO'),
    usuario(ID_TUTOR_COM_TUDO, 'Tutora Com Tutorados Ficticia', 'TUTOR'),
    usuario(ID_TUTOR_SO_ENCERRADAS, 'Tutor Encerradas Ficticio', 'TUTOR'),
    usuario(ID_TUTOR_LIVRE, 'Tutor Livre Ficticio', 'TUTOR'),
    usuario(ID_PROFESSOR, 'Professor Ficticio', 'PROFESSOR'),
    usuario(ID_TUTOR_OCORRENCIA_ABERTA, 'Tutor Aberta Ficticio', 'TUTOR'),
  ];
  estudantes = [{ id: 1, tutor_id: ID_TUTOR_COM_TUDO }];
  ocorrencias = [
    { id: 1, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_TUTOR_RESPONSAVEL },
    { id: 2, status: 'ENCERRADO', responsavel_acompanhamento_id: ID_TUTOR_RESPONSAVEL },
    { id: 3, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_PEDAGOGICO_RESPONSAVEL },
    { id: 4, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_GESTAO_RESPONSAVEL },
    { id: 5, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_TUTOR_COM_TUDO },
    { id: 6, status: 'ENCERRADO', responsavel_acompanhamento_id: ID_TUTOR_SO_ENCERRADAS },
    { id: 7, status: 'ENCERRADO', responsavel_acompanhamento_id: ID_TUTOR_SO_ENCERRADAS },
    { id: 8, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_PROFESSOR },
    { id: 9, status: 'ABERTO', responsavel_acompanhamento_id: ID_TUTOR_OCORRENCIA_ABERTA },
    { id: 10, status: 'ABERTO', responsavel_acompanhamento_id: null },
  ];

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
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

  ocorrenciaCount.mockReset();
  ocorrenciaCount.mockImplementation(async (args) => contarOcorrencias(args));

  criarLog.mockReset();
  criarLog.mockResolvedValue({ id: 1 });

  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({
      usuario: { findUnique, update, count },
      estudante: { count: estudanteCount },
      ocorrencia: { count: ocorrenciaCount },
      logAuditoria: { create: criarLog },
    }),
  );
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function tokenDe(id) {
  return jwt.sign({ id, perfil: buscar(id).perfil }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
}

function put(id, corpo, token = tokenDe(ID_GESTAO)) {
  return request(app).put(`/usuarios/${id}`).set('Authorization', `Bearer ${token}`).send(corpo);
}

function esperarErro(res, status, mensagem, codigo) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.body).toEqual({ erro: mensagem, codigo });
}

function esperarRn23(res) {
  esperarErro(
    res,
    409,
    MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS,
    CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS,
  );
}

// ---------------------------------------------------------------------------

describe('RN23 — catálogo, perfis e mensagem', () => {
  it('o código RESPONSAVEL_COM_OCORRENCIAS está no catálogo', () => {
    expect(CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS).toBe('RESPONSAVEL_COM_OCORRENCIAS');
  });

  it('só PROFESSOR e TECNICO_ADMINISTRATIVO são os perfis recusados', () => {
    expect([...PERFIS_SEM_ACOMPANHAMENTO].sort()).toEqual(['PROFESSOR', 'TECNICO_ADMINISTRATIVO']);
    expect(Object.isFrozen(PERFIS_SEM_ACOMPANHAMENTO)).toBe(true);
  });

  it('a mensagem orienta a trocar o responsável antes de mudar o perfil', () => {
    expect(MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS).toMatch(/respons[áa]vel pelo acompanhamento/);
    expect(MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS).toMatch(/Troque o respons[áa]vel/);
    expect(MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS).toMatch(/antes de alterar o perfil/);
    // Sem dados de estudantes nem identificadores de ocorrências (RNF06).
    expect(MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS).not.toMatch(/estudante|\d/i);
  });
});

describe('PUT /usuarios/{id} — RN23 recusa (409)', () => {
  for (const [perfilAtual, id] of RESPONSAVEIS_EM_ACOMPANHAMENTO) {
    it.each(['PROFESSOR', 'TECNICO_ADMINISTRATIVO'])(
      `${perfilAtual} responsável por ocorrência EM_ACOMPANHAMENTO para %s: 409 e nada é gravado`,
      async (novoPerfil) => {
        const res = await put(id, { perfil: novoPerfil });

        esperarRn23(res);
        expect(update).not.toHaveBeenCalled();
        expect(criarLog).not.toHaveBeenCalled();
        expect(buscar(id).perfil).toBe(perfilAtual);
      },
    );
  }

  it('ocorrência ABERTO com responsável também impede (status diferente de ENCERRADO)', async () => {
    esperarRn23(await put(ID_TUTOR_OCORRENCIA_ABERTA, { perfil: 'PROFESSOR' }));
  });

  it('a mudança de perfil junto com outros campos é recusada por inteiro', async () => {
    const res = await put(ID_TUTOR_RESPONSAVEL, {
      nome: 'Nome Novo Ficticio',
      perfil: 'TECNICO_ADMINISTRATIVO',
      status: 'BLOQUEADO',
    });

    esperarRn23(res);
    expect(buscar(ID_TUTOR_RESPONSAVEL)).toMatchObject({
      nome: 'Tutor Responsavel Ficticio',
      perfil: 'TUTOR',
      status: 'ATIVO',
    });
  });

  it('a contagem roda dentro da transação SERIALIZABLE e ignora as encerradas', async () => {
    await put(ID_TUTOR_RESPONSAVEL, { perfil: 'PROFESSOR' });

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(ocorrenciaCount).toHaveBeenCalledWith({
      where: { responsavel_acompanhamento_id: ID_TUTOR_RESPONSAVEL, status: { not: 'ENCERRADO' } },
    });
  });

  it('a Gestão responsável é recusada pela RN23 antes da RN11 (mínimo de Gestões)', async () => {
    // Sem a Gestão 2, rebaixar a Gestão responsável também violaria a RN11.
    buscar(ID_GESTAO_2).status = 'BLOQUEADO';

    const res = await put(ID_GESTAO_RESPONSAVEL, { perfil: 'PROFESSOR' });

    esperarRn23(res);
    expect(res.body.erro).not.toBe(MENSAGEM_MINIMO_GESTOES_ATIVAS);
  });

  it('P2034 (encaminhamento simultâneo) é repetido e então esbarra na RN23', async () => {
    // 1ª tentativa aborta como se um encaminhamento tivesse definido este
    // usuário como responsável ao mesmo tempo.
    $transaction.mockImplementationOnce(async () => {
      const erro = new Error('Transaction failed due to a write conflict or a deadlock.');
      erro.code = 'P2034';
      throw erro;
    });
    ocorrencias.push({ id: 11, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_TUTOR_LIVRE });

    const res = await put(ID_TUTOR_LIVRE, { perfil: 'PROFESSOR' });

    esperarRn23(res);
    expect($transaction).toHaveBeenCalledTimes(2);
  });

  it('P2034 em todas as tentativas: 409 CONFLITO_CONCORRENTE', async () => {
    $transaction.mockImplementation(async () => {
      const erro = new Error('Transaction failed due to a write conflict or a deadlock.');
      erro.code = 'P2034';
      throw erro;
    });

    const res = await put(ID_TUTOR_RESPONSAVEL, { perfil: 'PROFESSOR' });

    esperarErro(res, 409, MENSAGEM_CONFLITO_CONCORRENTE, CODIGOS_ERRO.CONFLITO_CONCORRENTE);
  });
});

describe('PUT /usuarios/{id} — ordem RN13 → RN23', () => {
  it.each(['PROFESSOR', 'TECNICO_ADMINISTRATIVO'])(
    'Tutor com tutorados e responsável por ocorrência, para %s: 409 TUTOR_COM_TUTORADOS (RN13 primeiro)',
    async (novoPerfil) => {
      const res = await put(ID_TUTOR_COM_TUDO, { perfil: novoPerfil });

      esperarErro(res, 409, MENSAGEM_TUTOR_COM_TUTORADOS, CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
      // A RN23 nem chega a ser consultada.
      expect(ocorrenciaCount).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('depois de desvincular os estudantes, a mesma edição esbarra na RN23', async () => {
    estudantes = [];

    esperarRn23(await put(ID_TUTOR_COM_TUDO, { perfil: 'PROFESSOR' }));
  });

  it('depois de trocar também o responsável, a edição é aceita (200)', async () => {
    estudantes = [];
    ocorrencias.find((o) => o.id === 5).responsavel_acompanhamento_id = ID_PEDAGOGICO_RESPONSAVEL;

    const res = await put(ID_TUTOR_COM_TUDO, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe('PROFESSOR');
  });
});

describe('PUT /usuarios/{id} — o que a RN23 não recusa (200)', () => {
  it.each([
    ['TUTOR', ID_TUTOR_RESPONSAVEL, 'PEDAGOGICO'],
    ['TUTOR', ID_TUTOR_RESPONSAVEL, 'GESTAO'],
    ['PEDAGOGICO', ID_PEDAGOGICO_RESPONSAVEL, 'TUTOR'],
    ['PEDAGOGICO', ID_PEDAGOGICO_RESPONSAVEL, 'GESTAO'],
    ['GESTAO', ID_GESTAO_RESPONSAVEL, 'TUTOR'],
    ['GESTAO', ID_GESTAO_RESPONSAVEL, 'PEDAGOGICO'],
  ])('responsável %s (id %i) para %s: 200 sem consultar ocorrências', async (_atual, id, novo) => {
    const res = await put(id, { perfil: novo });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe(novo);
    expect(ocorrenciaCount).not.toHaveBeenCalled();
    // O responsável das ocorrências não muda.
    expect(ocorrencias.filter((o) => o.responsavel_acompanhamento_id === id).length).toBeGreaterThan(0);
  });

  it.each([
    ['nome', { nome: 'Tutor Renomeado Ficticio' }],
    ['e-mail', { email: 'tutor.novo@sisto.exemplo' }],
    ['bloqueio', { status: 'BLOQUEADO' }],
    ['desativação', { status: 'DESATIVADO' }],
    ['reenvio do perfil atual (TUTOR)', { perfil: 'TUTOR' }],
  ])('responsável: alterar %s sem mudar o perfil é permitido (200)', async (_c, corpo) => {
    const res = await put(ID_TUTOR_RESPONSAVEL, corpo);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(corpo);
    expect(ocorrenciaCount).not.toHaveBeenCalled();
  });

  it('reenviar PROFESSOR para quem já é Professor não é mudança de perfil (200)', async () => {
    const res = await put(ID_PROFESSOR, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(200);
    expect(ocorrenciaCount).not.toHaveBeenCalled();
  });

  it.each(['PROFESSOR', 'TECNICO_ADMINISTRATIVO'])(
    'responsável só por ocorrências ENCERRADO para %s: 200 (o responsável gravado é mantido)',
    async (novoPerfil) => {
      const res = await put(ID_TUTOR_SO_ENCERRADAS, { perfil: novoPerfil });

      expect(res.status).toBe(200);
      expect(res.body.perfil).toBe(novoPerfil);
      expect(ocorrenciaCount).toHaveBeenCalledTimes(1);
      expect(
        ocorrencias.filter((o) => o.responsavel_acompanhamento_id === ID_TUTOR_SO_ENCERRADAS),
      ).toHaveLength(2);
    },
  );

  it('usuário sem nenhuma ocorrência para PROFESSOR: 200', async () => {
    const res = await put(ID_TUTOR_LIVRE, { perfil: 'PROFESSOR' });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe('PROFESSOR');
  });

  it('depois que a Gestão troca o responsável (novo encaminhamento), a mudança é aceita (200)', async () => {
    esperarRn23(await put(ID_TUTOR_RESPONSAVEL, { perfil: 'TECNICO_ADMINISTRATIVO' }));

    // O encaminhamento (RN15) define outro responsável para a ocorrência em
    // acompanhamento; a encerrada mantém o responsável gravado.
    ocorrencias.find((o) => o.id === 1).responsavel_acompanhamento_id = ID_PEDAGOGICO_RESPONSAVEL;

    const res = await put(ID_TUTOR_RESPONSAVEL, { perfil: 'TECNICO_ADMINISTRATIVO' });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe('TECNICO_ADMINISTRATIVO');
    expect(ocorrencias.find((o) => o.id === 2).responsavel_acompanhamento_id).toBe(
      ID_TUTOR_RESPONSAVEL,
    );
    expect(criarLog).toHaveBeenCalledTimes(1);
  });
});
