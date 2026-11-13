// QA da Issue #83 — complementa ocorrencias-historico.test.js (GET
// /ocorrencias/{id}/historico) nas lacunas encontradas na revisão:
// - usuário DESATIVADO (RN07/RN09) recebe 401, como o bloqueado;
// - o perfil e a visibilidade vêm do BANCO, não do token (RN01/RN19);
// - a consulta de visibilidade é exatamente { AND: [{ id }, filtroVisibilidadeOcorrencias] }
//   para os 5 perfis (a mesma regra do detalhe);
// - autor do registro desativado ou bloqueado continua no histórico com id e
//   nome, sem status (RN07);
// - a rota é só de leitura: POST/PUT/PATCH/DELETE respondem 404, sem banco.
// Somente dados fictícios (RN05). Não depende do banco: src/lib/prisma.js é
// substituído por mocks simples.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  usuarioFindUnique: vi.fn(),
  $transaction: vi.fn(),
  ocorrenciaFindFirst: vi.fn(),
  historicoFindMany: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: {
    usuario: { findUnique: (...a) => mocks.usuarioFindUnique(...a) },
    $transaction: (...a) => mocks.$transaction(...a),
  },
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_HISTORICO, MENSAGEM_OCORRENCIA_NAO_ENCONTRADA, filtroVisibilidadeOcorrencias } =
  await import('../src/services/ocorrencias.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

/** Usuários fictícios do "banco" (só o que a sessão lê). */
let usuariosBanco;

function usuarioBanco(id, perfil, extra = {}) {
  return {
    id,
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  };
}

function token(id, perfil) {
  return jwt.sign({ id, perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  usuariosBanco = new Map();
  mocks.usuarioFindUnique.mockReset();
  mocks.usuarioFindUnique.mockImplementation(async ({ where }) => usuariosBanco.get(where.id) ?? null);
  mocks.ocorrenciaFindFirst.mockReset();
  mocks.historicoFindMany.mockReset();
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) =>
    operacao({
      ocorrencia: { findFirst: mocks.ocorrenciaFindFirst },
      historicoOcorrencia: { findMany: mocks.historicoFindMany },
    }),
  );
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

describe('QA #83 — sessão e perfil vindos do banco', () => {
  it('usuário DESATIVADO (RN07/RN09) recebe 401, sem abrir transação', async () => {
    usuariosBanco.set(10, usuarioBanco(10, 'GESTAO', { status: 'DESATIVADO' }));
    const res = await request(app)
      .get('/ocorrencias/1/historico')
      .set('Authorization', `Bearer ${token(10, 'GESTAO')}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('token com perfil GESTAO de quem hoje é PROFESSOR no banco: vale o filtro do Professor (RN01/RN19)', async () => {
    usuariosBanco.set(11, usuarioBanco(11, 'PROFESSOR'));
    mocks.ocorrenciaFindFirst.mockResolvedValue(null); // fora da visibilidade do Professor
    const res = await request(app)
      .get('/ocorrencias/5/historico')
      .set('Authorization', `Bearer ${token(11, 'GESTAO')}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(mocks.ocorrenciaFindFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 5 }, filtroVisibilidadeOcorrencias({ id: 11, perfil: 'PROFESSOR' })] },
      select: { id: true },
    });
    expect(mocks.historicoFindMany).not.toHaveBeenCalled();
  });
});

describe('QA #83 — a visibilidade usa filtroVisibilidadeOcorrencias (mesma regra do detalhe)', () => {
  for (const [indice, perfil] of PERFIS.entries()) {
    it(`${perfil}: consulta de visibilidade = { AND: [{ id }, filtro do perfil] } e histórico só da ocorrência pedida`, async () => {
      const id = 20 + indice;
      usuariosBanco.set(id, usuarioBanco(id, perfil));
      mocks.ocorrenciaFindFirst.mockResolvedValue({ id: 7 });
      mocks.historicoFindMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/ocorrencias/7/historico')
        .set('Authorization', `Bearer ${token(id, perfil)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      const { where } = mocks.ocorrenciaFindFirst.mock.calls[0][0];
      expect(where).toEqual({ AND: [{ id: 7 }, filtroVisibilidadeOcorrencias({ id, perfil })] });
      // Gestão e Pedagógico: filtro vazio; demais perfis: OR com o próprio id.
      if (['GESTAO', 'PEDAGOGICO'].includes(perfil)) expect(where.AND[1]).toEqual({});
      else expect(JSON.stringify(where.AND[1])).toContain(`"profissional_responsavel_id":${id}`);
      expect(mocks.historicoFindMany.mock.calls[0][0].where).toEqual({ ocorrencia_id: 7 });
    });
  }
});

describe('QA #83 — autor do registro desativado ou bloqueado (RN07)', () => {
  it('continua no histórico com id e nome; status, e-mail e perfil do autor não aparecem', async () => {
    usuariosBanco.set(30, usuarioBanco(30, 'GESTAO'));
    mocks.ocorrenciaFindFirst.mockResolvedValue({ id: 3 });
    // O mock devolve MAIS campos do que o select pede, para provar que a
    // resposta só leva id e nome do usuário.
    mocks.historicoFindMany.mockResolvedValue([
      {
        id: 1,
        acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA,
        descricao: null,
        data_hora: new Date('2026-10-01T10:05:00.000Z'),
        usuario: { id: 40, nome: 'Usuário Fictício Desativado', email: 'desativado@sisto.exemplo', perfil: 'PROFESSOR', status: 'DESATIVADO' },
      },
      {
        id: 2,
        acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
        descricao: null,
        data_hora: new Date('2026-10-02T10:05:00.000Z'),
        usuario: { id: 41, nome: 'Usuário Fictício Bloqueado', email: 'bloqueado@sisto.exemplo', perfil: 'TUTOR', status: 'BLOQUEADO' },
      },
    ]);

    const res = await request(app)
      .get('/ocorrencias/3/historico')
      .set('Authorization', `Bearer ${token(30, 'GESTAO')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA, descricao: null, dataHora: '2026-10-01T10:05:00.000Z', usuario: { id: 40, nome: 'Usuário Fictício Desativado' } },
      { id: 2, acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA, descricao: null, dataHora: '2026-10-02T10:05:00.000Z', usuario: { id: 41, nome: 'Usuário Fictício Bloqueado' } },
    ]);
    // A consulta não filtra o autor pelo status (o histórico é mantido — RN07).
    const { where, select } = mocks.historicoFindMany.mock.calls[0][0];
    expect(where).toEqual({ ocorrencia_id: 3 });
    expect(select.usuario).toEqual({ select: { id: true, nome: true } });
  });
});

describe('QA #83 — a rota de histórico é só de leitura', () => {
  for (const metodo of ['post', 'put', 'patch', 'delete']) {
    it(`${metodo.toUpperCase()} /ocorrencias/1/historico responde 404, sem tocar no histórico`, async () => {
      usuariosBanco.set(50, usuarioBanco(50, 'GESTAO'));
      const res = await request(app)
        [metodo]('/ocorrencias/1/historico')
        .set('Authorization', `Bearer ${token(50, 'GESTAO')}`)
        .send({ acao: 'ação fictícia', descricao: 'Descrição fictícia.' });
      expect(res.status).toBe(404);
      expect(mocks.$transaction).not.toHaveBeenCalled();
      expect(mocks.historicoFindMany).not.toHaveBeenCalled();
    });
  }
});
