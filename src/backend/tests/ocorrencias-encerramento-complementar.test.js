// Testes complementares (QA) de PATCH /ocorrencias/{id}/status — encerramento
// (Issue #82, RN04, RN08, RN15, RN17, RN19, RN22, RNF04) — somente dados
// fictícios (RN05).
// Reaproveitam o mesmo "banco" em memória de ocorrencias-encerramento.test.js
// (avalia o `where` gerado pelo service; a transação faz rollback na falha) e
// cobrem bordas não exercitadas lá: fluxo completo pela API (encaminhamento ->
// providência -> encerramento) com o histórico das duas mudanças de status,
// troca de responsável antes do encerramento, perfil e status do usuário lidos
// do banco (não do JWT), corpo não JSON/urlencoded/__proto__, outros métodos
// na rota e data de encerramento recalculada a cada tentativa da transação.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { OPERACOES_ESCRITA, criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

/** Momento fictício preenchido pelo "banco" (@default(now())). */
const AGORA_BANCO = new Date('2026-10-28T13:00:00.000Z');

const DEFAULTS = {
  encaminhamento: () => ({ data_hora: AGORA_BANCO, observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: AGORA_BANCO }),
  providencia: () => ({ data_hora: AGORA_BANCO }),
  logAuditoria: () => ({ data_hora: AGORA_BANCO }),
};

/** Operações de escrita feitas na transação ("modelo.operacao"), em ordem. */
let escritas;

// Motor do "banco" em memória: tests/apoio/bancoEmMemoria.js (Issue #129).
const { clientMock } = criarBancoEmMemoria({
  obterBanco: () => banco,
  padroes: DEFAULTS,
  limiteRelacoes: 2,
  aoOperar: (modelo, operacao) => {
    if (OPERACOES_ESCRITA.includes(operacao)) escritas.push(`${modelo}.${operacao}`);
  },
});

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') return (...a) => mocks.$transaction(...a);
        return clientMock()[prop];
      },
    },
  ),
}));

const { default: app } = await import('../src/app.js');
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA, MENSAGEM_PERFIL_SEM_PERMISSAO } = await import(
  '../src/middlewares/autenticacao.js'
);
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const { ACOES_AUDITORIA } = await import('../src/services/auditoria.js');
const {
  ACOES_HISTORICO,
  DESCRICAO_HISTORICO_ACOMPANHAMENTO_PARA_ENCERRADO,
  MENSAGEM_CONFLITO_CONCORRENTE_ENCERRAMENTO,
  MENSAGEM_CORPO_STATUS_INVALIDO,
  MENSAGEM_ENCERRAMENTO_SEM_PERMISSAO,
  MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ABERTA_ENCERRAMENTO,
  MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO,
  MENSAGEM_OCORRENCIA_ENCERRADA_ENCAMINHAMENTO,
  MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_JA_ENCERRADA,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_STATUS_INVALIDO,
  MENSAGEM_STATUS_SOMENTE_ENCERRADO,
  PERFIS_ENCERRAMENTO,
  encerrarOcorrencia,
  validarAlteracaoStatus,
} = await import('../src/services/ocorrencias.js');

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_TROCA_PENDENTE = 6; // GESTAO com troca de senha pendente
const ID_TUTOR_2 = 7;
const ID_INEXISTENTE = 999;

// O ID_TUTOR NÃO vê as ocorrências 1, 2 e 9. Vê a 3 a 8, cada uma por UMA
// condição da RN19; só é o responsável pelo acompanhamento da 3 e da 6.
const O_ABERTA = 1; // registrada pelo Professor, sem vínculo com o ID_TUTOR
const O_ACOMPANHAMENTO = 2; // registrada pelo Professor; responsável: ID_TUTOR_2; com providência
const O_ENCERRADA = 3; // responsável: ID_TUTOR (ele a vê por ser o responsável)
const O_TUTOR_REGISTROU = 4; // ABERTO, profissional responsável: ID_TUTOR
const O_TUTOR_DESTINATARIO = 5; // EM_ACOMPANHAMENTO, encaminhada ao ID_TUTOR; responsável: ID_GESTAO; com providência
const O_TUTOR_RESPONSAVEL = 6; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR; com providência
const O_TUTOR_TUTORADO = 7; // EM_ACOMPANHAMENTO, envolve tutorado do ID_TUTOR; responsável: ID_PEDAGOGICO; com providência
const O_ENCERRADA_TUTORADO = 8; // ENCERRADO, envolve tutorado do ID_TUTOR; responsável: ID_TUTOR_2
const O_SEM_PROVIDENCIA = 9; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR_2; SEM providência

const data = (iso) => new Date(iso);
const DATA_ENCERRAMENTO_ANTIGA = data('2026-10-20T10:00:00.000Z');

function montarBanco() {
  const usuario = (id, perfil, extra = {}) => ({
    id,
    nome: `Usuário Fictício ${id}`,
    email: `usuario${id}@sisto.exemplo`,
    senha_hash: 'hash-ficticio',
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });
  const ocorrencia = (id, status, extra = {}) => ({
    id,
    data_hora: data(`2026-10-0${id}T10:00:00.000Z`),
    local: `Local fictício ${id}`,
    turma_id: 1,
    categoria_id: 1,
    descricao: `Descrição fictícia ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: ID_PROFESSOR,
    responsavel_acompanhamento_id: null,
    status,
    data_encerramento: null,
    ...extra,
  });
  const encaminhamento = (id, ocorrenciaId, perfil, usuarioId = null) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: usuarioId,
    registrado_por_id: ID_PROFESSOR,
    data_hora: data(`2026-10-0${ocorrenciaId}T10:05:00.000Z`),
    observacao: null,
  });
  const providencia = (id, ocorrenciaId) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    descricao: `Providência fictícia ${id}.`,
    registrado_por_id: ID_PEDAGOGICO,
    data_hora: data(`2026-10-0${ocorrenciaId}T12:00:00.000Z`),
  });
  const encerrada = { data_encerramento: DATA_ENCERRAMENTO_ANTIGA };

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_2, 'TUTOR'),
    ],
    turmas: [{ id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Indisciplina', descricao: null }],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O_ABERTA, 'ABERTO'),
      ocorrencia(O_ACOMPANHAMENTO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR_2 }),
      ocorrencia(O_ENCERRADA, 'ENCERRADO', { responsavel_acompanhamento_id: ID_TUTOR, ...encerrada }),
      ocorrencia(O_TUTOR_REGISTROU, 'ABERTO', { profissional_responsavel_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_DESTINATARIO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_GESTAO }),
      ocorrencia(O_TUTOR_RESPONSAVEL, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O_TUTOR_TUTORADO, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_PEDAGOGICO }),
      ocorrencia(O_ENCERRADA_TUTORADO, 'ENCERRADO', { responsavel_acompanhamento_id: ID_TUTOR_2, ...encerrada }),
      ocorrencia(O_SEM_PROVIDENCIA, 'EM_ACOMPANHAMENTO', { responsavel_acompanhamento_id: ID_TUTOR_2 }),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O_ABERTA, estudante_id: 2 },
      { ocorrencia_id: O_ACOMPANHAMENTO, estudante_id: 2 },
      { ocorrencia_id: O_ENCERRADA, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_REGISTROU, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_DESTINATARIO, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_RESPONSAVEL, estudante_id: 2 },
      { ocorrencia_id: O_TUTOR_TUTORADO, estudante_id: 1 },
      { ocorrencia_id: O_TUTOR_TUTORADO, estudante_id: 2 },
      { ocorrencia_id: O_ENCERRADA_TUTORADO, estudante_id: 1 },
      { ocorrencia_id: O_SEM_PROVIDENCIA, estudante_id: 2 },
    ],
    encaminhamentos: [
      encaminhamento(1, O_ABERTA, 'GESTAO'),
      encaminhamento(2, O_ACOMPANHAMENTO, 'TUTOR', ID_TUTOR_2),
      encaminhamento(3, O_ENCERRADA, 'GESTAO'),
      encaminhamento(4, O_TUTOR_REGISTROU, 'GESTAO'),
      encaminhamento(5, O_TUTOR_DESTINATARIO, 'TUTOR', ID_TUTOR),
      encaminhamento(6, O_TUTOR_RESPONSAVEL, 'GESTAO'),
      encaminhamento(7, O_TUTOR_TUTORADO, 'GESTAO'),
      encaminhamento(8, O_ENCERRADA_TUTORADO, 'GESTAO'),
      encaminhamento(9, O_SEM_PROVIDENCIA, 'GESTAO'),
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício anterior.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
      // Comunicação não conta como providência (RN04).
      { id: 2, ocorrencia_id: O_SEM_PROVIDENCIA, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
    ],
    providencias: [
      providencia(1, O_ACOMPANHAMENTO),
      providencia(2, O_ENCERRADA),
      providencia(3, O_TUTOR_DESTINATARIO),
      providencia(4, O_TUTOR_RESPONSAVEL),
      providencia(5, O_TUTOR_TUTORADO),
      providencia(6, O_ENCERRADA_TUTORADO),
    ],
    historicos: [],
    logs: [],
  };
}

let bancoInicial;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  bancoInicial = structuredClone(banco);
  escritas = [];
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => {
    const copia = structuredClone(banco);
    try {
      return await operacao(clientMock());
    } catch (erro) {
      banco = copia; // rollback
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const encerrar = (ocorrenciaId, corpo = CORPO, usuarioId = ID_GESTAO) => {
  const req = request(app).patch(`/ocorrencias/${ocorrenciaId}/status`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`).send(corpo) : req.send(corpo);
};
const getDetalhe = (id, usuarioId) =>
  request(app).get(`/ocorrencias/${id}`).set('Authorization', `Bearer ${token(usuarioId)}`);

const ocorrenciaNoBanco = (id) => banco.ocorrencias.find((o) => o.id === id);

/** Nada foi gravado (banco igual ao inicial). */
function esperarNadaGravado() {
  expect(banco).toEqual(bancoInicial);
}

function erroPrisma(code) {
  const erro = new Error(`Erro fictício do Prisma (${code})`);
  erro.code = code;
  return erro;
}

const CORPO = Object.freeze({ status: 'ENCERRADO' });

/** Espera 200 com a ocorrência encerrada agora (entre `antes` e o fim da chamada). */
async function encerrarComSucesso(ocorrenciaId, usuarioId = ID_GESTAO) {
  const antes = Date.now();
  const res = await encerrar(ocorrenciaId, CORPO, usuarioId);
  const depois = Date.now();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.id).toBe(ocorrenciaId);
  expect(res.body.status).toBe('ENCERRADO');
  const momento = new Date(res.body.dataEncerramento).getTime();
  expect(momento).toBeGreaterThanOrEqual(antes);
  expect(momento).toBeLessThanOrEqual(depois);
  return res;
}

const comAuth = (req, id = ID_GESTAO) => req.set('Authorization', `Bearer ${token(id)}`);

// ---------------------------------------------------------------------------
// Fluxo completo pela API (UC02 -> UC04): RN04, RN08, RN15, RN22
// ---------------------------------------------------------------------------
describe('complementar — fluxo completo aberto -> em acompanhamento -> encerrado', () => {
  it('encaminhar define o responsável; ele encerra só depois da providência; histórico tem as duas mudanças de status', async () => {
    // Ocorrência ABERTO que o ID_TUTOR não vê: antes do encaminhamento, 404.
    expect((await encerrar(O_ABERTA, CORPO, ID_TUTOR)).status).toBe(404);
    expect((await encerrar(O_ABERTA, CORPO, ID_GESTAO)).status).toBe(409);

    const enc = await comAuth(request(app).post(`/ocorrencias/${O_ABERTA}/encaminhamentos`)).send({
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR,
      responsavelAcompanhamentoId: ID_TUTOR,
    });
    expect(enc.status, JSON.stringify(enc.body)).toBe(201);
    expect(enc.body.status).toBe('EM_ACOMPANHAMENTO');

    // Responsável agora: sem providência -> 409 orientando a registrar.
    const semProv = await encerrar(O_ABERTA, CORPO, ID_TUTOR);
    expect(semProv.status).toBe(409);
    expect(semProv.body).toEqual({ erro: MENSAGEM_ENCERRAMENTO_SEM_PROVIDENCIA, codigo: CODIGOS_ERRO.ENCERRAMENTO_SEM_PROVIDENCIA });

    const prov = await comAuth(request(app).post(`/ocorrencias/${O_ABERTA}/providencias`), ID_TUTOR).send({
      descricao: 'Providência fictícia do tutor responsável.',
    });
    expect(prov.status, JSON.stringify(prov.body)).toBe(201);

    const res = await encerrarComSucesso(O_ABERTA, ID_TUTOR);
    expect(res.body.responsavelAcompanhamento).toMatchObject({ id: ID_TUTOR });

    const doStatus = banco.historicos
      .filter((h) => h.ocorrencia_id === O_ABERTA && h.acao === ACOES_HISTORICO.STATUS_ALTERADO)
      .map((h) => h.descricao);
    expect(doStatus).toEqual(['De aberto para em acompanhamento', 'De em acompanhamento para encerrado']);
    // O último registro do histórico é o do encerramento, feito pelo tutor.
    expect(banco.historicos.at(-1)).toMatchObject({
      ocorrencia_id: O_ABERTA,
      usuario_id: ID_TUTOR,
      acao: 'status alterado',
      descricao: DESCRICAO_HISTORICO_ACOMPANHAMENTO_PARA_ENCERRADO,
    });
    expect(banco.logs.filter((l) => l.acao === ACOES_AUDITORIA.OCORRENCIA_ENCERRADA)).toEqual([
      expect.objectContaining({ usuario_id: ID_TUTOR, recurso: `ocorrencias/${O_ABERTA}` }),
    ]);
  });

  it('depois que a Gestão troca o responsável, o tutor antigo sem outro vínculo recebe 404 e o novo encerra', async () => {
    // ID_TUTOR é o responsável da 6; a Gestão troca para o ID_TUTOR_2 e encaminha a ele.
    const enc = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/encaminhamentos`)).send({
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: ID_TUTOR_2,
      responsavelAcompanhamentoId: ID_TUTOR_2,
    });
    expect(enc.status, JSON.stringify(enc.body)).toBe(201);
    expect(enc.body.status).toBe('EM_ACOMPANHAMENTO');

    // O ID_TUTOR deixou de ser responsável e não tem outra condição da RN19 na 6 -> 404.
    const antigo = await encerrar(O_TUTOR_RESPONSAVEL, CORPO, ID_TUTOR);
    expect(antigo.status).toBe(404);

    await encerrarComSucesso(O_TUTOR_RESPONSAVEL, ID_TUTOR_2);
  });

  it('tutor antigo que continua vendo (tutora estudante envolvido) recebe 403 depois da troca de responsável', async () => {
    ocorrenciaNoBanco(O_TUTOR_TUTORADO).responsavel_acompanhamento_id = ID_TUTOR;
    const enc = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_TUTORADO}/encaminhamentos`)).send({
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      responsavelAcompanhamentoId: ID_PEDAGOGICO,
    });
    expect(enc.status, JSON.stringify(enc.body)).toBe(201);
    const depois = structuredClone(banco);
    const res = await encerrar(O_TUTOR_TUTORADO, CORPO, ID_TUTOR);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(banco).toEqual(depois);
  });

  it('comunicação depois do encerramento pelo Tutor responsável também é 409 (RN16)', async () => {
    await encerrarComSucesso(O_TUTOR_RESPONSAVEL, ID_TUTOR);
    const depois = structuredClone(banco);
    const com = await comAuth(request(app).post(`/ocorrencias/${O_TUTOR_RESPONSAVEL}/comunicacoes`), ID_TUTOR).send({
      destinatario: 'Família fictícia',
      meio: 'Telefone',
      descricao: 'Contato fictício após encerrar.',
      dataHora: '2026-10-10T10:00:00.000Z',
    });
    expect(com.status).toBe(409);
    expect(banco).toEqual(depois);
  });
});

// ---------------------------------------------------------------------------
// Perfil e status do usuário vêm do banco (RN01, RN09), não do JWT
// ---------------------------------------------------------------------------
describe('complementar — perfil e status lidos do banco', () => {
  it('JWT com perfil GESTAO de um usuário que no banco é PROFESSOR: 403 sem gravar', async () => {
    const forjado = jwt.sign({ id: ID_PROFESSOR, perfil: 'GESTAO' }, SEGREDO_TESTE, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', `Bearer ${forjado}`)
      .send(CORPO);
    expect(res.status).toBe(403);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('usuário Gestão que ficou INATIVO depois do login: 401 sem gravar', async () => {
    const tk = token(ID_GESTAO);
    banco.usuarios.find((u) => u.id === ID_GESTAO).status = 'INATIVO';
    bancoInicial = structuredClone(banco);
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', `Bearer ${tk}`)
      .send(CORPO);
    expect(res.status).toBe(401);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('Tutor que virou PEDAGOGICO no banco encerra ocorrência de que não é responsável (perfil atual vale)', async () => {
    const tk = token(ID_TUTOR);
    banco.usuarios.find((u) => u.id === ID_TUTOR).perfil = 'PEDAGOGICO';
    const res = await request(app)
      .patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`)
      .set('Authorization', `Bearer ${tk}`)
      .send(CORPO);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('ENCERRADO');
  });
});

// ---------------------------------------------------------------------------
// Corpo fora do formato JSON e chaves especiais
// ---------------------------------------------------------------------------
describe('complementar — formato do corpo', () => {
  it('formulário urlencoded status=ENCERRADO não é aceito (400, sem gravar)', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .type('form')
      .send('status=ENCERRADO');
    expect(res.status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('texto puro "ENCERRADO" não é aceito (400, sem gravar)', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .set('Content-Type', 'text/plain')
      .send('ENCERRADO');
    expect(res.status).toBe(400);
    esperarNadaGravado();
  });

  it('JSON string "ENCERRADO" (não objeto) responde 400', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .set('Content-Type', 'application/json')
      .send('"ENCERRADO"');
    expect(res.status).toBe(400);
    esperarNadaGravado();
  });

  it('JSON null responde 400', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .set('Content-Type', 'application/json')
      .send('null');
    expect(res.status).toBe(400);
    esperarNadaGravado();
  });

  it('status só em __proto__ não é aceito (400) e não polui Object.prototype', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"status":"ENCERRADO"}}');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_STATUS_INVALIDO });
    expect({}.status).toBeUndefined();
    esperarNadaGravado();
  });

  it('status com caractere nulo ou muito longo responde 400 (não 500)', async () => {
    const r1 = await encerrar(O_ACOMPANHAMENTO, { status: 'ENCERRADO\u0000' });
    const r2 = await encerrar(O_ACOMPANHAMENTO, { status: 'ENCERRADO'.repeat(5000) });
    expect([r1.status, r2.status]).toEqual([400, 400]);
    esperarNadaGravado();
  });

  it('chave status duplicada: vale a última (JSON.parse); ABERTO por último -> 400', async () => {
    const res = await comAuth(request(app).patch(`/ocorrencias/${O_ACOMPANHAMENTO}/status`))
      .set('Content-Type', 'application/json')
      .send('{"status":"ENCERRADO","status":"ABERTO"}');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_STATUS_SOMENTE_ENCERRADO });
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// Outros métodos na mesma URL (contrato: só PATCH)
// ---------------------------------------------------------------------------
describe('complementar — métodos na rota /status', () => {
  for (const metodo of ['put', 'post', 'get']) {
    it(`${metodo.toUpperCase()} /ocorrencias/{id}/status não encerra (404, sem gravar)`, async () => {
      const res = await comAuth(request(app)[metodo](`/ocorrencias/${O_ACOMPANHAMENTO}/status`)).send(CORPO);
      expect(res.status).toBe(404);
      expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).status).toBe('EM_ACOMPANHAMENTO');
      esperarNadaGravado();
    });
  }
});

// ---------------------------------------------------------------------------
// Transação: data recalculada e nada duplicado nas repetições
// ---------------------------------------------------------------------------
describe('complementar — repetição da transação', () => {
  it('P2034 duas vezes e sucesso na 3ª (última) tentativa: 200, um histórico e um log', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034')).mockRejectedValueOnce(erroPrisma('P2034'));
    await encerrarComSucesso(O_ACOMPANHAMENTO);
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('o relógio é consultado em cada tentativa (data_encerramento da tentativa que gravou)', async () => {
    const momentos = [new Date('2026-11-12T10:00:00.000Z'), new Date('2026-11-12T10:00:01.000Z')];
    let chamada = 0;
    const agora = vi.fn(() => momentos[chamada++]);
    let tentativa = 0;
    const db = {
      $transaction: async (op) => {
        tentativa += 1;
        const copia = structuredClone(banco);
        try {
          const r = await op(clientMock());
          if (tentativa === 1) throw erroPrisma('P2034'); // falha no commit da 1ª
          return r;
        } catch (erro) {
          banco = copia;
          throw erro;
        }
      },
    };
    const ocorrencia = await encerrarOcorrencia(
      String(O_ACOMPANHAMENTO),
      CORPO,
      { id: ID_GESTAO, perfil: 'GESTAO' },
      { db, agora },
    );
    expect(agora).toHaveBeenCalledTimes(2);
    expect(ocorrencia.dataEncerramento).toEqual(momentos[1]);
    expect(ocorrenciaNoBanco(O_ACOMPANHAMENTO).data_encerramento).toEqual(momentos[1]);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('P2034 e, na repetição, um encaminhamento concorrente trocou o responsável do Tutor: 404 se ele deixou de ver', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL).responsavel_acompanhamento_id = ID_TUTOR_2;
      throw erroPrisma('P2034');
    });
    const res = await encerrar(O_TUTOR_RESPONSAVEL, CORPO, ID_TUTOR);
    expect(res.status).toBe(404);
    expect(ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL).status).toBe('EM_ACOMPANHAMENTO');
    expect(banco.historicos).toHaveLength(0);
  });
});
