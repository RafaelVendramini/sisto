// Testes da Issue #153 (Story #152, SSD 1.18) no cadastro de usuários: o
// perfil PSICOLOGO no POST/PUT /usuarios, fora da contagem da RN11, e a
// mudança de perfil de um psicólogo destinatário de encaminhamentos (não é
// recusada — RN24; só valem as RN13 e RN23). A recusa da RN23 para PSICOLOGO e
// a ordem RN13 → RN23 estão em usuarios-rn23.test.js. Somente dados
// fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória de usuários e ocorrências (mesmo padrão de usuarios-rn23.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  estudanteCount: vi.fn(),
  ocorrenciaCount: vi.fn(),
  $transaction: vi.fn(),
  criarLog: vi.fn(),
}));
const { findUnique, create, update, count, estudanteCount, ocorrenciaCount, $transaction, criarLog } =
  mocks;

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: mocks.findUnique, create: mocks.create, update: mocks.update, count: mocks.count },
    estudante: { count: mocks.estudanteCount },
    ocorrencia: { count: mocks.ocorrenciaCount },
    logAuditoria: { create: mocks.criarLog },
    $transaction: mocks.$transaction,
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_MINIMO_GESTOES_ATIVAS, MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS, PERFIS_VALIDOS } =
  await import('../src/services/usuarios.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_GESTAO = 1;
const ID_GESTAO_2 = 2;
const ID_PSI = 3; // psicólogo destinatário de encaminhamentos
const ID_TUTOR_RESPONSAVEL = 4;

let banco;
/** Ocorrências fictícias: só id, status e responsavel_acompanhamento_id. */
let ocorrencias;

function usuario(id, nome, perfil, extra = {}) {
  return {
    id,
    nome,
    email: `usuario.${id}@sisto.exemplo`,
    senha_hash: '$2b$04$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234',
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
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

const buscar = (id) => banco.find((u) => u.id === id);

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = [
    usuario(ID_GESTAO, 'Gestao Ficticia', 'GESTAO'),
    usuario(ID_GESTAO_2, 'Gestao Ficticia Dois', 'GESTAO'),
    usuario(ID_PSI, 'Psicologo Ficticio', 'PSICOLOGO'),
    usuario(ID_TUTOR_RESPONSAVEL, 'Tutor Responsavel Ficticio', 'TUTOR'),
  ];
  ocorrencias = [
    { id: 1, status: 'EM_ACOMPANHAMENTO', responsavel_acompanhamento_id: ID_TUTOR_RESPONSAVEL },
  ];

  findUnique.mockReset();
  findUnique.mockImplementation(async ({ where, select }) => {
    const encontrado = banco.find((u) =>
      where.id !== undefined ? u.id === where.id : u.email === where.email,
    );
    return encontrado ? selecionar(encontrado, select) : null;
  });

  create.mockReset();
  create.mockImplementation(async ({ data, select }) => {
    const registro = { id: Math.max(...banco.map((u) => u.id)) + 1, senha_alterada_em: null, ...data };
    banco.push(registro);
    return selecionar(registro, select);
  });

  update.mockReset();
  update.mockImplementation(async ({ where, data, select }) => {
    const registro = buscar(where.id);
    Object.assign(registro, data);
    return selecionar(registro, select);
  });

  // RN11: Gestões ativas sem troca de senha pendente, exceto o próprio usuário.
  count.mockReset();
  count.mockImplementation(
    async ({ where }) =>
      banco.filter(
        (u) =>
          u.perfil === where.perfil &&
          u.status === where.status &&
          u.troca_senha_obrigatoria === where.troca_senha_obrigatoria &&
          u.id !== where.id?.not,
      ).length,
  );

  estudanteCount.mockReset();
  estudanteCount.mockResolvedValue(0);

  ocorrenciaCount.mockReset();
  ocorrenciaCount.mockImplementation(
    async ({ where }) =>
      ocorrencias.filter(
        (o) =>
          o.responsavel_acompanhamento_id === where.responsavel_acompanhamento_id &&
          o.status !== where.status?.not,
      ).length,
  );

  criarLog.mockReset();
  criarLog.mockResolvedValue({ id: 1 });

  $transaction.mockReset();
  $transaction.mockImplementation(async (fn) =>
    fn({
      usuario: { findUnique, create, update, count },
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

const put = (id, corpo, autor = ID_GESTAO) =>
  request(app).put(`/usuarios/${id}`).set('Authorization', `Bearer ${tokenDe(autor)}`).send(corpo);

describe('Perfil PSICOLOGO no cadastro (RF01, SSD 1.18)', () => {
  it('PSICOLOGO é um perfil válido', () => {
    expect(PERFIS_VALIDOS).toContain('PSICOLOGO');
  });

  it('POST /usuarios aceita perfil PSICOLOGO (201, ATIVO e com troca de senha obrigatória)', async () => {
    const res = await request(app)
      .post('/usuarios')
      .set('Authorization', `Bearer ${tokenDe(ID_GESTAO)}`)
      .send({
        nome: 'Psicóloga Fictícia',
        email: 'psicologa.ficticia@sisto.exemplo',
        perfil: 'PSICOLOGO',
        senha: 'SenhaTemporaria1',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ perfil: 'PSICOLOGO', status: 'ATIVO' });
    expect(banco.at(-1)).toMatchObject({ perfil: 'PSICOLOGO', troca_senha_obrigatoria: true });
  });

  it('PUT /usuarios/{id} aceita mudar para PSICOLOGO quem não é responsável por ocorrências (200)', async () => {
    banco.push(usuario(10, 'Professor Ficticio', 'PROFESSOR'));

    const res = await put(10, { perfil: 'PSICOLOGO' });

    expect(res.status).toBe(200);
    expect(res.body.perfil).toBe('PSICOLOGO');
  });

  it('PUT /usuarios/{id} para PSICOLOGO do responsável por ocorrência não encerrada: 409 RESPONSAVEL_COM_OCORRENCIAS', async () => {
    const res = await put(ID_TUTOR_RESPONSAVEL, { perfil: 'PSICOLOGO' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS,
      codigo: CODIGOS_ERRO.RESPONSAVEL_COM_OCORRENCIAS,
    });
    expect(MENSAGEM_RESPONSAVEL_COM_OCORRENCIAS).toContain('Psicólogo escolar');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('RN13 — Tutor com tutorados para PSICOLOGO (QA)', () => {
  it('Tutor só com tutorados (sem ser responsável por ocorrências): 409 TUTOR_COM_TUTORADOS, nada gravado', async () => {
    banco.push(usuario(30, 'Tutor Com Tutorados Ficticio', 'TUTOR'));
    estudanteCount.mockResolvedValue(2);

    const res = await put(30, { perfil: 'PSICOLOGO' });

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe(CODIGOS_ERRO.TUTOR_COM_TUTORADOS);
    expect(update).not.toHaveBeenCalled();
    expect(buscar(30).perfil).toBe('TUTOR');
  });
});

describe('RN11 — o psicólogo não conta como Gestão ativa', () => {
  it('com duas Gestões ativas e um psicólogo, desativar uma Gestão continua recusado (409 GESTAO_ATIVA_MINIMA)', async () => {
    banco.push(usuario(20, 'Gestao Ficticia Tres', 'GESTAO', { troca_senha_obrigatoria: true }));

    const res = await put(ID_GESTAO_2, { status: 'DESATIVADO' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: MENSAGEM_MINIMO_GESTOES_ATIVAS,
      codigo: CODIGOS_ERRO.GESTAO_ATIVA_MINIMA,
    });
    expect(buscar(ID_GESTAO_2).status).toBe('ATIVO');
  });

  it('rebaixar a Gestão a PSICOLOGO também é recusado pela RN11', async () => {
    const res = await put(ID_GESTAO_2, { perfil: 'PSICOLOGO' });

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe(CODIGOS_ERRO.GESTAO_ATIVA_MINIMA);
  });
});

describe('RN24 — a mudança de perfil do psicólogo destinatário não é recusada', () => {
  it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'GESTAO', 'TECNICO_ADMINISTRATIVO'])(
    'PSICOLOGO destinatário de encaminhamentos para %s: 200',
    async (novoPerfil) => {
      const res = await put(ID_PSI, { perfil: novoPerfil });

      expect(res.status).toBe(200);
      expect(res.body.perfil).toBe(novoPerfil);
      // Nenhuma checagem de encaminhamentos: só a RN23 (quando o novo perfil
      // não pode acompanhar) consulta ocorrências.
      expect(estudanteCount).not.toHaveBeenCalled();
    },
  );

  it('desativar e reativar o psicólogo é aceito (200)', async () => {
    expect((await put(ID_PSI, { status: 'DESATIVADO' })).status).toBe(200);
    const res = await put(ID_PSI, { status: 'ATIVO' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ATIVO');
  });
});
