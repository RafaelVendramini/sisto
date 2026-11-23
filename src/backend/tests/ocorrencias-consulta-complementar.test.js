// QA da Issue #47 — casos complementares de GET /ocorrencias e
// GET /ocorrencias/{id} (RN01, RN17, RN19, RN20). Somente dados fictícios (RN05).
// Reaproveita o mesmo "banco" em memória de ocorrencias-consulta.test.js, que
// AVALIA o `where` real gerado por filtroVisibilidadeOcorrencias.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { criarBancoEmMemoria } from './apoio/bancoEmMemoria.js';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;
/** Consultas feitas DENTRO da transação ("modelo.operacao"), em ordem. */
let consultasTx;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

const DEFAULTS = {
  ocorrencia: () => ({ responsavel_acompanhamento_id: null, data_encerramento: null }),
  encaminhamento: () => ({ data_hora: new Date(), observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: new Date() }),
  logAuditoria: () => ({ data_hora: new Date() }),
};

// Motor do "banco" em memória: tests/apoio/bancoEmMemoria.js (Issue #129).
// Dentro da transação (clientMock(true)), cada operação é registrada em
// consultasTx ("modelo.operacao"), em ordem.
const { clientMock } = criarBancoEmMemoria({
  obterBanco: () => banco,
  padroes: DEFAULTS,
  limiteRelacoes: 2,
  aoOperar: (modelo, operacao, _args, emTransacao) => {
    if (emTransacao) consultasTx.push(`${modelo}.${operacao}`);
  },
});

vi.mock('../src/lib/prisma.js', () => ({
  default: new Proxy(
    {},
    {
      get(_alvo, prop) {
        if (prop === '$transaction') return (...a) => mocks.$transaction(...a);
        return clientMock(false)[prop];
      },
    },
  ),
}));

const { default: app } = await import('../src/app.js');
const {
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
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
const ID_TROCA_PENDENTE = 6;
const ID_TUTOR_NOVO = 7; // tutor atual do estudante que trocou de tutor
const ID_OUTRO_PROFESSOR = 8; // registra as ocorrências "de outro"

const ID_ESTUDANTE_TUTORADO = 1; // tutor atual: ID_TUTOR
const ID_ESTUDANTE_SEM_TUTOR = 2;
const ID_ESTUDANTE_EX_TUTORADO = 3; // era de ID_TUTOR; hoje é de ID_TUTOR_NOVO
const ID_ESTUDANTE_OUTRO = 4;

// Ocorrências (ver montarBanco): O1 registrada pelo professor; O2 de outro,
// sem vínculo; O3 encaminhada ao tutor; O4 acompanhada pelo tutor; O5 com
// tutorado atual do tutor (ocorrência "rica" do detalhe); O6 com o estudante
// que já foi tutorado dele; O7 registrada pelo tutor; O8 registrada pelo
// técnico-administrativo.
const TODAS = [7, 5, 2, 4, 3, 8, 1, 6]; // data desc; O3 e O4 empatam -> id desc

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
  const ocorrencia = (id, iso, profissional, extra = {}) => ({
    id,
    data_hora: data(iso),
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
    status: 'ABERTO',
    data_encerramento: null,
    ...extra,
  });
  const encaminhamento = (id, ocorrenciaId, perfil, usuarioId, extra = {}) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: usuarioId,
    registrado_por_id: ID_OUTRO_PROFESSOR,
    data_hora: data('2026-10-11T10:00:00.000Z'),
    observacao: null,
    ...extra,
  });

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_NOVO, 'TUTOR'),
      usuario(ID_OUTRO_PROFESSOR, 'PROFESSOR'),
    ],
    turmas: [
      { id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 },
      { id: 2, nome: '1º A', etapa: 'Ensino Médio', ano_letivo: 2026 },
    ],
    categorias: [
      { id: 1, nome: 'Indisciplina', descricao: 'Descrição fictícia da categoria.' },
      { id: 2, nome: 'Conflitos', descricao: null },
    ],
    estudantes: [
      { id: ID_ESTUDANTE_TUTORADO, nome_completo: 'Estudante Fictício Beta', codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: ID_ESTUDANTE_SEM_TUTOR, nome_completo: 'Estudante Fictício Alfa', codigo_escolar: 'TESTE-0002', turma_id: 2, tutor_id: null },
      { id: ID_ESTUDANTE_EX_TUTORADO, nome_completo: 'Estudante Fictício Gama', codigo_escolar: null, turma_id: 1, tutor_id: ID_TUTOR_NOVO },
      { id: ID_ESTUDANTE_OUTRO, nome_completo: 'Estudante Fictício Delta', codigo_escolar: 'TESTE-0004', turma_id: 2, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(1, '2026-10-01T10:00:00.000Z', ID_PROFESSOR),
      ocorrencia(2, '2026-10-05T10:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(3, '2026-10-03T10:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(4, '2026-10-03T10:00:00.000Z', ID_OUTRO_PROFESSOR, {
        responsavel_acompanhamento_id: ID_TUTOR,
        status: 'EM_ACOMPANHAMENTO',
      }),
      ocorrencia(5, '2026-10-08T12:00:00.000Z', ID_OUTRO_PROFESSOR, {
        turma_id: 1,
        categoria_id: 2,
        demais_envolvidos: 'Envolvidos fictícios.',
        testemunhas: 'Testemunhas fictícias.',
        providencias_imediatas: 'Providência imediata fictícia.',
        observacoes: 'Observação fictícia.',
        responsavel_acompanhamento_id: ID_PEDAGOGICO,
        status: 'EM_ACOMPANHAMENTO',
      }),
      ocorrencia(6, '2026-09-20T08:00:00.000Z', ID_OUTRO_PROFESSOR),
      ocorrencia(7, '2026-10-10T09:30:00.000Z', ID_TUTOR),
      ocorrencia(8, '2026-10-02T15:00:00.000Z', ID_TECNICO),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: 1, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: 2, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 3, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 4, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 5, estudante_id: ID_ESTUDANTE_TUTORADO },
      { ocorrencia_id: 5, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: 6, estudante_id: ID_ESTUDANTE_EX_TUTORADO },
      { ocorrencia_id: 7, estudante_id: ID_ESTUDANTE_OUTRO },
      { ocorrencia_id: 8, estudante_id: ID_ESTUDANTE_OUTRO },
    ],
    encaminhamentos: [
      encaminhamento(1, 2, 'GESTAO', null),
      encaminhamento(2, 3, 'TUTOR', ID_TUTOR),
      encaminhamento(3, 4, 'GESTAO', ID_GESTAO),
      encaminhamento(4, 5, 'EQUIPE_PEDAGOGICA', ID_PEDAGOGICO, { observacao: 'Observação fictícia do encaminhamento.' }),
      encaminhamento(5, 5, 'GESTAO', null),
      encaminhamento(6, 6, 'GESTAO', null),
    ],
    comunicacoes: [
      // Fora de ordem de propósito; 2 e 3 empatam na data (desempate por id).
      { id: 3, ocorrencia_id: 5, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato fictício 3.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
      { id: 1, ocorrencia_id: 5, destinatario: 'Família fictícia', meio: 'Presencial', descricao: 'Contato fictício 1.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-09T15:00:00.000Z') },
      { id: 2, ocorrencia_id: 5, destinatario: 'Rede de proteção fictícia', meio: 'E-mail', descricao: 'Contato fictício 2.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-09T14:00:00.000Z') },
      { id: 4, ocorrencia_id: 1, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Outra ocorrência.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-02T10:00:00.000Z') },
    ],
    providencias: [
      { id: 2, ocorrencia_id: 5, descricao: 'Providência fictícia 2.', registrado_por_id: ID_PEDAGOGICO, data_hora: data('2026-10-12T09:00:00.000Z') },
      { id: 1, ocorrencia_id: 5, descricao: 'Providência fictícia 1.', registrado_por_id: ID_GESTAO, data_hora: data('2026-10-11T09:00:00.000Z') },
    ],
    historicos: [],
    logs: [],
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  consultasTx = [];
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => {
    const copia = structuredClone(banco);
    try {
      return await operacao(clientMock(true));
    } catch (erro) {
      banco = copia; // rollback
      throw erro;
    }
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
  vi.useRealTimers();
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const getLista = (usuarioId) => {
  const req = request(app).get('/ocorrencias');
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
};
const getDetalhe = (id, usuarioId) => {
  const req = request(app).get(`/ocorrencias/${id}`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
};

/** Caminhos de chaves de e-mail/senha/status de usuário em qualquer nível (só o status da ocorrência é permitido). */
function chavesSensiveis(valor, caminho = '', raiz = true) {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => chavesSensiveis(v, `${caminho}[${i}]`, false));
  if (!valor || typeof valor !== 'object') return [];
  return Object.entries(valor).flatMap(([chave, v]) => {
    const aqui = `${caminho}.${chave}`;
    const proibida =
      ['email', 'senha_hash', 'senhaHash', 'trocaSenhaObrigatoria', 'troca_senha_obrigatoria'].includes(chave) ||
      (chave === 'status' && !raiz);
    return [...(proibida ? [aqui] : []), ...chavesSensiveis(v, aqui, false)];
  });
}

// ---------------------------------------------------------------------------
// QA #47 — casos complementares
// ---------------------------------------------------------------------------

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PERFIS_PRINCIPAIS = [ID_PROFESSOR, ID_TUTOR, ID_GESTAO, ID_PEDAGOGICO, ID_TECNICO];
const TODOS_OS_USUARIOS_ATIVOS = [...PERFIS_PRINCIPAIS, ID_TUTOR_NOVO, ID_OUTRO_PROFESSOR];
const CHAVES_ITEM_LISTA = [
  'id', 'dataHora', 'local', 'status', 'turma', 'categoria', 'profissionalResponsavel', 'estudantes',
].sort();

/** Acrescenta uma ocorrência fictícia ao banco e devolve o id. */
function novaOcorrencia(extra = {}, estudanteIds = [ID_ESTUDANTE_OUTRO]) {
  const id = Math.max(...banco.ocorrencias.map((o) => o.id)) + 1;
  banco.ocorrencias.push({
    id,
    data_hora: new Date('2026-10-15T10:00:00.000Z'),
    local: `Local fictício ${id}`,
    turma_id: 1,
    categoria_id: 1,
    descricao: `Descrição fictícia ${id}.`,
    demais_envolvidos: null,
    testemunhas: null,
    providencias_imediatas: null,
    observacoes: null,
    profissional_responsavel_id: ID_OUTRO_PROFESSOR,
    responsavel_acompanhamento_id: null,
    status: 'ABERTO',
    data_encerramento: null,
    ...extra,
  });
  for (const estudanteId of estudanteIds) banco.ocorrenciasEstudantes.push({ ocorrencia_id: id, estudante_id: estudanteId });
  return id;
}

function novoEncaminhamento(ocorrenciaId, perfil, usuarioId) {
  const id = Math.max(...banco.encaminhamentos.map((e) => e.id)) + 1;
  banco.encaminhamentos.push({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: perfil,
    destinatario_usuario_id: usuarioId,
    registrado_por_id: ID_OUTRO_PROFESSOR,
    data_hora: new Date('2026-10-15T11:00:00.000Z'),
    observacao: null,
  });
}

describe('QA #47 — sem duplicação quando várias condições da RN19 valem', () => {
  it('ocorrência que o tutor registrou, recebeu, acompanha e com 2 tutorados aparece UMA vez, com cada estudante uma vez', async () => {
    banco.estudantes.push({ id: 5, nome_completo: 'Estudante Fictício Épsilon', codigo_escolar: 'TESTE-0005', turma_id: 2, tutor_id: ID_TUTOR });
    const id = novaOcorrencia(
      { profissional_responsavel_id: ID_TUTOR, responsavel_acompanhamento_id: ID_TUTOR },
      [ID_ESTUDANTE_TUTORADO, 5],
    );
    novoEncaminhamento(id, 'TUTOR', ID_TUTOR);
    novoEncaminhamento(id, 'GESTAO', ID_GESTAO);

    const res = await getLista(ID_TUTOR);
    expect(res.status).toBe(200);
    const ids = res.body.itens.map((o) => o.id);
    expect(ids.filter((x) => x === id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    const item = res.body.itens.find((o) => o.id === id);
    expect(item.estudantes.map((e) => e.id).sort()).toEqual([ID_ESTUDANTE_TUTORADO, 5]);

    const detalhe = await getDetalhe(id, ID_TUTOR);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.estudantes).toHaveLength(2);
    expect(detalhe.body.encaminhamentos).toHaveLength(2);
  });

  it('nenhuma lista de nenhum usuário tem ids repetidos nem estudantes repetidos num item', async () => {
    for (const usuarioId of TODOS_OS_USUARIOS_ATIVOS) {
      const res = await getLista(usuarioId);
      const ids = res.body.itens.map((o) => o.id);
      expect(new Set(ids).size, `usuário ${usuarioId}`).toBe(ids.length);
      for (const item of res.body.itens) {
        const est = item.estudantes.map((e) => e.id);
        expect(new Set(est).size).toBe(est.length);
      }
    }
  });

  it('o tutor vê TODOS os estudantes da ocorrência, não só o tutorado dele (lista e detalhe)', async () => {
    const lista = await getLista(ID_TUTOR);
    const o5 = lista.body.itens.find((o) => o.id === 5);
    expect(o5.estudantes.map((e) => e.id)).toEqual([ID_ESTUDANTE_SEM_TUTOR, ID_ESTUDANTE_TUTORADO]);
    const detalhe = await getDetalhe(5, ID_TUTOR);
    expect(detalhe.body.estudantes.map((e) => e.id)).toEqual([ID_ESTUDANTE_SEM_TUTOR, ID_ESTUDANTE_TUTORADO]);
  });
});

describe('QA #47 — condições da RN19 que NÃO devem valer', () => {
  it('PEDAGOGICO e GESTAO como destinatários veem exatamente o mesmo conjunto (todas)', async () => {
    const pedagogico = (await getLista(ID_PEDAGOGICO)).body.itens.map((o) => o.id);
    const gestao = (await getLista(ID_GESTAO)).body.itens.map((o) => o.id);
    expect(pedagogico).toEqual(gestao);
    expect(gestao).toHaveLength(banco.ocorrencias.length);
  });

  it('PROFESSOR como responsável pelo acompanhamento NÃO passa a ver (condição exclusiva do Tutor)', async () => {
    const id = novaOcorrencia({ responsavel_acompanhamento_id: ID_PROFESSOR });
    expect((await getLista(ID_PROFESSOR)).body.itens.map((o) => o.id)).not.toContain(id);
    expect((await getDetalhe(id, ID_PROFESSOR)).status).toBe(404);
  });

  it('TECNICO_ADMINISTRATIVO "tutor" de um estudante (dado fictício inconsistente) NÃO vê pela tutoria', async () => {
    banco.estudantes.push({ id: 6, nome_completo: 'Estudante Fictício Zeta', codigo_escolar: null, turma_id: 1, tutor_id: ID_TECNICO });
    const id = novaOcorrencia({}, [6]);
    expect((await getDetalhe(id, ID_TECNICO)).status).toBe(404);
  });

  it('encaminhamento com perfil TUTOR para OUTRO tutor não dá visibilidade ao tutor do teste', async () => {
    const id = novaOcorrencia();
    novoEncaminhamento(id, 'TUTOR', ID_TUTOR_NOVO);
    expect((await getDetalhe(id, ID_TUTOR)).status).toBe(404);
    expect((await getDetalhe(id, ID_TUTOR_NOVO)).status).toBe(200);
  });

  it('encaminhamento ao perfil GESTAO sem usuário não dá visibilidade a nenhum perfil restrito', async () => {
    const id = novaOcorrencia();
    novoEncaminhamento(id, 'GESTAO', null);
    for (const usuarioId of [ID_PROFESSOR, ID_TUTOR, ID_TECNICO, ID_TUTOR_NOVO]) {
      expect((await getDetalhe(id, usuarioId)).status, `usuário ${usuarioId}`).toBe(404);
    }
  });

  it('ocorrência só com estudante sem tutor não aparece para nenhum tutor', async () => {
    const id = novaOcorrencia({}, [ID_ESTUDANTE_SEM_TUTOR]);
    for (const usuarioId of [ID_TUTOR, ID_TUTOR_NOVO]) {
      expect((await getLista(usuarioId)).body.itens.map((o) => o.id)).not.toContain(id);
    }
  });

  it('tutor que vira PROFESSOR (perfil lido do banco) perde as condições de tutor', async () => {
    banco.usuarios.find((u) => u.id === ID_TUTOR).perfil = 'PROFESSOR';
    // Continua vendo só a que registrou (O7) e a encaminhada a ele (O3).
    expect((await getLista(ID_TUTOR)).body.itens.map((o) => o.id)).toEqual([7, 3]);
  });
});

describe('QA #47 — lista vazia e coerência lista x detalhe', () => {
  it('sem nenhuma ocorrência no banco: 200 [] para os 5 perfis', async () => {
    banco.ocorrencias = [];
    banco.ocorrenciasEstudantes = [];
    banco.encaminhamentos = [];
    banco.comunicacoes = [];
    banco.providencias = [];
    for (const usuarioId of PERFIS_PRINCIPAIS) {
      const res = await getLista(usuarioId);
      expect(res.status).toBe(200);
      expect(res.body.itens).toEqual([]);
    }
  });

  it('usuário sem nenhuma ocorrência visível recebe 200 [] (não 404)', async () => {
    banco.ocorrencias = banco.ocorrencias.filter((o) => o.profissional_responsavel_id !== ID_PROFESSOR);
    const res = await getLista(ID_PROFESSOR);
    expect(res.status).toBe(200);
    expect(res.body.itens).toEqual([]);
  });

  for (const usuarioId of TODOS_OS_USUARIOS_ATIVOS) {
    it(`usuário ${usuarioId}: todo id da lista abre 200 no detalhe e todo id fora dela dá 404`, async () => {
      const lista = await getLista(usuarioId);
      const visiveis = new Set(lista.body.itens.map((o) => o.id));
      const maxId = Math.max(...banco.ocorrencias.map((o) => o.id));
      for (let id = 1; id <= maxId + 1; id += 1) {
        const res = await getDetalhe(id, usuarioId);
        expect(res.status, `ocorrência ${id}`).toBe(visiveis.has(id) ? 200 : 404);
        if (visiveis.has(id)) {
          const item = lista.body.itens.find((o) => o.id === id);
          // O item resumido é coerente com o detalhe.
          expect(res.body.dataHora).toBe(item.dataHora);
          expect(res.body.local).toBe(item.local);
          expect(res.body.status).toBe(item.status);
          expect(res.body.turma).toEqual(item.turma);
          expect(res.body.categoria).toEqual(item.categoria);
          expect(res.body.profissionalResponsavel).toEqual(item.profissionalResponsavel);
          expect(res.body.estudantes.map((e) => ({ id: e.id, nomeCompleto: e.nomeCompleto }))).toEqual(item.estudantes);
        }
      }
    });
  }
});

describe('QA #47 — formato e dados expostos (RN01, RN17, RN20)', () => {
  for (const usuarioId of PERFIS_PRINCIPAIS) {
    it(`usuário ${usuarioId}: itens da lista só com as chaves resumidas, datas ISO UTC e sem dados sensíveis`, async () => {
      const res = await getLista(usuarioId);
      expect(res.body.itens.length).toBeGreaterThan(0);
      for (const item of res.body.itens) {
        expect(Object.keys(item).sort()).toEqual(CHAVES_ITEM_LISTA);
        expect(item.dataHora).toMatch(ISO_UTC);
        expect(Object.keys(item.profissionalResponsavel).sort()).toEqual(['id', 'nome']);
        for (const e of item.estudantes) expect(Object.keys(e).sort()).toEqual(['id', 'nomeCompleto']);
      }
      expect(chavesSensiveis(res.body.itens.map(({ status: _s, ...resto }) => resto))).toEqual([]);
      const texto = JSON.stringify(res.body);
      expect(texto).not.toMatch(/Descrição fictícia|TESTE-000|sisto\.exemplo|hash-ficticio/);
    });
  }

  it('todas as datas do detalhe (fato, encaminhamentos, comunicações, providências) em ISO 8601 UTC', async () => {
    const res = await getDetalhe(5, ID_GESTAO);
    const datas = [
      res.body.dataHora,
      ...res.body.encaminhamentos.map((e) => e.dataHora),
      ...res.body.comunicacoes.map((c) => c.dataHora),
      ...res.body.providencias.map((p) => p.dataHora),
    ];
    expect(datas.length).toBeGreaterThan(5);
    for (const d of datas) expect(d).toMatch(ISO_UTC);
  });

  it('dataEncerramento de ocorrência encerrada sai em ISO UTC', async () => {
    const id = novaOcorrencia({ status: 'ENCERRADO', data_encerramento: new Date('2026-10-16T18:00:00.000Z') });
    const res = await getDetalhe(id, ID_GESTAO);
    expect(res.body.status).toBe('ENCERRADO');
    expect(res.body.dataEncerramento).toBe('2026-10-16T18:00:00.000Z');
  });

  for (const usuarioId of [ID_PEDAGOGICO, ID_TUTOR]) {
    it(`usuário ${usuarioId} (não Gestão): estudantes do detalhe com exatamente id, nomeCompleto e turma`, async () => {
      const res = await getDetalhe(5, usuarioId);
      for (const e of res.body.estudantes) expect(Object.keys(e).sort()).toEqual(['id', 'nomeCompleto', 'turma']);
      expect(JSON.stringify(res.body)).not.toMatch(/TESTE-000/);
    });
  }

  it('Gestão: estudantes de turmas diferentes da turma da ocorrência mantêm cada um a sua turma e o seu código', async () => {
    const id = novaOcorrencia({ turma_id: 2 }, [ID_ESTUDANTE_TUTORADO, ID_ESTUDANTE_OUTRO]);
    const res = await getDetalhe(id, ID_GESTAO);
    expect(res.body.turma.id).toBe(2);
    expect(res.body.estudantes.map((e) => [e.id, e.turma.id, e.codigoEscolar])).toEqual([
      [ID_ESTUDANTE_TUTORADO, 1, 'TESTE-0001'],
      [ID_ESTUDANTE_OUTRO, 2, 'TESTE-0004'],
    ]);
  });

  it('comunicações e providências: registradoPor só com id e nome (sem e-mail/perfil/status)', async () => {
    const res = await getDetalhe(5, ID_TUTOR);
    for (const r of [...res.body.comunicacoes, ...res.body.providencias]) {
      expect(Object.keys(r.registradoPor).sort()).toEqual(['id', 'nome']);
    }
  });

  it('ocorrência sem responsável pelo acompanhamento e com encaminhamento sem usuário: nulls explícitos', async () => {
    const res = await getDetalhe(2, ID_GESTAO);
    expect(res.body.responsavelAcompanhamento).toBeNull();
    expect(res.body.encaminhamentos[0].destinatarioUsuario).toBeNull();
  });
});

describe('QA #47 — caminhos e ids no detalhe', () => {
  it('/ocorrencias/1/ (barra final) responde igual a /ocorrencias/1', async () => {
    const res = await request(app).get('/ocorrencias/1/').set('Authorization', `Bearer ${token(ID_PROFESSOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('query string no detalhe é ignorada', async () => {
    const res = await request(app).get('/ocorrencias/1?perfil=GESTAO&id=2').set('Authorization', `Bearer ${token(ID_PROFESSOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.estudantes[0]).not.toHaveProperty('codigoEscolar');
  });

  it('/ocorrencias/ (barra final) é a lista', async () => {
    const res = await request(app).get('/ocorrencias/').set('Authorization', `Bearer ${token(ID_PROFESSOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.itens.map((o) => o.id)).toEqual([1]);
  });

  for (const id of ['%201', '1%20', '+1', '%EF%BC%91', '0x1', 'null', 'undefined', '1,2']) {
    it(`id "${id}" responde 400`, async () => {
      const res = await request(app).get(`/ocorrencias/${id}`).set('Authorization', `Bearer ${token(ID_GESTAO)}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
    });
  }

  it('maior Int do PostgreSQL inexistente responde 404 (não 500)', async () => {
    const res = await getDetalhe('2147483647', ID_GESTAO);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
  });

  // GET /1/historico passou a existir na #83 (testado em ocorrencias-historico.test.js).
  it('subcaminhos GET não implementados (/1/comunicacoes, /1/providencias) dão 404, não 500', async () => {
    for (const caminho of ['/ocorrencias/1/comunicacoes', '/ocorrencias/1/providencias']) {
      const res = await request(app).get(caminho).set('Authorization', `Bearer ${token(ID_GESTAO)}`);
      expect(res.status, caminho).toBe(404);
    }
  });
});

describe('QA #47 — usuário bloqueado e sessão', () => {
  it('TUTOR bloqueado recebe 401 também no detalhe, sem consultar ocorrências', async () => {
    const t = token(ID_TUTOR);
    banco.usuarios.find((u) => u.id === ID_TUTOR).status = 'BLOQUEADO';
    const res = await request(app).get('/ocorrencias/7').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('destinatário/tutor bloqueado não muda o que os outros veem', async () => {
    banco.usuarios.find((u) => u.id === ID_TUTOR).status = 'BLOQUEADO';
    expect((await getLista(ID_GESTAO)).body.itens.map((o) => o.id)).toEqual(TODAS);
    const detalhe = await getDetalhe(3, ID_GESTAO);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.encaminhamentos[0].destinatarioUsuario.id).toBe(ID_TUTOR);
  });

  it('token de usuário inexistente responde 401', async () => {
    const t = jwt.sign({ id: 999, perfil: 'GESTAO' }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
    const res = await request(app).get('/ocorrencias').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
  });

  it('métodos não previstos em /ocorrencias/{id} (DELETE, PATCH) não respondem 2xx nem 500', async () => {
    for (const metodo of ['delete', 'patch']) {
      const res = await request(app)[metodo]('/ocorrencias/1').set('Authorization', `Bearer ${token(ID_GESTAO)}`);
      expect(res.status, metodo).toBe(404);
    }
    expect(banco.ocorrencias).toHaveLength(8);
  });
});

describe('QA #47 — POST /ocorrencias inalterado', () => {
  it('201 do POST feito por TUTOR: aparece no topo da lista dele e no detalhe com o mesmo corpo + listas vazias', async () => {
    const post = await request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token(ID_TUTOR)}`)
      .send({
        dataHora: new Date(Date.now() - 60_000).toISOString(),
        local: 'Quadra fictícia',
        turmaId: 2,
        categoriaId: 2,
        descricao: 'Descrição objetiva fictícia.',
        estudanteIds: [ID_ESTUDANTE_OUTRO],
        encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }],
      });
    expect(post.status).toBe(201);
    expect(post.body).not.toHaveProperty('comunicacoes');
    expect(post.body).not.toHaveProperty('providencias');
    const lista = await getLista(ID_TUTOR);
    expect(lista.body.itens[0].id).toBe(post.body.id);
    const detalhe = await getDetalhe(post.body.id, ID_TUTOR);
    expect(detalhe.body).toEqual({ ...post.body, comunicacoes: [], providencias: [] });
    // Professor que não participa não vê.
    expect((await getDetalhe(post.body.id, ID_PROFESSOR)).status).toBe(404);
  });
});
