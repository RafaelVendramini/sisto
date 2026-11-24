// Testes da Issue #153 (Story #152, SSD 1.18): perfil e destinatário
// PSICOLOGO, justificativa obrigatória (RN03, RN15) e restrita (RN24),
// permissões do psicólogo (RN16, RN19, RN20, RN22, matriz da Seção 4) e
// psicólogo fora da lista de responsáveis (RN15, RN23). Somente dados
// fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído pelo "banco" em
// memória de tests/apoio/bancoEmMemoria.js, que AVALIA o where/select/orderBy
// gerados pelos services. A transação do mock faz rollback (cópia do banco)
// quando a operação falha. O relógio é fixo (deps.agora / data do "banco"):
// nada depende da data real nem de variáveis do ambiente além do JWT_SECRET
// fictício definido aqui.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERRO } from '../src/lib/erros.js';
import { RELACOES_OCORRENCIAS, criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;

/** Momento fictício preenchido pelo "banco" (@default(now())). */
const AGORA_BANCO = new Date('2026-11-20T13:00:00.000Z');
/** Relógio fixo do servidor (RN17) nos testes que chamam o service direto. */
const AGORA_SERVIDOR = () => new Date('2026-11-20T15:00:00.000Z');

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
  // GET .../historico lê o usuário de cada registro.
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
const { MENSAGEM_PERFIL_SEM_PERMISSAO } = await import('../src/middlewares/autenticacao.js');
const {
  ACOES_HISTORICO,
  DESTINATARIOS_VALIDOS,
  MENSAGEM_ENCAMINHAMENTO_PSICOLOGO_OBRIGATORIO,
  MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO,
  MENSAGEM_JUSTIFICATIVA_PSICOLOGO_OBRIGATORIA,
  MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_RESPONSAVEL_INVALIDO,
  MENSAGEM_RESPONSAVEL_OBRIGATORIO,
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
  PERFIS_COMUNICACAO,
  PERFIS_ENCAMINHAMENTO,
  PERFIS_ENCERRAMENTO,
  PERFIS_PROVIDENCIA,
  PERFIS_RESPONSAVEL_ACOMPANHAMENTO,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  mensagemDestinatarioEncaminhamentoInvalido,
  mensagemDestinatarioInvalido,
  mensagemEncaminhamentoRepetido,
  mensagemJustificativaPsicologoObrigatoria,
  mensagemPsicologoObrigatorio,
  mensagemTextoLongo,
  mensagemTutorObrigatorio,
  podeLerObservacaoEncaminhamento,
  registrarOcorrencia,
} = await import('../src/services/ocorrencias.js');
const { PERFIS_RELATORIOS } = await import('../src/services/relatorios.js');

// ---------------------------------------------------------------------------
// Cenário fictício
// ---------------------------------------------------------------------------

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_PROFESSOR = 1;
const ID_TUTOR = 2;
const ID_GESTAO = 3;
const ID_PEDAGOGICO = 4;
const ID_TECNICO = 5;
const ID_PSI = 6; // psicólogo ativo
const ID_PSI_2 = 7; // outro psicólogo ativo
const ID_PSI_BLOQUEADO = 8;
const ID_PSI_DESATIVADO = 9;
const ID_PEDAGOGICO_2 = 10;
const ID_GESTAO_2 = 11;
const ID_TUTOR_2 = 12;
const ID_INEXISTENTE = 999;

// O1 ABERTO: registrada pelo Professor, encaminhada ao PSI pelo Professor.
const O1 = 1;
// O2 EM_ACOMPANHAMENTO: registrada pelo Técnico; responsável: Tutor;
// encaminhamentos posteriores ao PSI (pelo Pedagógico) e ao PSI_2 (pela Gestão).
const O2 = 2;
// O3 EM_ACOMPANHAMENTO: sem relação com os psicólogos (fora da visibilidade deles).
const O3 = 3;
// O4 ABERTO: registrada pelo PSI.
const O4 = 4;
// O5 ENCERRADO: encaminhada ao PSI.
const O5 = 5;

// Justificativas e observações fictícias (RN05).
const JUST_A = 'Justificativa fictícia A para o acolhimento.';
const JUST_B = 'Justificativa fictícia B registrada pelo Pedagógico.';
const JUST_C = 'Justificativa fictícia C registrada pela Gestão.';
const JUST_E = 'Justificativa fictícia E de ocorrência encerrada.';
const OBS_COMUM = 'Observação fictícia comum para a Gestão.';
const OBS_TUTOR = 'Observação fictícia comum para o Tutor.';

// Ids dos encaminhamentos do cenário.
const E_O1_PSI = 1; // JUST_A, PSICOLOGO -> PSI, registrado pelo Professor
const E_O1_GESTAO = 2; // OBS_COMUM, GESTAO, registrado pelo Professor
const E_O2_GESTAO = 3; // sem observação, registrado pelo Técnico
const E_O2_PSI = 4; // JUST_B, PSICOLOGO -> PSI, registrado pelo Pedagógico
const E_O2_PSI_2 = 5; // JUST_C, PSICOLOGO -> PSI_2, registrado pela Gestão
const E_O2_TUTOR = 6; // OBS_TUTOR, TUTOR -> Tutor, registrado pela Gestão

const data = (iso) => new Date(iso);

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
    data_hora: data(`2026-11-0${id}T10:00:00.000Z`),
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
    data_hora: data(`2026-11-1${id}T10:00:00.000Z`),
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
      usuario(ID_PSI_DESATIVADO, 'PSICOLOGO', { status: 'DESATIVADO' }),
      usuario(ID_PEDAGOGICO_2, 'PEDAGOGICO'),
      usuario(ID_GESTAO_2, 'GESTAO'),
      usuario(ID_TUTOR_2, 'TUTOR'),
    ],
    turmas: [{ id: 1, nome: '7º B', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Sofrimento emocional', descricao: null }],
    estudantes: [
      { id: 1, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: 2, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O1, 'ABERTO', ID_PROFESSOR),
      ocorrencia(O2, 'EM_ACOMPANHAMENTO', ID_TECNICO, { responsavel_acompanhamento_id: ID_TUTOR }),
      ocorrencia(O3, 'EM_ACOMPANHAMENTO', ID_PROFESSOR, { responsavel_acompanhamento_id: ID_PEDAGOGICO }),
      ocorrencia(O4, 'ABERTO', ID_PSI),
      ocorrencia(O5, 'ENCERRADO', ID_PROFESSOR, {
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
        data_encerramento: data('2026-11-09T10:00:00.000Z'),
      }),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O1, estudante_id: 2 },
      { ocorrencia_id: O2, estudante_id: 1 },
      { ocorrencia_id: O3, estudante_id: 2 },
      { ocorrencia_id: O4, estudante_id: 2 },
      { ocorrencia_id: O5, estudante_id: 2 },
    ],
    encaminhamentos: [
      encaminhamento(E_O1_PSI, O1, 'PSICOLOGO', ID_PSI, ID_PROFESSOR, JUST_A),
      encaminhamento(E_O1_GESTAO, O1, 'GESTAO', null, ID_PROFESSOR, OBS_COMUM),
      encaminhamento(E_O2_GESTAO, O2, 'GESTAO', null, ID_TECNICO, null),
      encaminhamento(E_O2_PSI, O2, 'PSICOLOGO', ID_PSI, ID_PEDAGOGICO, JUST_B),
      encaminhamento(E_O2_PSI_2, O2, 'PSICOLOGO', ID_PSI_2, ID_GESTAO, JUST_C),
      encaminhamento(E_O2_TUTOR, O2, 'TUTOR', ID_TUTOR, ID_GESTAO, OBS_TUTOR),
      { ...encaminhamento(7, O3, 'GESTAO', null, ID_PROFESSOR, null) },
      { ...encaminhamento(8, O4, 'GESTAO', null, ID_PSI, null) },
      { ...encaminhamento(9, O5, 'PSICOLOGO', ID_PSI, ID_PROFESSOR, JUST_E) },
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
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const comToken = (req, usuarioId) => req.set('Authorization', `Bearer ${token(usuarioId)}`);
const getDetalhe = (id, usuarioId) => comToken(request(app).get(`/ocorrencias/${id}`), usuarioId);
const getLista = (usuarioId) => comToken(request(app).get('/ocorrencias'), usuarioId);
const encaminhar = (id, corpo, usuarioId) =>
  comToken(request(app).post(`/ocorrencias/${id}/encaminhamentos`), usuarioId).send(corpo);
const comunicar = (id, corpo, usuarioId) =>
  comToken(request(app).post(`/ocorrencias/${id}/comunicacoes`), usuarioId).send(corpo);
const providenciar = (id, corpo, usuarioId) =>
  comToken(request(app).post(`/ocorrencias/${id}/providencias`), usuarioId).send(corpo);
const encerrar = (id, usuarioId) =>
  comToken(request(app).patch(`/ocorrencias/${id}/status`), usuarioId).send({ status: 'ENCERRADO' });

/** Nada foi gravado (banco igual ao inicial). */
function esperarNadaGravado() {
  expect(banco).toEqual(bancoInicial);
}

/** Observação do encaminhamento `id` na resposta com o detalhe. */
function observacaoDe(corpo, id) {
  const encaminhamento = corpo.encaminhamentos.find((e) => e.id === id);
  expect(encaminhamento).toBeDefined();
  return encaminhamento.observacao;
}

/** Corpo válido de POST /ocorrencias (data no passado — RN17). */
function corpoOcorrencia(encaminhamentos) {
  return {
    dataHora: '2026-11-19T10:00:00-03:00',
    local: 'Pátio fictício',
    turmaId: 1,
    categoriaId: 1,
    descricao: 'Descrição fictícia e objetiva do fato.',
    estudanteIds: [1],
    encaminhamentos,
  };
}

const ENC_PSI = Object.freeze({
  destinatarioPerfil: 'PSICOLOGO',
  destinatarioUsuarioId: ID_PSI,
  observacao: 'Texto fictício de justificativa.',
});

/** Registra pela API com o relógio fixo (o service recebe `agora`). */
function registrarComRelogioFixo(corpo, usuarioId) {
  const usuario = banco.usuarios.find((u) => u.id === usuarioId);
  return registrarOcorrencia(corpo, { id: usuario.id, perfil: usuario.perfil }, { agora: AGORA_SERVIDOR });
}

const postOcorrencia = (corpo, usuarioId) =>
  comToken(request(app).post('/ocorrencias'), usuarioId).send(corpo);

// ---------------------------------------------------------------------------
// Catálogo do destinatário e dos perfis
// ---------------------------------------------------------------------------
describe('Destinatário e perfis — valores (SSD 1.18, Seções 4 e 11)', () => {
  it('PSICOLOGO é um destinatário válido', () => {
    expect(DESTINATARIOS_VALIDOS).toContain('PSICOLOGO');
  });

  it('o psicólogo comunica, mas não encaminha, não registra providência, não encerra nem gera relatórios', () => {
    expect(PERFIS_COMUNICACAO).toContain('PSICOLOGO');
    expect(PERFIS_ENCAMINHAMENTO).not.toContain('PSICOLOGO');
    expect(PERFIS_PROVIDENCIA).not.toContain('PSICOLOGO');
    expect(PERFIS_ENCERRAMENTO).not.toContain('PSICOLOGO');
    expect(PERFIS_RELATORIOS).not.toContain('PSICOLOGO');
  });

  it('o psicólogo nunca é responsável pelo acompanhamento (RN15, RN23)', () => {
    expect(PERFIS_RESPONSAVEL_ACOMPANHAMENTO).not.toContain('PSICOLOGO');
  });
});

// ---------------------------------------------------------------------------
// Registro com encaminhamento ao psicólogo (RN03, UC01)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias — encaminhamento ao psicólogo (RN03)', () => {
  it('201 com o psicólogo ativo e a justificativa; a ocorrência nasce ABERTO', async () => {
    const res = await postOcorrencia(corpoOcorrencia([ENC_PSI]), ID_PROFESSOR);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ABERTO');
    expect(res.body.encaminhamentos).toEqual([
      expect.objectContaining({
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuario: { id: ID_PSI, nome: `Usuário Fictício ${ID_PSI}`, perfil: 'PSICOLOGO' },
        registradoPor: { id: ID_PROFESSOR, nome: `Usuário Fictício ${ID_PROFESSOR}` },
        // Quem registrou o encaminhamento lê a justificativa (RN24).
        observacao: ENC_PSI.observacao,
      }),
    ]);
    const gravado = banco.encaminhamentos.at(-1);
    expect(gravado).toMatchObject({
      destinatario_perfil: 'PSICOLOGO',
      destinatario_usuario_id: ID_PSI,
      registrado_por_id: ID_PROFESSOR,
      observacao: ENC_PSI.observacao,
    });
  });

  it('a justificativa é gravada sem os espaços das pontas (mesma regra das demais observações)', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, observacao: '   Texto fictício com espaços.  ' }]),
      ID_TUTOR,
    );

    expect(res.status).toBe(201);
    expect(banco.encaminhamentos.at(-1).observacao).toBe('Texto fictício com espaços.');
  });

  it('o histórico registra "Destinatário: psicólogo escolar", sem a justificativa (RN08, RN24), e a auditoria também não a contém', async () => {
    const res = await postOcorrencia(corpoOcorrencia([ENC_PSI]), ID_PROFESSOR);
    expect(res.status).toBe(201);

    const historico = banco.historicos.filter((h) => h.ocorrencia_id === res.body.id);
    expect(historico.map(({ acao, descricao }) => ({ acao, descricao }))).toEqual([
      { acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA, descricao: null },
      { acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: psicólogo escolar' },
    ]);
    expect(JSON.stringify(banco.historicos)).not.toContain(ENC_PSI.observacao);
    expect(JSON.stringify(banco.logs)).not.toContain(ENC_PSI.observacao);
  });

  it('o psicólogo também registra ocorrência (UC01) e encaminha ao psicólogo no registro', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, destinatarioUsuarioId: ID_PSI_2 }]),
      ID_PSI,
    );

    expect(res.status).toBe(201);
    expect(res.body.profissionalResponsavel.id).toBe(ID_PSI);
  });

  it('o service aceita o registro com o relógio fixo (RN17 sem depender da data real)', async () => {
    const resposta = await registrarComRelogioFixo(corpoOcorrencia([ENC_PSI]), ID_TECNICO);
    expect(resposta.status).toBe('ABERTO');
    expect(resposta.encaminhamentos[0].observacao).toBe(ENC_PSI.observacao);
  });

  it.each([
    ['sem destinatarioUsuarioId', { destinatarioPerfil: 'PSICOLOGO', observacao: 'Texto fictício.' }],
    ['com destinatarioUsuarioId null', { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: null, observacao: 'Texto fictício.' }],
  ])('400 %s, sem consultar nem gravar', async (_c, item) => {
    const res = await postOcorrencia(corpoOcorrencia([item]), ID_PROFESSOR);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemPsicologoObrigatorio(1) });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it.each([
    ['usuário de outro perfil (Tutor)', ID_TUTOR],
    ['usuário de outro perfil (Pedagógico)', ID_PEDAGOGICO],
    ['psicólogo bloqueado', ID_PSI_BLOQUEADO],
    ['psicólogo desativado', ID_PSI_DESATIVADO],
    ['usuário inexistente', ID_INEXISTENTE],
  ])('400 com %s, sem gravar nada', async (_c, destinatarioUsuarioId) => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, destinatarioUsuarioId }]),
      ID_PROFESSOR,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioInvalido(1, 'PSICOLOGO') });
    expect(res.body.erro).toContain('Psicólogo escolar');
    esperarNadaGravado();
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['vazia', ''],
    ['só com espaços', '   \t  '],
  ])('400 com a justificativa %s, com mensagem clara e sem gravar', async (_c, observacao) => {
    const item = { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI };
    if (observacao !== undefined) item.observacao = observacao;

    const res = await postOcorrencia(corpoOcorrencia([item]), ID_PROFESSOR);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemJustificativaPsicologoObrigatoria(1) });
    expect(res.body.erro).toMatch(/justificativa do encaminhamento ao psicólogo escolar/);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('400 com a justificativa acima de 5000 caracteres', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, observacao: 'a'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO + 1) }]),
      ID_PROFESSOR,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemTextoLongo('observacao do encaminhamento 1') });
    esperarNadaGravado();
  });

  it('201 com a justificativa de exatamente 5000 caracteres', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, observacao: 'a'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO) }]),
      ID_PROFESSOR,
    );
    expect(res.status).toBe(201);
  });

  it('400 com o caractere nulo na justificativa', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ ...ENC_PSI, observacao: 'Texto\u0000fictício' }]),
      ID_PROFESSOR,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
    esperarNadaGravado();
  });

  it('tudo ou nada (RN03): um encaminhamento válido e o do psicólogo inválido não gravam nada', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([
        { destinatarioPerfil: 'GESTAO' },
        { ...ENC_PSI, destinatarioUsuarioId: ID_PSI_BLOQUEADO },
      ]),
      ID_PROFESSOR,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioInvalido(2, 'PSICOLOGO') });
    expect(mocks.$transaction).toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('400 com dois encaminhamentos ao mesmo psicólogo (repetidos — Issue #45)', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([ENC_PSI, { ...ENC_PSI, observacao: 'Outro texto fictício.' }]),
      ID_PROFESSOR,
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemEncaminhamentoRepetido(1, 2) });
    esperarNadaGravado();
  });

  it('dois psicólogos diferentes no mesmo registro são aceitos', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([ENC_PSI, { ...ENC_PSI, destinatarioUsuarioId: ID_PSI_2 }]),
      ID_PROFESSOR,
    );
    expect(res.status).toBe(201);
    expect(res.body.encaminhamentos).toHaveLength(2);
  });

  it('a observação dos demais destinatários continua opcional', async () => {
    const res = await postOcorrencia(
      corpoOcorrencia([{ destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }]),
      ID_PROFESSOR,
    );
    expect(res.status).toBe(201);
    expect(res.body.encaminhamentos[0].observacao).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Encaminhamento posterior (RN15, UC02)
// ---------------------------------------------------------------------------
describe('POST /ocorrencias/{id}/encaminhamentos — destinatário psicólogo (RN15)', () => {
  it('a Gestão encaminha uma ocorrência em acompanhamento ao psicólogo (201, status mantido)', async () => {
    const res = await encaminhar(O3, ENC_PSI, ID_GESTAO);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('EM_ACOMPANHAMENTO');
    const criado = res.body.encaminhamentos.at(-1);
    expect(criado).toMatchObject({
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuario: { id: ID_PSI, perfil: 'PSICOLOGO' },
      observacao: ENC_PSI.observacao,
    });
    const historico = banco.historicos.filter((h) => h.ocorrencia_id === O3);
    expect(historico).toEqual([
      expect.objectContaining({
        acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO,
        descricao: 'Destinatário: psicólogo escolar',
      }),
    ]);
    expect(JSON.stringify(banco.historicos)).not.toContain(ENC_PSI.observacao);
    expect(JSON.stringify(banco.logs)).not.toContain(ENC_PSI.observacao);
  });

  it('o Pedagógico encaminha uma ocorrência aberta ao psicólogo, com responsável Tutor (201, em acompanhamento)', async () => {
    const res = await encaminhar(
      O1,
      { ...ENC_PSI, destinatarioUsuarioId: ID_PSI_2, responsavelAcompanhamentoId: ID_TUTOR },
      ID_PEDAGOGICO,
    );

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('EM_ACOMPANHAMENTO');
    expect(res.body.responsavelAcompanhamento.id).toBe(ID_TUTOR);
    // RN24: o Pedagógico lê a justificativa que ele mesmo registrou, mas não a
    // do encaminhamento inicial, registrado pelo Professor.
    expect(res.body.encaminhamentos.at(-1).observacao).toBe(ENC_PSI.observacao);
    expect(observacaoDe(res.body, E_O1_PSI)).toBeNull();
  });

  it('em ocorrência aberta, continua exigindo o responsável pelo acompanhamento (400)', async () => {
    const res = await encaminhar(O1, ENC_PSI, ID_GESTAO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_OBRIGATORIO });
    esperarNadaGravado();
  });

  it.each([
    ['aberta (definição)', O1],
    ['em acompanhamento (troca)', O3],
  ])('o psicólogo como responsável pelo acompanhamento responde 400 — ocorrência %s', async (_c, id) => {
    const res = await encaminhar(id, { ...ENC_PSI, responsavelAcompanhamentoId: ID_PSI }, ID_GESTAO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_RESPONSAVEL_INVALIDO });
    esperarNadaGravado();
  });

  it('400 sem o usuário destinatário', async () => {
    const res = await encaminhar(O3, { destinatarioPerfil: 'PSICOLOGO', observacao: 'Texto fictício.' }, ID_GESTAO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ENCAMINHAMENTO_PSICOLOGO_OBRIGATORIO });
    esperarNadaGravado();
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só com espaços', '    '],
  ])('400 com a justificativa %s', async (_c, observacao) => {
    const corpo = { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI };
    if (observacao !== undefined) corpo.observacao = observacao;

    const res = await encaminhar(O3, corpo, ID_PEDAGOGICO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_JUSTIFICATIVA_PSICOLOGO_OBRIGATORIA });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('400 com a justificativa acima de 5000 caracteres ou com caractere nulo', async () => {
    const longa = await encaminhar(
      O3,
      { ...ENC_PSI, observacao: 'b'.repeat(TAMANHO_MAXIMO_TEXTO_LONGO + 1) },
      ID_GESTAO,
    );
    expect(longa.status).toBe(400);
    expect(longa.body).toEqual({ erro: mensagemTextoLongo('observacao') });

    const nulo = await encaminhar(O3, { ...ENC_PSI, observacao: 'a\u0000b' }, ID_GESTAO);
    expect(nulo.status).toBe(400);
    expect(nulo.body).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
    esperarNadaGravado();
  });

  it.each([
    ['psicólogo bloqueado', ID_PSI_BLOQUEADO],
    ['psicólogo desativado', ID_PSI_DESATIVADO],
    ['usuário de outro perfil', ID_TUTOR],
  ])('400 com %s, sem gravar', async (_c, destinatarioUsuarioId) => {
    const res = await encaminhar(O3, { ...ENC_PSI, destinatarioUsuarioId }, ID_GESTAO);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: mensagemDestinatarioEncaminhamentoInvalido('PSICOLOGO') });
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// Permissões do perfil PSICOLOGO (matriz da Seção 4, RN16, RN19, RN20, RN22)
// ---------------------------------------------------------------------------
describe('Perfil PSICOLOGO — visibilidade (RN19)', () => {
  it('a lista traz só as ocorrências que ele registrou e as encaminhadas a ele', async () => {
    const res = await getLista(ID_PSI);

    expect(res.status).toBe(200);
    expect(res.body.itens.map((o) => o.id).sort()).toEqual([O1, O2, O4, O5]);
  });

  it('outro psicólogo vê só as encaminhadas a ele', async () => {
    const res = await getLista(ID_PSI_2);
    expect(res.body.itens.map((o) => o.id)).toEqual([O2]);
  });

  it('o detalhe de uma ocorrência fora da visibilidade responde 404', async () => {
    const res = await getDetalhe(O3, ID_PSI);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect((await getDetalhe(O1, ID_PSI_2)).status).toBe(404);
  });

  it('o histórico segue a mesma visibilidade (200 nas que vê, 404 nas demais)', async () => {
    expect((await comToken(request(app).get(`/ocorrencias/${O1}/historico`), ID_PSI)).status).toBe(200);
    expect((await comToken(request(app).get(`/ocorrencias/${O3}/historico`), ID_PSI)).status).toBe(404);
  });

  it('o detalhe vem sem o código escolar dos estudantes (RN20)', async () => {
    const res = await getDetalhe(O1, ID_PSI);
    expect(res.status).toBe(200);
    expect(res.body.estudantes[0]).not.toHaveProperty('codigoEscolar');
  });
});

describe('Perfil PSICOLOGO — comunicação (RN16)', () => {
  const COMUNICACAO = Object.freeze({
    destinatario: 'Família fictícia',
    meio: 'Telefone',
    descricao: 'Contato fictício de acolhimento.',
    dataHora: '2026-11-19T09:00:00-03:00',
  });

  it('registra comunicação numa ocorrência encaminhada a ele (201)', async () => {
    const res = await comunicar(O1, COMUNICACAO, ID_PSI);

    expect(res.status).toBe(201);
    expect(res.body.comunicacoes).toEqual([
      expect.objectContaining({ registradoPor: { id: ID_PSI, nome: `Usuário Fictício ${ID_PSI}` } }),
    ]);
    expect(res.body.status).toBe('ABERTO');
  });

  it('registra comunicação numa ocorrência que ele registrou (201)', async () => {
    expect((await comunicar(O4, COMUNICACAO, ID_PSI)).status).toBe(201);
  });

  it('em ocorrência que não vê, responde 404 sem gravar', async () => {
    const res = await comunicar(O3, COMUNICACAO, ID_PSI);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    esperarNadaGravado();
  });

  it('em ocorrência encerrada que vê, responde 409 OCORRENCIA_ENCERRADA', async () => {
    const res = await comunicar(O5, COMUNICACAO, ID_PSI);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: MENSAGEM_OCORRENCIA_ENCERRADA_COMUNICACAO,
      codigo: CODIGOS_ERRO.OCORRENCIA_ENCERRADA,
    });
  });
});

describe('Perfil PSICOLOGO — 403 já na rota (RN15, RN22, matriz)', () => {
  const ROTAS_PROIBIDAS = [
    ['POST /ocorrencias/{id}/encaminhamentos', () => request(app).post(`/ocorrencias/${O1}/encaminhamentos`).send({ ...ENC_PSI, responsavelAcompanhamentoId: ID_TUTOR })],
    ['POST /ocorrencias/{id}/providencias', () => request(app).post(`/ocorrencias/${O2}/providencias`).send({ descricao: 'Providência fictícia.' })],
    ['PATCH /ocorrencias/{id}/status', () => request(app).patch(`/ocorrencias/${O2}/status`).send({ status: 'ENCERRADO' })],
    ['GET /relatorios', () => request(app).get('/relatorios?tipo=periodo&dataInicio=2026-11-01&dataFim=2026-11-30')],
    ['POST /categorias', () => request(app).post('/categorias').send({ nome: 'Categoria fictícia' })],
    ['PUT /categorias/{id}', () => request(app).put('/categorias/1').send({ nome: 'Categoria fictícia' })],
    ['POST /turmas', () => request(app).post('/turmas').send({ nome: '8º A', etapa: 'EF', anoLetivo: 2026 })],
    ['PUT /turmas/{id}', () => request(app).put('/turmas/1').send({ nome: '8º A', etapa: 'EF', anoLetivo: 2026 })],
    ['POST /estudantes', () => request(app).post('/estudantes').send({ nomeCompleto: 'Estudante Fictício', turmaId: 1 })],
    ['PUT /estudantes/{id}', () => request(app).put('/estudantes/1').send({ nomeCompleto: 'Estudante Fictício', turmaId: 1 })],
    ['POST /usuarios', () => request(app).post('/usuarios').send({ nome: 'Fictício', email: 'novo@sisto.exemplo', perfil: 'PROFESSOR', senha: 'SenhaFicticia1' })],
    ['PUT /usuarios/{id}', () => request(app).put(`/usuarios/${ID_PROFESSOR}`).send({ nome: 'Nome Fictício' })],
    ['PUT /usuarios/{id}/senha', () => request(app).put(`/usuarios/${ID_PROFESSOR}/senha`).send({ novaSenha: 'SenhaFicticia1' })],
  ];

  it.each(ROTAS_PROIBIDAS)('%s responde 403 sem gravar', async (_rota, montar) => {
    const res = await comToken(montar(), ID_PSI);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('a providência e o encerramento dão 403 mesmo numa ocorrência encaminhada a ele', async () => {
    expect((await providenciar(O2, { descricao: 'Providência fictícia.' }, ID_PSI)).status).toBe(403);
    expect((await encerrar(O2, ID_PSI)).status).toBe(403);
  });
});

describe('Perfil PSICOLOGO — dados reduzidos (RN20)', () => {
  it('GET /estudantes vem sem código escolar', async () => {
    const res = await comToken(request(app).get('/estudantes'), ID_PSI);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const estudante of res.body) expect(estudante).not.toHaveProperty('codigoEscolar');
  });

  it('GET /turmas e GET /categorias respondem 200', async () => {
    expect((await comToken(request(app).get('/turmas'), ID_PSI)).status).toBe(200);
    expect((await comToken(request(app).get('/categorias'), ID_PSI)).status).toBe(200);
  });

  it('GET /usuarios vem reduzido (id, nome e perfil dos ativos), com os psicólogos ativos', async () => {
    const res = await comToken(request(app).get('/usuarios'), ID_PSI);

    expect(res.status).toBe(200);
    for (const u of res.body) expect(Object.keys(u).sort()).toEqual(['id', 'nome', 'perfil']);
    const ids = res.body.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([ID_PSI, ID_PSI_2, ID_TUTOR, ID_PEDAGOGICO, ID_GESTAO]));
    expect(ids).not.toContain(ID_PSI_BLOQUEADO);
    expect(ids).not.toContain(ID_PSI_DESATIVADO);
    expect(ids).not.toContain(ID_PROFESSOR);
    expect(ids).not.toContain(ID_TECNICO);
  });
});

describe('GET /usuarios?perfil=PSICOLOGO (RN20)', () => {
  it.each([
    ['PROFESSOR', ID_PROFESSOR],
    ['TUTOR', ID_TUTOR],
    ['PEDAGOGICO', ID_PEDAGOGICO],
    ['TECNICO_ADMINISTRATIVO', ID_TECNICO],
    ['PSICOLOGO', ID_PSI],
  ])('para %s devolve só os psicólogos ativos, com id, nome e perfil', async (_perfil, id) => {
    const res = await comToken(request(app).get('/usuarios?perfil=PSICOLOGO'), id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: ID_PSI, nome: `Usuário Fictício ${ID_PSI}`, perfil: 'PSICOLOGO' },
      { id: ID_PSI_2, nome: `Usuário Fictício ${ID_PSI_2}`, perfil: 'PSICOLOGO' },
    ]);
  });

  it('para a Gestão o filtro é ignorado (lista completa, inclusive os psicólogos não ativos)', async () => {
    const res = await comToken(request(app).get('/usuarios?perfil=PSICOLOGO'), ID_GESTAO);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(banco.usuarios.length);
    expect(res.body.find((u) => u.id === ID_PSI_BLOQUEADO)).toMatchObject({
      perfil: 'PSICOLOGO',
      status: 'BLOQUEADO',
    });
  });
});

// ---------------------------------------------------------------------------
// RN24 — visibilidade da justificativa
// ---------------------------------------------------------------------------
describe('RN24 — observacao do encaminhamento ao psicólogo no GET /ocorrencias/{id}', () => {
  // [rótulo, usuário, JUST_B (PSI, registrado pelo Pedagógico), JUST_C (PSI_2, registrado pela Gestão)]
  const CASOS_O2 = [
    ['Gestão (registrou JUST_C)', ID_GESTAO, JUST_B, JUST_C],
    ['outra Gestão (não registrou nada)', ID_GESTAO_2, JUST_B, JUST_C],
    ['Pedagógico autor de JUST_B', ID_PEDAGOGICO, JUST_B, null],
    ['Pedagógico que não registrou', ID_PEDAGOGICO_2, null, null],
    ['psicólogo destinatário de JUST_B', ID_PSI, JUST_B, null],
    ['psicólogo destinatário de JUST_C', ID_PSI_2, null, JUST_C],
    ['Tutor responsável pelo acompanhamento', ID_TUTOR, null, null],
    ['Técnico-administrativo que registrou a ocorrência', ID_TECNICO, null, null],
  ];

  it.each(CASOS_O2)('%s', async (_rotulo, usuarioId, esperadoB, esperadoC) => {
    const res = await getDetalhe(O2, usuarioId);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBe(esperadoB);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBe(esperadoC);
    // O restante do encaminhamento vem normalmente (o fato do encaminhamento é visível).
    expect(res.body.encaminhamentos.find((e) => e.id === E_O2_PSI)).toMatchObject({
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuario: { id: ID_PSI, perfil: 'PSICOLOGO' },
      registradoPor: { id: ID_PEDAGOGICO },
    });
    // A observação de encaminhamentos a outros destinatários não muda.
    expect(observacaoDe(res.body, E_O2_TUTOR)).toBe(OBS_TUTOR);
    expect(observacaoDe(res.body, E_O2_GESTAO)).toBeNull();
  });

  it('o Professor que registrou o encaminhamento lê a justificativa; a de um encaminhamento posterior feito pela Gestão vem null', async () => {
    const encaminhado = await encaminhar(
      O1,
      { ...ENC_PSI, destinatarioUsuarioId: ID_PSI_2, observacao: JUST_C, responsavelAcompanhamentoId: ID_TUTOR },
      ID_GESTAO,
    );
    expect(encaminhado.status).toBe(201);
    const novoId = encaminhado.body.encaminhamentos.at(-1).id;

    const res = await getDetalhe(O1, ID_PROFESSOR);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O1_PSI)).toBe(JUST_A);
    expect(observacaoDe(res.body, novoId)).toBeNull();
    expect(observacaoDe(res.body, E_O1_GESTAO)).toBe(OBS_COMUM);
  });

  it('o Tutor que vê a ocorrência pela tutoria recebe null', async () => {
    // O1 envolve só o Beta (sem tutor): o Tutor 2 passa a ver ao virar tutor dele.
    banco.estudantes.find((e) => e.id === 2).tutor_id = ID_TUTOR_2;

    const res = await getDetalhe(O1, ID_TUTOR_2);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O1_PSI)).toBeNull();
    expect(observacaoDe(res.body, E_O1_GESTAO)).toBe(OBS_COMUM);
  });
});

describe('RN24 — a mesma regra em todas as respostas com o detalhe', () => {
  const COMUNICACAO = Object.freeze({
    destinatario: 'Família fictícia',
    meio: 'Presencial',
    descricao: 'Contato fictício.',
    dataHora: '2026-11-19T09:00:00-03:00',
  });

  it('201 do POST .../comunicacoes: null para o Tutor, justificativa para o psicólogo destinatário', async () => {
    const tutor = await comunicar(O2, COMUNICACAO, ID_TUTOR);
    expect(tutor.status).toBe(201);
    expect(observacaoDe(tutor.body, E_O2_PSI)).toBeNull();
    expect(observacaoDe(tutor.body, E_O2_PSI_2)).toBeNull();

    const psi = await comunicar(O2, COMUNICACAO, ID_PSI);
    expect(psi.status).toBe(201);
    expect(observacaoDe(psi.body, E_O2_PSI)).toBe(JUST_B);
    expect(observacaoDe(psi.body, E_O2_PSI_2)).toBeNull();
  });

  it('201 do POST .../providencias e 200 do PATCH .../status: null para o Tutor responsável', async () => {
    const providencia = await providenciar(O2, { descricao: 'Providência fictícia.' }, ID_TUTOR);
    expect(providencia.status).toBe(201);
    expect(observacaoDe(providencia.body, E_O2_PSI)).toBeNull();
    expect(observacaoDe(providencia.body, E_O2_PSI_2)).toBeNull();

    const encerramento = await encerrar(O2, ID_TUTOR);
    expect(encerramento.status).toBe(200);
    expect(encerramento.body.status).toBe('ENCERRADO');
    expect(observacaoDe(encerramento.body, E_O2_PSI)).toBeNull();
    expect(observacaoDe(encerramento.body, E_O2_TUTOR)).toBe(OBS_TUTOR);
  });

  it('200 do PATCH .../status pelo Pedagógico: lê só a que registrou', async () => {
    await providenciar(O2, { descricao: 'Providência fictícia.' }, ID_GESTAO);

    const res = await encerrar(O2, ID_PEDAGOGICO);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBe(JUST_B);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBeNull();
  });

  it('201 do POST .../encaminhamentos pelo Pedagógico que não registrou: null nas justificativas dos outros', async () => {
    const res = await encaminhar(O2, { destinatarioPerfil: 'GESTAO' }, ID_PEDAGOGICO_2);

    expect(res.status).toBe(201);
    expect(observacaoDe(res.body, E_O2_PSI)).toBeNull();
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBeNull();
  });

  it('201 do POST .../providencias pela Gestão: lê todas', async () => {
    const res = await providenciar(O2, { descricao: 'Providência fictícia.' }, ID_GESTAO_2);

    expect(res.status).toBe(201);
    expect(observacaoDe(res.body, E_O2_PSI)).toBe(JUST_B);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBe(JUST_C);
  });

  it('a lista (GET /ocorrencias) não traz encaminhamentos nem justificativas', async () => {
    const res = await getLista(ID_TUTOR);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Justificativa fictícia/);
  });

  it('o histórico (GET .../historico) não traz a justificativa', async () => {
    await encaminhar(O3, ENC_PSI, ID_GESTAO);

    const res = await comToken(request(app).get(`/ocorrencias/${O3}/historico`), ID_GESTAO);

    expect(res.status).toBe(200);
    expect(res.body.map((h) => h.descricao)).toContain('Destinatário: psicólogo escolar');
    expect(JSON.stringify(res.body)).not.toContain(ENC_PSI.observacao);
  });

  it('o relatório (GET /relatorios) só traz quantidades, sem a justificativa', async () => {
    const res = await comToken(
      request(app).get('/relatorios?tipo=periodo&dataInicio=2026-11-01&dataFim=2026-11-30'),
      ID_GESTAO,
    );

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/Justificativa fictícia/);
    expect(JSON.stringify(res.body)).not.toMatch(/PSICOLOGO/);
  });
});

describe('RN24 — a visibilidade segue o usuário (mudança de perfil, desativação e reativação)', () => {
  it('o psicólogo que mudou de perfil continua vendo a ocorrência e a justificativa feita a ele', async () => {
    banco.usuarios.find((u) => u.id === ID_PSI).perfil = 'PROFESSOR';

    const res = await getDetalhe(O2, ID_PSI);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBe(JUST_B);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBeNull();
  });

  it('desativado, perde o acesso; reativado, volta a ler a justificativa feita a ele', async () => {
    const psi = banco.usuarios.find((u) => u.id === ID_PSI);
    const tokenPsi = token(ID_PSI);

    psi.status = 'DESATIVADO';
    const desativado = await request(app).get(`/ocorrencias/${O2}`).set('Authorization', `Bearer ${tokenPsi}`);
    expect(desativado.status).toBe(401);

    psi.status = 'ATIVO';
    const reativado = await request(app).get(`/ocorrencias/${O2}`).set('Authorization', `Bearer ${tokenPsi}`);
    expect(reativado.status).toBe(200);
    expect(observacaoDe(reativado.body, E_O2_PSI)).toBe(JUST_B);
  });

  it('outro psicólogo (inclusive um novo) recebe null nos encaminhamentos feitos ao anterior', async () => {
    const res = await getDetalhe(O2, ID_PSI_2);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBeNull();
  });

  it('o autor que mudou de perfil continua lendo a justificativa que registrou', async () => {
    banco.usuarios.find((u) => u.id === ID_PEDAGOGICO).perfil = 'TUTOR';

    // Como Tutor, ele vê O2 só se a RN19 permitir: o Beta/Alfa não são tutorados
    // dele; por isso a ocorrência passa a ser encaminhada a ele também.
    banco.encaminhamentos.push({
      id: 50,
      ocorrencia_id: O2,
      destinatario_perfil: 'TUTOR',
      destinatario_usuario_id: ID_PEDAGOGICO,
      registrado_por_id: ID_GESTAO,
      data_hora: AGORA_BANCO,
      observacao: null,
    });

    const res = await getDetalhe(O2, ID_PEDAGOGICO);

    expect(res.status).toBe(200);
    expect(observacaoDe(res.body, E_O2_PSI)).toBe(JUST_B);
    expect(observacaoDe(res.body, E_O2_PSI_2)).toBeNull();
  });
});

describe('podeLerObservacaoEncaminhamento — ponto único da RN24', () => {
  const PSI_ENC = Object.freeze({
    destinatarioPerfil: 'PSICOLOGO',
    destinatarioUsuarioId: 20,
    registradoPorId: 30,
  });

  it.each(['TUTOR', 'EQUIPE_PEDAGOGICA', 'GESTAO'])(
    'destinatário %s: qualquer leitor lê',
    (destinatarioPerfil) => {
      expect(
        podeLerObservacaoEncaminhamento(
          { destinatarioPerfil, destinatarioUsuarioId: null, registradoPorId: 30 },
          { id: 99, perfil: 'PROFESSOR' },
        ),
      ).toBe(true);
    },
  );

  it.each([
    ['Gestão', { id: 99, perfil: 'GESTAO' }, true],
    ['destinatário (qualquer perfil atual)', { id: 20, perfil: 'PROFESSOR' }, true],
    ['autor (qualquer perfil atual)', { id: 30, perfil: 'TECNICO_ADMINISTRATIVO' }, true],
    ['Pedagógico que não registrou', { id: 99, perfil: 'PEDAGOGICO' }, false],
    ['outro psicólogo', { id: 98, perfil: 'PSICOLOGO' }, false],
    ['Tutor', { id: 97, perfil: 'TUTOR' }, false],
  ])('destinatário PSICOLOGO — %s', (_c, leitor, esperado) => {
    expect(podeLerObservacaoEncaminhamento(PSI_ENC, leitor)).toBe(esperado);
  });

  it.each([[undefined], [null], [{}], [{ id: 0, perfil: 'GESTAO' }], [{ id: '20', perfil: 'GESTAO' }]])(
    'sem leitor válido (%j) lança erro (falha fechada)',
    (leitor) => {
      expect(() => podeLerObservacaoEncaminhamento(PSI_ENC, leitor)).toThrow(/usuário autenticado/);
    },
  );
});

describe('Mensagens 400 de encaminhamento sem nomes técnicos de campo (RNF02, Issue #157)', () => {
  const NOMES_TECNICOS = /destinatarioUsuarioId|destinatarioPerfil|observacao|responsavelAcompanhamentoId/;

  it.each([
    ['tutor sem usuário (POST /ocorrencias)', mensagemTutorObrigatorio(2)],
    ['psicólogo sem usuário (POST /ocorrencias)', mensagemPsicologoObrigatorio(2)],
    ['psicólogo sem justificativa (POST /ocorrencias)', mensagemJustificativaPsicologoObrigatoria(2)],
    ['tutor sem usuário (POST .../encaminhamentos)', MENSAGEM_ENCAMINHAMENTO_TUTOR_OBRIGATORIO],
    ['psicólogo sem usuário (POST .../encaminhamentos)', MENSAGEM_ENCAMINHAMENTO_PSICOLOGO_OBRIGATORIO],
    ['psicólogo sem justificativa (POST .../encaminhamentos)', MENSAGEM_JUSTIFICATIVA_PSICOLOGO_OBRIGATORIA],
    ['responsável obrigatório (POST .../encaminhamentos)', MENSAGEM_RESPONSAVEL_OBRIGATORIO],
  ])('%s', (_caso, mensagem) => {
    expect(mensagem).not.toMatch(NOMES_TECNICOS);
  });

  it('as mensagens do POST /ocorrencias mantêm a posição do encaminhamento', () => {
    expect(mensagemTutorObrigatorio(2)).toMatch(/^No encaminhamento 2, /);
    expect(mensagemPsicologoObrigatorio(2)).toMatch(/^No encaminhamento 2, /);
    expect(mensagemJustificativaPsicologoObrigatoria(2)).toMatch(/^No encaminhamento 2, /);
  });
});

// QA da Issue #157: confere pela API (Supertest) o texto LITERAL de cada uma
// das 7 mensagens no caso certo — os testes acima comparam com as próprias
// constantes do service, então não pegariam um texto trocado por engano.
describe('API devolve as 7 mensagens 400 de encaminhamento com o texto revisado (RNF02, Issue #157)', () => {
  const NOMES_TECNICOS = /destinatarioUsuarioId|destinatarioPerfil|observacao|responsavelAcompanhamentoId/;

  /** 400 só com { erro } (sem `codigo`), texto exato, sem nome técnico e nada gravado. */
  function esperar400(res, texto) {
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: texto });
    expect(res.body.erro).not.toMatch(NOMES_TECNICOS);
    esperarNadaGravado();
  }

  describe('POST /ocorrencias (registro), no encaminhamento 2', () => {
    it('tutor sem usuário', async () => {
      const res = await postOcorrencia(
        corpoOcorrencia([{ destinatarioPerfil: 'GESTAO' }, { destinatarioPerfil: 'TUTOR' }]),
        ID_PROFESSOR,
      );
      esperar400(res, 'No encaminhamento 2, escolha o tutor que vai receber a ocorrência.');
    });

    it('psicólogo sem usuário', async () => {
      const res = await postOcorrencia(
        corpoOcorrencia([
          { destinatarioPerfil: 'GESTAO' },
          { destinatarioPerfil: 'PSICOLOGO', observacao: 'Justificativa fictícia.' },
        ]),
        ID_PROFESSOR,
      );
      esperar400(res, 'No encaminhamento 2, escolha o psicólogo escolar que vai receber a ocorrência.');
    });

    it.each([
      ['ausente', undefined],
      ['vazia', ''],
      ['só com espaços', '   '],
    ])('psicólogo com justificativa %s', async (_c, observacao) => {
      const item = { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI };
      if (observacao !== undefined) item.observacao = observacao;
      const res = await postOcorrencia(
        corpoOcorrencia([{ destinatarioPerfil: 'GESTAO' }, item]),
        ID_PROFESSOR,
      );
      esperar400(res, 'No encaminhamento 2, informe a justificativa do encaminhamento ao psicólogo escolar.');
    });
  });

  describe('POST /ocorrencias/{id}/encaminhamentos (encaminhamento posterior)', () => {
    it('tutor sem usuário', async () => {
      const res = await encaminhar(O3, { destinatarioPerfil: 'TUTOR' }, ID_GESTAO);
      esperar400(res, 'Escolha o tutor que vai receber a ocorrência.');
    });

    it('psicólogo sem usuário', async () => {
      const res = await encaminhar(
        O3,
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: null, observacao: 'Justificativa fictícia.' },
        ID_PEDAGOGICO,
      );
      esperar400(res, 'Escolha o psicólogo escolar que vai receber a ocorrência.');
    });

    it.each([
      ['vazia', ''],
      ['só com espaços', '  \t '],
    ])('psicólogo com justificativa %s', async (_c, observacao) => {
      const res = await encaminhar(
        O3,
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: ID_PSI_2, observacao },
        ID_GESTAO,
      );
      esperar400(res, 'Informe a justificativa do encaminhamento ao psicólogo escolar.');
    });

    it('responsável ausente em ocorrência aberta (mesmo texto que a tela já mostra)', async () => {
      const res = await encaminhar(O1, { destinatarioPerfil: 'EQUIPE_PEDAGOGICA' }, ID_PEDAGOGICO);
      esperar400(
        res,
        'Escolha o responsável pelo acompanhamento. Ele é obrigatório quando a ocorrência está "Aberto".',
      );
    });
  });

  describe('mensagens de formato do corpo continuam com o nome do campo (fora da Issue)', () => {
    it('registro: destinatarioUsuarioId com formato inválido', async () => {
      const res = await postOcorrencia(
        corpoOcorrencia([{ destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 'abc' }]),
        ID_PROFESSOR,
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        erro: 'No encaminhamento 1, informe destinatarioUsuarioId como número inteiro positivo (ou null).',
      });
    });

    it('registro: encaminhamento que não é objeto', async () => {
      const res = await postOcorrencia(corpoOcorrencia(['texto']), ID_PROFESSOR);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        erro: 'O encaminhamento 1 deve ser um objeto com destinatarioPerfil e, opcionalmente, destinatarioUsuarioId e observacao.',
      });
    });

    it('posterior: destinatarioUsuarioId com formato inválido', async () => {
      const res = await encaminhar(O3, { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 'abc' }, ID_GESTAO);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: 'Informe destinatarioUsuarioId como número inteiro positivo (ou null).' });
    });

    it('posterior: responsavelAcompanhamentoId com formato inválido', async () => {
      const res = await encaminhar(
        O1,
        { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', responsavelAcompanhamentoId: 'abc' },
        ID_GESTAO,
      );
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        erro: 'Informe responsavelAcompanhamentoId como número inteiro positivo (ou null).',
      });
    });
  });
});
