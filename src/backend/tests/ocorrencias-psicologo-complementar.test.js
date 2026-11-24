// Testes complementares do QA para a Issue #153 (Story #152, SSD 1.18):
// casos de borda da RN24 (justificativa do encaminhamento ao psicólogo),
// a lista GET /ocorrencias sem vazamento e as respostas de erro (400, 403,
// 404, 409) sem eco da justificativa. Complementam
// ocorrencias-psicologo.test.js. Somente dados fictícios (RN05).
// Não dependem do banco nem da data real: src/lib/prisma.js é substituído pelo
// "banco" em memória de tests/apoio/bancoEmMemoria.js; as datas do corpo são
// fixas e no passado (RN17).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { RELACOES_OCORRENCIAS, criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;

const AGORA_BANCO = new Date('2026-11-20T13:00:00.000Z');

const DEFAULTS = {
  encaminhamento: () => ({ data_hora: AGORA_BANCO, observacao: null, destinatario_usuario_id: null }),
  providencia: () => ({ data_hora: AGORA_BANCO }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: AGORA_BANCO }),
  logAuditoria: () => ({ data_hora: AGORA_BANCO }),
  ocorrencia: () => ({
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    responsavel_acompanhamento_id: null,
    data_encerramento: null,
  }),
};

const { clientMock } = criarBancoEmMemoria({
  obterBanco: () => banco,
  padroes: DEFAULTS,
  limiteRelacoes: 2,
  relacoes: {
    ...RELACOES_OCORRENCIAS,
    historicoOcorrencia: { usuario: ['um', 'usuario', 'usuario_id'] },
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
const { MENSAGEM_OCORRENCIA_NAO_ENCONTRADA } = await import('../src/services/ocorrencias.js');

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_PSI = 6;
const ID_PSI_2 = 7;
const ID_PSI_BLOQUEADO = 8;
const ID_PEDAGOGICO_2 = 10;
const ID_GESTAO_2 = 11;
const ID_PSI_NOVO = 13; // psicólogo cadastrado depois, sem encaminhamentos

// O2 EM_ACOMPANHAMENTO: registrada pelo Técnico; responsável: Tutor.
// Encaminhamentos posteriores ao PSI (pelo Pedagógico) e ao PSI_2 (pela Gestão).
const O2 = 2;
// O3 EM_ACOMPANHAMENTO: registrada pelo Professor, sem psicólogo.
const O3 = 3;
// O5 ENCERRADO.
const O5 = 5;

const JUST_B = 'Justificativa fictícia B registrada pelo Pedagógico.';
const JUST_C = 'Justificativa fictícia C registrada pela Gestão.';
const E_O2_PSI = 4;
const E_O2_PSI_2 = 5;

/** Marcador único: não pode aparecer em NENHUMA resposta de erro. */
const MARCADOR = 'MarcadorSigilosoFicticio-7Q2';

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
  const ocorrencia = (id, status, profissional, extra = {}) => ({
    id,
    data_hora: new Date(`2026-11-0${id}T10:00:00.000Z`),
    local: `Local fictício ${id}`,
    turma_id: 1,
    categoria_id: 1,
    descricao: `Descrição fictícia ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: profissional,
    responsavel_acompanhamento_id: null,
    status,
    data_encerramento: null,
    ...extra,
  });
  const encaminhamento = (id, ocorrenciaId, perfil, destinatario, registradoPor, observacao) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: destinatario,
    registrado_por_id: registradoPor,
    data_hora: new Date(`2026-11-1${id}T10:00:00.000Z`),
    observacao,
  });

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_PSI, 'PSICOLOGO'),
      usuario(ID_PSI_2, 'PSICOLOGO'),
      usuario(ID_PSI_BLOQUEADO, 'PSICOLOGO', { status: 'BLOQUEADO' }),
      usuario(ID_PEDAGOGICO_2, 'PEDAGOGICO'),
      usuario(ID_GESTAO_2, 'GESTAO'),
      usuario(ID_PSI_NOVO, 'PSICOLOGO'),
    ],
    turmas: [{ id: 1, nome: '7º B', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Sofrimento emocional', descricao: null }],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O2, 'EM_ACOMPANHAMENTO', ID_TECNICO, { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O3, 'EM_ACOMPANHAMENTO', ID_PROFESSOR, { responsavel_acompanhamento_id: ID_PEDAGOGICO }),
      ocorrencia(O5, 'ENCERRADO', ID_PROFESSOR, {
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
        data_encerramento: new Date('2026-11-09T10:00:00.000Z'),
      }),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O2, estudante_id: 1 },
      { ocorrencia_id: O3, estudante_id: 2 },
      { ocorrencia_id: O5, estudante_id: 2 },
    ],
    encaminhamentos: [
      encaminhamento(3, O2, 'GESTAO', null, ID_TECNICO, null),
      encaminhamento(E_O2_PSI, O2, 'PSICOLOGO', ID_PSI, ID_PEDAGOGICO, JUST_B),
      encaminhamento(E_O2_PSI_2, O2, 'PSICOLOGO', ID_PSI_2, ID_GESTAO, JUST_C),
      encaminhamento(7, O3, 'GESTAO', null, ID_PROFESSOR, null),
      encaminhamento(9, O5, 'GESTAO', null, ID_PROFESSOR, null),
    ],
    comunicacoes: [],
    providencias: [],
    historicos: [],
    logs: [],
  };
}

let bancoInicial;

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  bancoInicial = structuredClone(banco);
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
  vi.restoreAllMocks();
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const comToken = (req, usuarioId) => req.set('Authorization', `Bearer ${token(usuarioId)}`);
const getDetalhe = (id, usuarioId) => comToken(request(app).get(`/ocorrencias/${id}`), usuarioId);
const encaminhar = (id, corpo, usuarioId) =>
  comToken(request(app).post(`/ocorrencias/${id}/encaminhamentos`), usuarioId).send(corpo);
const postOcorrencia = (corpo, usuarioId) =>
  comToken(request(app).post('/ocorrencias'), usuarioId).send(corpo);
const mudarPerfil = (id, perfil) => {
  banco.usuarios.find((u) => u.id === id).perfil = perfil;
};

function observacaoDe(corpo, id) {
  const encaminhamento = corpo.encaminhamentos.find((e) => e.id === id);
  expect(encaminhamento).toBeDefined();
  return encaminhamento.observacao;
}

function corpoOcorrencia(encaminhamentos, extra = {}) {
  return {
    dataHora: '2026-11-19T10:00:00-03:00',
    local: 'Pátio fictício',
    turmaId: 1,
    categoriaId: 1,
    descricao: 'Descrição fictícia e objetiva do fato.',
    estudanteIds: [1],
    encaminhamentos,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// RN24 — Gestão autora × não autora e ex-Gestão
// ---------------------------------------------------------------------------
describe('RN24 (QA) — Gestão autora, Gestão não autora e ex-Gestão', () => {
  it('a Gestão autora e a Gestão não autora leem as duas justificativas', async () => {
    for (const id of [ID_GESTAO, ID_GESTAO_2]) {
      const res = await getDetalhe(O2, id);
      expect(res.status).toBe(200);
      expect(observacaoDe(res.body, E_O2_PSI)).toBe(JUST_B);
      expect(observacaoDe(res.body, E_O2_PSI_2)).toBe(JUST_C);
    }
  });

  it('ex-Gestão AUTORA que virou Pedagógico lê só a justificativa que registrou', async () => {
    mudarPerfil(ID_GESTAO, 'PEDAGOGICO');

    const res = await getDetalhe(O2, ID_GESTAO);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBe(JUST_C);
    expect(observacaoDe(res.body, E_O2_PSI)).toBeNull();
  });

  it('ex-Gestão NÃO autora que virou Pedagógico perde a leitura das justificativas', async () => {
    mudarPerfil(ID_GESTAO_2, 'PEDAGOGICO');

    const res = await getDetalhe(O2, ID_GESTAO_2);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBeNull();
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBeNull();
  });

  it('ex-Gestão autora que virou Professor sem vínculo com a ocorrência recebe 404 (RN19 vem antes da RN24)', async () => {
    mudarPerfil(ID_GESTAO, 'PROFESSOR');

    const res = await getDetalhe(O2, ID_GESTAO);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(JSON.stringify(res.body)).not.toContain(JUST_C);
  });

  it('ex-Gestão NÃO autora que virou Psicólogo (sem ser destinatário) não vê a ocorrência (404)', async () => {
    mudarPerfil(ID_GESTAO_2, 'PSICOLOGO');
    expect((await getDetalhe(O2, ID_GESTAO_2)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// RN24 — Pedagógico autor de encaminhamento posterior
// ---------------------------------------------------------------------------
describe('RN24 (QA) — Pedagógico autor de um encaminhamento posterior', () => {
  const JUST_NOVA = 'Justificativa fictícia nova do Pedagógico 2.';

  it('cada perfil recebe a justificativa conforme a autoria e o destino', async () => {
    const criado = await encaminhar(
      O3,
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI_2, observacao: JUST_NOVA },
      ID_PEDAGOGICO_2,
    );
    expect(criado.status).toBe(201);
    const novoId = criado.body.encaminhamentos.at(-1).id;
    // 201: o autor lê o que acabou de registrar.
    expect(observacaoDe(criado.body, novoId)).toBe(JUST_NOVA);

    const casos = [
      [ID_PEDAGOGICO_2, JUST_NOVA], // autor
      [ID_PEDAGOGICO, null], // outro Pedagógico, responsável pelo acompanhamento de O3
      [ID_GESTAO, JUST_NOVA],
      [ID_PSI_2, JUST_NOVA], // destinatário
      [ID_PROFESSOR, null], // autor da OCORRÊNCIA, não do encaminhamento
    ];
    for (const [usuarioId, esperado] of casos) {
      const res = await getDetalhe(O3, usuarioId);
      expect(res.status, `usuário ${usuarioId}`).toBe(200);
      expect(observacaoDe(res.body, novoId), `usuário ${usuarioId}`).toBe(esperado);
    }
    // Outro psicólogo não vê a ocorrência (RN19).
    expect((await getDetalhe(O3, ID_PSI)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// RN24 — Professor autor da ocorrência e encaminhamento posterior de outra pessoa
// ---------------------------------------------------------------------------
describe('RN24 (QA) — Professor autor da ocorrência não lê justificativa posterior de outra pessoa', () => {
  it('no GET e no histórico: o Professor vê o encaminhamento, sem o texto', async () => {
    const texto = 'Justificativa fictícia posterior da Gestão.';
    const criado = await encaminhar(
      O3,
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI, observacao: texto },
      ID_GESTAO,
    );
    expect(criado.status).toBe(201);
    const novoId = criado.body.encaminhamentos.at(-1).id;

    const res = await getDetalhe(O3, ID_PROFESSOR);
    expect(res.status).toBe(200);
    expect(res.body.encaminhamentos.find((e) => e.id === novoId)).toMatchObject({
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuario: { id: ID_PSI, perfil: 'PSICOLOGO' },
      registradoPor: { id: ID_GESTAO },
      observacao: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(texto);

    const historico = await comToken(request(app).get(`/ocorrencias/${O3}/historico`), ID_PROFESSOR);
    expect(historico.status).toBe(200);
    expect(JSON.stringify(historico.body)).not.toContain(texto);
  });
});

// ---------------------------------------------------------------------------
// RN24 — várias justificativas, uma para cada psicólogo
// ---------------------------------------------------------------------------
describe('RN24 (QA) — várias justificativas na mesma ocorrência', () => {
  const J1 = 'Justificativa fictícia para o psicólogo 1.';
  const J2 = 'Justificativa fictícia para o psicólogo 2.';
  const J3 = 'Justificativa fictícia de reencaminhamento ao psicólogo 1.';

  it('registro pelo Tutor com dois psicólogos e reencaminhamento ao primeiro pelo Pedagógico', async () => {
    const registrado = await postOcorrencia(
      corpoOcorrencia([
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI, observacao: J1 },
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI_2, observacao: J2 },
      ]),
      ID_TUTOR,
    );
    expect(registrado.status).toBe(201);
    const id = registrado.body.id;
    const [e1, e2] = registrado.body.encaminhamentos.map((e) => e.id);
    expect(registrado.body.encaminhamentos.map((e) => e.observacao)).toEqual([J1, J2]);

    // Reencaminhar ao mesmo psicólogo é permitido (decisão do Rafael, #49).
    const reenc = await encaminhar(
      id,
      {
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuarioId: ID_PSI,
        observacao: J3,
        responsavelAcompanhamentoId: ID_TUTOR,
      },
      ID_PEDAGOGICO,
    );
    expect(reenc.status).toBe(201);
    const e3 = reenc.body.encaminhamentos.at(-1).id;

    // [usuário, e1, e2, e3]
    const casos = [
      [ID_PSI, J1, null, J3],
      [ID_PSI_2, null, J2, null],
      [ID_TUTOR, J1, J2, null], // autor do registro, não do reencaminhamento
      [ID_PEDAGOGICO, null, null, J3],
      [ID_PEDAGOGICO_2, null, null, null],
      [ID_GESTAO_2, J1, J2, J3],
    ];
    for (const [usuarioId, o1, o2, o3] of casos) {
      const res = await getDetalhe(id, usuarioId);
      expect(res.status, `usuário ${usuarioId}`).toBe(200);
      expect(
        [observacaoDe(res.body, e1), observacaoDe(res.body, e2), observacaoDe(res.body, e3)],
        `usuário ${usuarioId}`,
      ).toEqual([o1, o2, o3]);
    }
    // Um psicólogo novo não vê a ocorrência (RN19) nem, portanto, as justificativas.
    expect((await getDetalhe(id, ID_PSI_NOVO)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /ocorrencias — a lista não vaza a observação
// ---------------------------------------------------------------------------
describe('RN24 (QA) — GET /ocorrencias não traz encaminhamentos nem a justificativa', () => {
  it.each([
    ['Gestão', ID_GESTAO],
    ['Pedagógico autor', ID_PEDAGOGICO],
    ['psicólogo destinatário', ID_PSI],
    ['Tutor', ID_TUTOR],
    ['Técnico', ID_TECNICO],
  ])('%s: nenhum item tem encaminhamentos/observacao, com e sem filtros', async (_c, usuarioId) => {
    for (const url of ['/ocorrencias', `/ocorrencias?status=EM_ACOMPANHAMENTO&pagina=1`]) {
      const res = await comToken(request(app).get(url), usuarioId);
      expect(res.status, url).toBe(200);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toContain(JUST_B);
      expect(texto).not.toContain(JUST_C);
      expect(texto).not.toContain('observacao');
      for (const item of res.body.itens) expect(item).not.toHaveProperty('encaminhamentos');
    }
  });
});

// ---------------------------------------------------------------------------
// Respostas de erro não ecoam a justificativa
// ---------------------------------------------------------------------------
describe('RN24 (QA) — nenhuma resposta de erro ecoa a justificativa', () => {
  const encPsi = (extra = {}) => ({
    destinatarioPerfil: 'PSICOLOGO',
    destinatarioUsuarioId: ID_PSI,
    observacao: `Texto fictício ${MARCADOR}.`,
    ...extra,
  });

  const CASOS = [
    ['POST /ocorrencias repetido', 400, () => postOcorrencia(corpoOcorrencia([encPsi(), encPsi()]), ID_PROFESSOR)],
    ['POST /ocorrencias psicólogo bloqueado', 400, () => postOcorrencia(corpoOcorrencia([encPsi({ destinatarioUsuarioId: ID_PSI_BLOQUEADO })]), ID_PROFESSOR)],
    ['POST /ocorrencias sem usuário destinatário', 400, () => postOcorrencia(corpoOcorrencia([encPsi({ destinatarioUsuarioId: null })]), ID_PROFESSOR)],
    ['POST /ocorrencias justificativa longa', 400, () => postOcorrencia(corpoOcorrencia([encPsi({ observacao: MARCADOR + 'a'.repeat(5000) })]), ID_PROFESSOR)],
    ['POST /ocorrencias justificativa com caractere nulo', 400, () => postOcorrencia(corpoOcorrencia([encPsi({ observacao: `${MARCADOR}\u0000` })]), ID_PROFESSOR)],
    ['POST /ocorrencias data no futuro (RN17)', 400, () => postOcorrencia(corpoOcorrencia([encPsi()], { dataHora: '2999-01-01T10:00:00-03:00' }), ID_PROFESSOR)],
    ['POST /ocorrencias turma inexistente', 400, () => postOcorrencia(corpoOcorrencia([encPsi()], { turmaId: 999 }), ID_PROFESSOR)],
    ['POST /ocorrencias destinatário inválido', 400, () => postOcorrencia(corpoOcorrencia([encPsi({ destinatarioPerfil: MARCADOR })]), ID_PROFESSOR)],
    ['POST .../encaminhamentos ocorrência encerrada', 409, () => encaminhar(O5, encPsi(), ID_GESTAO)],
    ['POST .../encaminhamentos psicólogo como responsável', 400, () => encaminhar(O3, encPsi({ responsavelAcompanhamentoId: ID_PSI }), ID_GESTAO)],
    ['POST .../encaminhamentos responsável inválido (texto)', 400, () => encaminhar(O3, encPsi({ responsavelAcompanhamentoId: MARCADOR }), ID_GESTAO)],
    ['POST .../encaminhamentos ocorrência inexistente', 404, () => encaminhar(999, encPsi(), ID_PEDAGOGICO)],
    ['POST .../encaminhamentos pelo psicólogo', 403, () => encaminhar(O2, encPsi(), ID_PSI)],
    ['POST .../encaminhamentos pelo Professor', 403, () => encaminhar(O3, encPsi(), ID_PROFESSOR)],
    ['POST .../encaminhamentos JSON inválido', 400, () => comToken(request(app).post(`/ocorrencias/${O3}/encaminhamentos`), ID_GESTAO).set('Content-Type', 'application/json').send(`{"observacao":"${MARCADOR}",`)],
  ];

  it.each(CASOS)('%s → %i, sem a justificativa e sem gravar', async (_c, status, enviar) => {
    const erroConsole = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await enviar();

    expect(res.status).toBe(status);
    expect(Object.keys(res.body).every((k) => ['erro', 'codigo'].includes(k))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(MARCADOR);
    expect(res.text).not.toContain(MARCADOR);
    expect(JSON.stringify(erroConsole.mock.calls)).not.toContain(MARCADOR);
    expect(banco).toEqual(bancoInicial);
  });

  it('409 CONFLITO_CONCORRENTE (tempo da transação esgotado) também não ecoa', async () => {
    mocks.$transaction.mockImplementation(async () => {
      throw Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
    });

    const res = await encaminhar(O3, encPsi(), ID_GESTAO);

    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe(CODIGOS_ERRO.CONFLITO_CONCORRENTE);
    expect(JSON.stringify(res.body)).not.toContain(MARCADOR);
  });
});
