// Testes complementares (QA) de POST /ocorrencias/{id}/providencias (Issue #81,
// RN04, RN08, RN17, RN19, RN22, RNF04) — somente dados fictícios (RN05).
// Reaproveitam o mesmo "banco" em memória de ocorrencias-providencia.test.js
// (avalia o `where` gerado pelo service; a transação faz rollback na falha) e
// cobrem bordas não exercitadas lá: ordem 404 x 403 x 409 com outras
// combinações, perfil lido do banco (não do JWT), usuário inativo, corpo não
// JSON e grande demais, espaços Unicode, ausência de eco do texto nos erros e
// repetição da transação até a última tentativa.
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
  MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA,
  MENSAGEM_CORPO_PROVIDENCIA_INVALIDO,
  MENSAGEM_DESCRICAO_OBRIGATORIA,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  MENSAGEM_PROVIDENCIA_SEM_PERMISSAO,
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
  PERFIS_PROVIDENCIA,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  mensagemTextoLongo,
  registrarProvidencia,
  validarProvidencia,
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

// O ID_TUTOR NÃO vê as ocorrências 1 e 2. Vê a 3 a 9, cada uma por UMA
// condição da RN19; só é o responsável pelo acompanhamento da 3 e da 6.
const O_ABERTA = 1; // registrada pelo Professor, sem vínculo com o ID_TUTOR
const O_ACOMPANHAMENTO = 2; // registrada pelo Professor; responsável: ID_TUTOR_2; já tem providência
const O_ENCERRADA = 3; // responsável: ID_TUTOR (ele a vê por ser o responsável)
const O_TUTOR_REGISTROU = 4; // ABERTO, profissional responsável: ID_TUTOR
const O_TUTOR_DESTINATARIO = 5; // EM_ACOMPANHAMENTO, encaminhada ao ID_TUTOR; responsável: ID_GESTAO
const O_TUTOR_RESPONSAVEL = 6; // EM_ACOMPANHAMENTO, responsável: ID_TUTOR
const O_TUTOR_TUTORADO = 7; // EM_ACOMPANHAMENTO, envolve tutorado do ID_TUTOR; responsável: ID_PEDAGOGICO
const O_ENCERRADA_TUTORADO = 8; // ENCERRADO, envolve tutorado do ID_TUTOR; responsável: ID_TUTOR_2

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
  const encerrada = { data_encerramento: data('2026-10-20T10:00:00.000Z') };

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
    ],
    comunicacoes: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício anterior.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-03T14:00:00.000Z') },
    ],
    providencias: [
      { id: 1, ocorrencia_id: O_ACOMPANHAMENTO, descricao: 'Providência fictícia anterior.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-04T09:00:00.000Z') },
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

const providenciar = (ocorrenciaId, corpo, usuarioId = ID_GESTAO) => {
  const req = request(app).post(`/ocorrencias/${ocorrenciaId}/providencias`);
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

/** Corpo válido fictício. */
const CORPO = Object.freeze({
  descricao: 'Conversa fictícia com o estudante e orientação sobre a convivência.',
});
const corpo = (extra = {}) => ({ ...CORPO, ...extra });

const tokenComPerfil = (id, perfil) =>
  jwt.sign({ id, perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });

// ---------------------------------------------------------------------------
// Autenticação: perfil e status vêm do banco, não do token
// ---------------------------------------------------------------------------
describe('QA — autenticação e perfil (RN01/RF14, RN09)', () => {
  it('Professor com JWT que alega GESTAO recebe 403 (perfil lido do banco)', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
      .set('Authorization', `Bearer ${tokenComPerfil(ID_PROFESSOR, 'GESTAO')}`)
      .send(corpo());
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_PERFIL_SEM_PERMISSAO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('Tutor não responsável com JWT que alega PEDAGOGICO continua recebendo 403', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_TUTOR_TUTORADO}/providencias`)
      .set('Authorization', `Bearer ${tokenComPerfil(ID_TUTOR, 'PEDAGOGICO')}`)
      .send(corpo());
    expect(res.status).toBe(403);
    esperarNadaGravado();
  });

  it('usuário inativo (Gestão) recebe 401 sem gravar', async () => {
    banco.usuarios.find((u) => u.id === ID_GESTAO).status = 'INATIVO';
    bancoInicial = structuredClone(banco);
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_GESTAO);
    expect(res.status).toBe(401);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('token com assinatura inválida recebe 401', async () => {
    const falso = jwt.sign({ id: ID_GESTAO, perfil: 'GESTAO' }, 'outro-segredo-ficticio-com-mais-de-32-caracteres', {
      algorithm: 'HS256',
      expiresIn: '8h',
    });
    const res = await request(app)
      .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
      .set('Authorization', `Bearer ${falso}`)
      .send(corpo());
    expect(res.status).toBe(401);
    esperarNadaGravado();
  });

  it('troca de senha pendente vem antes do 400 do id e do corpo', async () => {
    const res = await providenciar('abc', {}, ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA });
  });

  it('Professor definido (por dado inconsistente) como responsável pelo acompanhamento continua com 403 (RN22)', async () => {
    ocorrenciaNoBanco(O_ACOMPANHAMENTO).responsavel_acompanhamento_id = ID_PROFESSOR;
    bancoInicial = structuredClone(banco);
    const res = await providenciar(O_ACOMPANHAMENTO, corpo(), ID_PROFESSOR);
    expect(res.status).toBe(403);
    esperarNadaGravado();
  });
});

// ---------------------------------------------------------------------------
// Ordem 404 -> 403 -> 409 (decisão do Rafael, RN19/RN22)
// ---------------------------------------------------------------------------
describe('QA — ordem das respostas de erro', () => {
  it('Tutor que não vê uma ocorrência ENCERRADO recebe 404 (não 409): o status não vaza', async () => {
    const res = await providenciar(O_ENCERRADA, corpo(), ID_TUTOR_2);
    const inexistente = await providenciar(ID_INEXISTENTE, corpo(), ID_TUTOR_2);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(res.body).toEqual(inexistente.body);
    esperarNadaGravado();
  });

  it('Tutor que não vê uma ocorrência ABERTO recebe 404 (não 409)', async () => {
    const res = await providenciar(O_TUTOR_REGISTROU, corpo(), ID_TUTOR_2);
    expect(res.status).toBe(404);
    esperarNadaGravado();
  });

  it('Tutor responsável por uma ocorrência ABERTO (dado inconsistente) passa da permissão e recebe 409 de aberta', async () => {
    ocorrenciaNoBanco(O_ABERTA).responsavel_acompanhamento_id = ID_TUTOR;
    bancoInicial = structuredClone(banco);
    const res = await providenciar(O_ABERTA, corpo(), ID_TUTOR);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA, codigo: CODIGOS_ERRO.OCORRENCIA_ABERTA });
    esperarNadaGravado();
  });

  it('Tutor que vê por várias condições e é o responsável registra (201)', async () => {
    // O_TUTOR_TUTORADO: tutora um estudante envolvido; passa a ser também o responsável.
    ocorrenciaNoBanco(O_TUTOR_TUTORADO).responsavel_acompanhamento_id = ID_TUTOR;
    const res = await providenciar(O_TUTOR_TUTORADO, corpo(), ID_TUTOR);
    expect(res.status).toBe(201);
    expect(banco.providencias.at(-1)).toMatchObject({ ocorrencia_id: O_TUTOR_TUTORADO, registrado_por_id: ID_TUTOR });
  });

  it('Tutor destinatário de encaminhamento, mas não responsável, recebe 403 mesmo com a ocorrência ENCERRADO', async () => {
    ocorrenciaNoBanco(O_TUTOR_DESTINATARIO).status = 'ENCERRADO';
    bancoInicial = structuredClone(banco);
    const res = await providenciar(O_TUTOR_DESTINATARIO, corpo(), ID_TUTOR);
    expect(res.status).toBe(403);
    esperarNadaGravado();
  });

  it('as respostas de erro não ecoam o texto da providência nem dados da ocorrência', async () => {
    const texto = 'Texto fictício sigiloso da providência QA-123.';
    const respostas = [
      await providenciar(O_ABERTA, { descricao: texto }, ID_TUTOR), // 404
      await providenciar(O_TUTOR_TUTORADO, { descricao: texto }, ID_TUTOR), // 403
      await providenciar(O_ENCERRADA, { descricao: texto }, ID_GESTAO), // 409
    ];
    expect(respostas.map((r) => r.status)).toEqual([404, 403, 409]);
    expect(respostas[2].body.codigo).toBe(CODIGOS_ERRO.OCORRENCIA_ENCERRADA);
    for (const r of respostas) {
      // Só o 409 traz, além de `erro`, o código estável (#72, D1); o 403 por
      // perfil (RN22) continua sem código.
      expect(Object.keys(r.body)).toEqual(r.status === 409 ? ['erro', 'codigo'] : ['erro']);
      expect(JSON.stringify(r.body)).not.toMatch(/QA-123|Fictíci|TESTE-|Local fictício/);
    }
  });
});

// ---------------------------------------------------------------------------
// Corpo: formato, espaços Unicode, tamanho
// ---------------------------------------------------------------------------
describe('QA — validação do corpo', () => {
  it('corpo enviado como text/plain (não JSON) responde 400 de corpo inválido, sem banco', async () => {
    // Sem parser para text/plain, req.body chega indefinido (Express 5).
    const res = await request(app)
      .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .set('Content-Type', 'text/plain')
      .send('descricao=Texto fictício');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_CORPO_PROVIDENCIA_INVALIDO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('sem corpo responde 400', async () => {
    const res = await request(app)
      .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`);
    expect(res.status).toBe(400);
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('JSON que é string, número ou null responde 400 sem banco', async () => {
    for (const bruto of ['"texto"', '42', 'null']) {
      const res = await request(app)
        .post(`/ocorrencias/${O_ACOMPANHAMENTO}/providencias`)
        .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
        .set('Content-Type', 'application/json')
        .send(bruto);
      expect(res.status, bruto).toBe(400);
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
    esperarNadaGravado();
  });

  it('descricao só com espaços Unicode (NBSP, em space, ideográfico, BOM) responde 400', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: '  　﻿\r\n' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_DESCRICAO_OBRIGATORIA });
    esperarNadaGravado();
  });

  it('5000 caracteres com U+0000 responde 400 (nulo recusado mesmo dentro do limite)', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: `${'x'.repeat(4999)}\u0000` });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
    esperarNadaGravado();
  });

  it('5001 caracteres responde 400 em qualquer status e para qualquer perfil (corpo antes do banco)', async () => {
    const longo = { descricao: 'y'.repeat(5001) };
    const respostas = [
      await providenciar(O_TUTOR_RESPONSAVEL, longo, ID_TUTOR),
      await providenciar(O_ABERTA, longo, ID_PEDAGOGICO),
      await providenciar(ID_INEXISTENTE, longo, ID_GESTAO),
    ];
    expect(respostas.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('corpo muito grande (acima do limite de 512 kB do express.json — Issue #128) responde 413, não 500', async () => {
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: 'z'.repeat(600_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ erro: 'O corpo da requisição passa do tamanho máximo permitido.' });
    esperarNadaGravado();
  });

  it('preserva quebras de linha e espaços internos (só as pontas são removidas)', async () => {
    const texto = 'Primeira ação fictícia.\n\n  Segunda ação fictícia.';
    const res = await providenciar(O_ACOMPANHAMENTO, { descricao: `\n ${texto} \t` });
    expect(res.status).toBe(201);
    expect(banco.providencias.at(-1).descricao).toBe(texto);
    expect(res.body.providencias.at(-1).descricao).toBe(texto);
  });

  it('5000 caracteres do Pedagógico e do Tutor responsável também são aceitos (201)', async () => {
    const r1 = await providenciar(O_TUTOR_TUTORADO, { descricao: 'p'.repeat(5000) }, ID_PEDAGOGICO);
    const r2 = await providenciar(O_TUTOR_RESPONSAVEL, { descricao: 't'.repeat(5000) }, ID_TUTOR);
    expect([r1.status, r2.status]).toEqual([201, 201]);
  });
});

// ---------------------------------------------------------------------------
// Sistema define autoria e data; a providência não mexe em outros dados
// ---------------------------------------------------------------------------
describe('QA — autoria, data e efeitos colaterais', () => {
  it('não altera encaminhamentos, comunicações, estudantes, ocorrências nem providências anteriores', async () => {
    const fotografar = () =>
      structuredClone({
        encaminhamentos: banco.encaminhamentos,
        comunicacoes: banco.comunicacoes,
        ocorrenciasEstudantes: banco.ocorrenciasEstudantes,
        providencia1: banco.providencias[0],
        ocorrencias: banco.ocorrencias,
      });
    const antes = fotografar();
    const res = await providenciar(O_ACOMPANHAMENTO, corpo({ encaminhamentos: [], estudanteIds: [1] }));
    expect(res.status).toBe(201);
    expect(fotografar()).toEqual(antes);
  });

  it('o create da providência recebe só ocorrencia_id, descricao e registrado_por_id (data_hora fica para o banco)', async () => {
    const creates = [];
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const tx = clientMock();
      const original = tx.providencia.create;
      tx.providencia.create = async (args) => {
        creates.push(args.data);
        return original(args);
      };
      return operacao(tx);
    });
    await providenciar(
      O_ACOMPANHAMENTO,
      corpo({ dataHora: '2020-01-01T00:00:00Z', data_hora: '2020-01-01T00:00:00Z', registradoPorId: 1 }),
      ID_PEDAGOGICO,
    );
    expect(creates).toEqual([
      { ocorrencia_id: O_ACOMPANHAMENTO, descricao: CORPO.descricao, registrado_por_id: ID_PEDAGOGICO },
    ]);
  });

  it('histórico e auditoria são gravados uma vez por providência, dentro do mesmo $transaction', async () => {
    let gravacoesNaTransacao = null;
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const resultado = await operacao(clientMock());
      gravacoesNaTransacao = [...escritas];
      return resultado;
    });
    await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(gravacoesNaTransacao).toEqual(
      expect.arrayContaining(['providencia.create', 'historicoOcorrencia.create', 'logAuditoria.create']),
    );
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
    expect(banco.historicos[0]).toMatchObject({ acao: 'providência registrada', descricao: null });
  });
});

// ---------------------------------------------------------------------------
// Repetição da transação (P2034)
// ---------------------------------------------------------------------------
describe('QA — conflito concorrente', () => {
  it('dois P2034 seguidos e sucesso na terceira tentativa: 201 com uma providência só', async () => {
    mocks.$transaction.mockRejectedValueOnce(erroPrisma('P2034')).mockRejectedValueOnce(erroPrisma('P2034'));
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(3);
    expect(banco.providencias).toHaveLength(2);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('P2034 após gravação parcial (rollback) e sucesso: sem duplicar providência, histórico ou auditoria', async () => {
    mocks.$transaction.mockImplementationOnce(async (operacao) => {
      const copia = structuredClone(banco);
      const tx = clientMock();
      tx.logAuditoria.create = async () => {
        throw erroPrisma('P2034');
      };
      try {
        return await operacao(tx);
      } catch (erro) {
        banco = copia;
        throw erro;
      }
    });
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(201);
    expect(mocks.$transaction).toHaveBeenCalledTimes(2);
    expect(banco.providencias).toHaveLength(2);
    expect(banco.historicos).toHaveLength(1);
    expect(banco.logs).toHaveLength(1);
  });

  it('409 por conflito esgotado tem mensagem diferente das de status e só o campo erro', async () => {
    mocks.$transaction.mockRejectedValue(erroPrisma('P2034'));
    const res = await providenciar(O_ACOMPANHAMENTO, corpo());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_CONFLITO_CONCORRENTE_PROVIDENCIA, codigo: CODIGOS_ERRO.CONFLITO_CONCORRENTE });
    expect(res.body.erro).not.toBe(MENSAGEM_OCORRENCIA_ABERTA_PROVIDENCIA);
    expect(res.body.erro).not.toBe(MENSAGEM_OCORRENCIA_ENCERRADA_PROVIDENCIA);
  });

  it('P2034 e, na repetição, o Tutor deixou de ser responsável e de ver a ocorrência: 404', async () => {
    mocks.$transaction.mockImplementationOnce(async () => {
      Object.assign(ocorrenciaNoBanco(O_TUTOR_RESPONSAVEL), { responsavel_acompanhamento_id: ID_PEDAGOGICO });
      throw erroPrisma('P2034');
    });
    const res = await providenciar(O_TUTOR_RESPONSAVEL, corpo(), ID_TUTOR);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    expect(banco.providencias).toHaveLength(1);
  });
});
