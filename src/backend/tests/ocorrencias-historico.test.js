// Testes de GET /ocorrencias/{id}/historico (Issue #83, RF12, UC03 passo 3,
// RN01, RN08, RN19) — somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por um "banco" em
// memória que AVALIA o `where` gerado pelo service (mesmo modelo de
// ocorrencias-comunicacao.test.js). Cada transação do mock tem o seu "now()"
// (um minuto depois da anterior), como o PostgreSQL: os registros gravados
// na mesma transação recebem a mesma data/hora e só o id os desempata.
// Providência (#81) e encerramento (#82) ainda não existem nesta branch: os
// registros de histórico dessas ações são inseridos diretamente no banco em
// memória, com os textos fixos da Seção 12 do SSD 1.8.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

let banco;
/** Consultas feitas DENTRO da transação ("modelo.operacao"), em ordem. */
let consultasTx;

// ---------------------------------------------------------------------------
// "Banco" em memória com avaliação de where/select/orderBy
// ---------------------------------------------------------------------------

const TABELA = {
  usuario: 'usuarios',
  turma: 'turmas',
  categoria: 'categorias',
  estudante: 'estudantes',
  ocorrencia: 'ocorrencias',
  ocorrenciaEstudante: 'ocorrenciasEstudantes',
  encaminhamento: 'encaminhamentos',
  comunicacao: 'comunicacoes',
  providencia: 'providencias',
  historicoOcorrencia: 'historicos',
  logAuditoria: 'logs',
};

const RELACOES = {
  ocorrencia: {
    turma: ['um', 'turma', 'turma_id'],
    categoria: ['um', 'categoria', 'categoria_id'],
    profissional_responsavel: ['um', 'usuario', 'profissional_responsavel_id'],
    responsavel_acompanhamento: ['um', 'usuario', 'responsavel_acompanhamento_id'],
    estudantes: ['muitos', 'ocorrenciaEstudante', 'ocorrencia_id'],
    encaminhamentos: ['muitos', 'encaminhamento', 'ocorrencia_id'],
  },
  ocorrenciaEstudante: {
    ocorrencia: ['um', 'ocorrencia', 'ocorrencia_id'],
    estudante: ['um', 'estudante', 'estudante_id'],
  },
  estudante: {
    turma: ['um', 'turma', 'turma_id'],
    tutor: ['um', 'usuario', 'tutor_id'],
  },
  encaminhamento: {
    destinatario_usuario: ['um', 'usuario', 'destinatario_usuario_id'],
    registrado_por: ['um', 'usuario', 'registrado_por_id'],
  },
  comunicacao: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
  providencia: { registrado_por: ['um', 'usuario', 'registrado_por_id'] },
  historicoOcorrencia: {
    ocorrencia: ['um', 'ocorrencia', 'ocorrencia_id'],
    usuario: ['um', 'usuario', 'usuario_id'],
  },
};

const linhas = (modelo) => banco[TABELA[modelo]];

function relacionado(modelo, registro, campo) {
  const [tipo, alvo, fk] = RELACOES[modelo][campo];
  if (tipo === 'um') {
    return registro[fk] == null ? null : linhas(alvo).find((r) => r.id === registro[fk]) ?? null;
  }
  return linhas(alvo).filter((r) => r[fk] === registro.id);
}

function corresponde(modelo, registro, where = {}) {
  return Object.entries(where).every(([chave, condicao]) => {
    if (chave === 'AND') return condicao.every((w) => corresponde(modelo, registro, w));
    if (chave === 'OR') return condicao.some((w) => corresponde(modelo, registro, w));
    const relacao = RELACOES[modelo]?.[chave];
    if (relacao) {
      const [tipo, alvo] = relacao;
      if (tipo === 'muitos') {
        const operadores = Object.keys(condicao);
        if (operadores.length !== 1 || operadores[0] !== 'some') {
          throw new Error(`mock: operador de lista não suportado em ${modelo}.${chave}`);
        }
        return relacionado(modelo, registro, chave).some((f) => corresponde(alvo, f, condicao.some));
      }
      const pai = relacionado(modelo, registro, chave);
      return pai !== null && corresponde(alvo, pai, condicao);
    }
    if (condicao !== null && typeof condicao === 'object' && !(condicao instanceof Date)) {
      const operadores = Object.keys(condicao);
      if (operadores.length !== 1 || operadores[0] !== 'in') {
        throw new Error(`mock: operador não suportado em ${modelo}.${chave}`);
      }
      return condicao.in.includes(registro[chave]);
    }
    if (!(chave in registro)) throw new Error(`mock: campo inexistente ${modelo}.${chave}`);
    return registro[chave] === condicao;
  });
}

function contarRelacoes(select) {
  return Object.values(select ?? {}).reduce(
    (total, valor) => (valor && typeof valor === 'object' ? total + 1 + contarRelacoes(valor.select) : total),
    0,
  );
}

function selecionar(modelo, registro, select) {
  if (!select) return { ...registro };
  return Object.fromEntries(
    Object.entries(select).map(([campo, valor]) => {
      if (valor === true) {
        if (!(campo in registro)) throw new Error(`mock: campo inexistente ${modelo}.${campo}`);
        return [campo, registro[campo]];
      }
      const [tipo, alvo] = RELACOES[modelo][campo];
      const rel = relacionado(modelo, registro, campo);
      if (tipo === 'muitos') return [campo, rel.map((r) => selecionar(alvo, r, valor.select))];
      return [campo, rel === null ? null : selecionar(alvo, rel, valor.select)];
    }),
  );
}

function valorOrdenacao(modelo, registro, especificacao) {
  const [[campo, direcao]] = Object.entries(especificacao);
  if (typeof direcao === 'object') {
    const [, alvo] = RELACOES[modelo][campo];
    return valorOrdenacao(alvo, relacionado(modelo, registro, campo), direcao);
  }
  const valor = registro[campo];
  return { valor: valor instanceof Date ? valor.getTime() : valor, direcao };
}

function ordenar(modelo, registros, orderBy) {
  if (!orderBy) return registros;
  const criterios = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...registros].sort((a, b) => {
    for (const criterio of criterios) {
      const va = valorOrdenacao(modelo, a, criterio);
      const vb = valorOrdenacao(modelo, b, criterio);
      if (va.valor === vb.valor) continue;
      const menor = va.valor < vb.valor ? -1 : 1;
      return va.direcao === 'desc' ? -menor : menor;
    }
    return 0;
  });
}

/**
 * "now()" do banco: fixo durante uma transação e um minuto à frente a cada
 * nova transação (fictício, sempre no passado em relação aos testes).
 */
const INICIO_RELOGIO_BANCO = Date.parse('2026-10-28T13:00:00.000Z');
let transacoesAbertas;
let agoraBanco;

const DEFAULTS = {
  ocorrencia: () => ({ responsavel_acompanhamento_id: null, data_encerramento: null }),
  encaminhamento: () => ({ data_hora: agoraBanco, observacao: null, destinatario_usuario_id: null }),
  historicoOcorrencia: () => ({ descricao: null, data_hora: agoraBanco }),
  logAuditoria: () => ({ data_hora: agoraBanco }),
};

function inserir(modelo, data) {
  const tabela = linhas(modelo);
  const registro = { ...(DEFAULTS[modelo]?.() ?? {}), ...data };
  if (modelo !== 'ocorrenciaEstudante') registro.id = Math.max(0, ...tabela.map((r) => r.id)) + 1;
  tabela.push(registro);
  return registro;
}

function delegado(modelo, emTransacao) {
  const anotar = (operacao, args) => {
    if (emTransacao) consultasTx.push(`${modelo}.${operacao}`);
    if (contarRelacoes(args?.select) > 2) {
      throw new Error(`mock: mais de 2 relações numa consulta de ${modelo} (aviso do pg)`);
    }
  };
  const buscar = (args = {}) =>
    ordenar(modelo, linhas(modelo).filter((r) => corresponde(modelo, r, args.where)), args.orderBy);
  return {
    findMany: async (args) => {
      anotar('findMany', args);
      return buscar(args).map((r) => selecionar(modelo, r, args?.select));
    },
    findFirst: async (args) => {
      anotar('findFirst', args);
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    findUnique: async (args) => {
      anotar('findUnique', args);
      const [r] = buscar(args);
      return r ? selecionar(modelo, r, args.select) : null;
    },
    create: async ({ data, select }) => {
      anotar('create', { select });
      return selecionar(modelo, inserir(modelo, data), select);
    },
    createMany: async ({ data }) => {
      anotar('createMany');
      data.forEach((d) => inserir(modelo, d));
      return { count: data.length };
    },
    update: async ({ where, data, select }) => {
      anotar('update', { select });
      const [r] = buscar({ where });
      if (!r) throw Object.assign(new Error('mock: registro não encontrado'), { code: 'P2025' });
      Object.assign(r, data);
      return selecionar(modelo, r, select);
    },
  };
}

function clientMock(emTransacao) {
  return Object.fromEntries(Object.keys(TABELA).map((m) => [m, delegado(m, emTransacao)]));
}

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
const { MENSAGEM_TROCA_SENHA_OBRIGATORIA } = await import('../src/middlewares/autenticacao.js');
const { MENSAGEM_NAO_AUTENTICADO } = await import('../src/services/sessao.js');
const {
  ACOES_HISTORICO,
  DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO,
  MENSAGEM_ID_OCORRENCIA_INVALIDO,
  MENSAGEM_OCORRENCIA_NAO_ENCONTRADA,
  listarHistoricoOcorrencia,
  paraRespostaHistorico,
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
const ID_BLOQUEADO = 8; // GESTAO bloqueado

const ID_ESTUDANTE_TUTORADO = 1; // tutor atual: ID_TUTOR
const ID_ESTUDANTE_SEM_TUTOR = 2;

const NOME_ESTUDANTE_TUTORADO = 'Estudante Fictício Alfa';
const NOME_ESTUDANTE_SEM_TUTOR = 'Estudante Fictício Beta';

// O_PROFESSOR: registrada pelo Professor, sem vínculo com Tutor nem Técnico.
// O_TUTORADO: registrada pelo Pedagógico, envolve o tutorado do ID_TUTOR (só
//   por essa condição da RN19 o Tutor a vê).
// O_TECNICO: registrada pelo Técnico-administrativo.
const O_PROFESSOR = 1;
const O_TUTORADO = 2;
const O_TECNICO = 3;
const ID_INEXISTENTE = 999;

/** Ocorrências visíveis a cada usuário (RN19) — as demais dão 404. */
const VISIVEIS = {
  [ID_PROFESSOR]: [O_PROFESSOR],
  [ID_TUTOR]: [O_TUTORADO],
  [ID_GESTAO]: [O_PROFESSOR, O_TUTORADO, O_TECNICO],
  [ID_PEDAGOGICO]: [O_PROFESSOR, O_TUTORADO, O_TECNICO],
  [ID_TECNICO]: [O_TECNICO],
};
const ROTULO = {
  [ID_PROFESSOR]: 'PROFESSOR',
  [ID_TUTOR]: 'TUTOR',
  [ID_GESTAO]: 'GESTAO',
  [ID_PEDAGOGICO]: 'PEDAGOGICO',
  [ID_TECNICO]: 'TECNICO_ADMINISTRATIVO',
};

const data = (iso) => new Date(iso);
const nomeUsuario = (id) => `Usuário Fictício ${id}`;

function montarBanco() {
  const usuario = (id, perfil, extra = {}) => ({
    id,
    nome: nomeUsuario(id),
    email: `usuario${id}@sisto.exemplo`,
    senha_hash: 'hash-ficticio',
    perfil,
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
    ...extra,
  });
  const ocorrencia = (id, profissionalId) => ({
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
    profissional_responsavel_id: profissionalId,
    responsavel_acompanhamento_id: null,
    status: 'ABERTO',
    data_encerramento: null,
  });
  const encaminhamento = (id, ocorrenciaId, registradoPor) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    destinatario_perfil: 'GESTAO',
    destinatario_usuario_id: null,
    registrado_por_id: registradoPor,
    data_hora: data(`2026-10-0${ocorrenciaId}T10:05:00.000Z`),
    observacao: null,
  });
  const historico = (id, ocorrenciaId, usuarioId, acao, descricao, iso) => ({
    id,
    ocorrencia_id: ocorrenciaId,
    usuario_id: usuarioId,
    acao,
    descricao,
    data_hora: data(iso),
  });

  return {
    usuarios: [
      usuario(ID_PROFESSOR, 'PROFESSOR'),
      usuario(ID_TUTOR, 'TUTOR'),
      usuario(ID_GESTAO, 'GESTAO'),
      usuario(ID_PEDAGOGICO, 'PEDAGOGICO'),
      usuario(ID_TECNICO, 'TECNICO_ADMINISTRATIVO'),
      usuario(ID_TROCA_PENDENTE, 'GESTAO', { troca_senha_obrigatoria: true }),
      usuario(ID_TUTOR_2, 'TUTOR'),
      usuario(ID_BLOQUEADO, 'GESTAO', { status: 'BLOQUEADO' }),
    ],
    turmas: [{ id: 1, nome: '6º A', etapa: 'Ensino Fundamental', ano_letivo: 2026 }],
    categorias: [{ id: 1, nome: 'Indisciplina', descricao: null }],
    estudantes: [
      { id: ID_ESTUDANTE_TUTORADO, nome_completo: NOME_ESTUDANTE_TUTORADO, codigo_escolar: 'TESTE-0001', turma_id: 1, tutor_id: ID_TUTOR },
      { id: ID_ESTUDANTE_SEM_TUTOR, nome_completo: NOME_ESTUDANTE_SEM_TUTOR, codigo_escolar: 'TESTE-0002', turma_id: 1, tutor_id: null },
    ],
    ocorrencias: [
      ocorrencia(O_PROFESSOR, ID_PROFESSOR),
      ocorrencia(O_TUTORADO, ID_PEDAGOGICO),
      ocorrencia(O_TECNICO, ID_TECNICO),
    ],
    ocorrenciasEstudantes: [
      { ocorrencia_id: O_PROFESSOR, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: O_TUTORADO, estudante_id: ID_ESTUDANTE_TUTORADO },
      { ocorrencia_id: O_TUTORADO, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
      { ocorrencia_id: O_TECNICO, estudante_id: ID_ESTUDANTE_SEM_TUTOR },
    ],
    encaminhamentos: [
      encaminhamento(1, O_PROFESSOR, ID_PROFESSOR),
      encaminhamento(2, O_TUTORADO, ID_PEDAGOGICO),
      encaminhamento(3, O_TECNICO, ID_TECNICO),
    ],
    comunicacoes: [],
    providencias: [],
    // Ids FORA da ordem cronológica de propósito (para provar a ordenação).
    historicos: [
      historico(1, O_PROFESSOR, ID_PROFESSOR, ACOES_HISTORICO.OCORRENCIA_REGISTRADA, null, '2026-10-01T10:05:00.000Z'),
      historico(2, O_PROFESSOR, ID_PROFESSOR, ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: gestão', '2026-10-01T10:05:00.000Z'),
      historico(3, O_TUTORADO, ID_PEDAGOGICO, ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: gestão', '2026-10-02T10:05:00.000Z'),
      historico(4, O_TECNICO, ID_TECNICO, ACOES_HISTORICO.OCORRENCIA_REGISTRADA, null, '2026-10-03T10:05:00.000Z'),
      historico(5, O_TECNICO, ID_TECNICO, ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: gestão', '2026-10-03T10:05:00.000Z'),
      // Gravado antes do id 3, mas com id maior: o mais antigo vem primeiro.
      historico(6, O_TUTORADO, ID_PEDAGOGICO, ACOES_HISTORICO.OCORRENCIA_REGISTRADA, null, '2026-10-02T10:04:59.999Z'),
      historico(7, O_TUTORADO, ID_GESTAO, ACOES_HISTORICO.COMUNICACAO_REGISTRADA, null, '2026-10-05T08:00:00.000Z'),
    ],
    logs: [],
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  banco = montarBanco();
  consultasTx = [];
  transacoesAbertas = 0;
  agoraBanco = new Date(INICIO_RELOGIO_BANCO);
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) => {
    transacoesAbertas += 1;
    agoraBanco = new Date(INICIO_RELOGIO_BANCO + transacoesAbertas * 60_000);
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
});

function token(id) {
  const u = banco.usuarios.find((x) => x.id === id);
  return jwt.sign({ id, perfil: u.perfil }, SEGREDO_TESTE, { algorithm: 'HS256', expiresIn: '8h' });
}

const getHistorico = (ocorrenciaId, usuarioId) => {
  const req = request(app).get(`/ocorrencias/${ocorrenciaId}/historico`);
  return usuarioId ? req.set('Authorization', `Bearer ${token(usuarioId)}`) : req;
};
const getDetalhe = (ocorrenciaId, usuarioId) =>
  request(app).get(`/ocorrencias/${ocorrenciaId}`).set('Authorization', `Bearer ${token(usuarioId)}`);

/** Item esperado na resposta (dataHora em ISO 8601 UTC). */
const item = (id, acao, descricao, iso, usuarioId) => ({
  id,
  acao,
  descricao,
  dataHora: iso,
  usuario: { id: usuarioId, nome: nomeUsuario(usuarioId) },
});

// ---------------------------------------------------------------------------
// Formato e ordem
// ---------------------------------------------------------------------------
describe('GET /ocorrencias/{id}/historico — formato e ordem', () => {
  it('200 com { id, acao, descricao, dataHora, usuario: { id, nome } }, só da ocorrência pedida', async () => {
    const res = await getHistorico(O_PROFESSOR, ID_PROFESSOR);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      item(1, ACOES_HISTORICO.OCORRENCIA_REGISTRADA, null, '2026-10-01T10:05:00.000Z', ID_PROFESSOR),
      item(2, ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: gestão', '2026-10-01T10:05:00.000Z', ID_PROFESSOR),
    ]);
    for (const registro of res.body) {
      expect(Object.keys(registro).sort()).toEqual(['acao', 'dataHora', 'descricao', 'id', 'usuario']);
      expect(Object.keys(registro.usuario).sort()).toEqual(['id', 'nome']);
    }
  });

  it('ordena por data/hora crescente, mesmo quando o id está fora da ordem', async () => {
    const res = await getHistorico(O_TUTORADO, ID_GESTAO);
    expect(res.status).toBe(200);
    expect(res.body.map((h) => h.id)).toEqual([6, 3, 7]);
    expect(res.body.map((h) => h.usuario.id)).toEqual([ID_PEDAGOGICO, ID_PEDAGOGICO, ID_GESTAO]);
  });

  it('no empate de data/hora, desempata por id crescente', async () => {
    // Mesmo instante, ids inseridos em ordem decrescente na tabela.
    banco.historicos.push(
      { id: 9, ocorrencia_id: O_TECNICO, usuario_id: ID_GESTAO, acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA, descricao: null, data_hora: data('2026-10-04T09:00:00.000Z') },
      { id: 8, ocorrencia_id: O_TECNICO, usuario_id: ID_PEDAGOGICO, acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA, descricao: null, data_hora: data('2026-10-04T09:00:00.000Z') },
    );
    const res = await getHistorico(O_TECNICO, ID_TECNICO);
    expect(res.body.map((h) => h.id)).toEqual([4, 5, 8, 9]);
  });

  it('usa o orderBy data_hora asc, id asc na consulta do histórico', async () => {
    const db = { $transaction: vi.fn() };
    const findMany = vi.fn().mockResolvedValue([]);
    db.$transaction.mockImplementation((operacao) =>
      operacao({
        ocorrencia: { findFirst: vi.fn().mockResolvedValue({ id: O_PROFESSOR }) },
        historicoOcorrencia: { findMany },
      }),
    );
    await listarHistoricoOcorrencia(String(O_PROFESSOR), { id: ID_GESTAO, perfil: 'GESTAO' }, { db });
    expect(findMany).toHaveBeenCalledWith({
      where: { ocorrencia_id: O_PROFESSOR },
      select: {
        id: true,
        acao: true,
        descricao: true,
        data_hora: true,
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: [{ data_hora: 'asc' }, { id: 'asc' }],
    });
  });

  it('ocorrência sem registros de histórico devolve []', async () => {
    banco.historicos = banco.historicos.filter((h) => h.ocorrencia_id !== O_TECNICO);
    const res = await getHistorico(O_TECNICO, ID_GESTAO);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('sem paginação: devolve todos os registros e ignora query string', async () => {
    for (let i = 0; i < 60; i += 1) {
      banco.historicos.push({
        id: 100 + i,
        ocorrencia_id: O_TECNICO,
        usuario_id: ID_GESTAO,
        acao: ACOES_HISTORICO.COMUNICACAO_REGISTRADA,
        descricao: null,
        data_hora: data('2026-10-06T09:00:00.000Z'),
      });
    }
    const res = await request(app)
      .get(`/ocorrencias/${O_TECNICO}/historico?pagina=2&tamanhoPagina=5`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(62);
  });

  it('paraRespostaHistorico expõe só id e nome do usuário, mesmo se receber mais campos', () => {
    const registro = {
      id: 1,
      ocorrencia_id: 1,
      usuario_id: 3,
      acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA,
      descricao: null,
      data_hora: data('2026-10-01T10:05:00.000Z'),
      usuario: { id: 3, nome: 'Usuário Fictício 3', email: 'x@sisto.exemplo', perfil: 'GESTAO', status: 'ATIVO' },
    };
    expect(paraRespostaHistorico(registro)).toEqual({
      id: 1,
      acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA,
      descricao: null,
      dataHora: data('2026-10-01T10:05:00.000Z'),
      usuario: { id: 3, nome: 'Usuário Fictício 3' },
    });
  });
});

// ---------------------------------------------------------------------------
// Fluxo completo (critérios 1, 2 e 3)
// ---------------------------------------------------------------------------
describe('histórico ao longo do ciclo da ocorrência', () => {
  const CORPO_REGISTRO = () => ({
    dataHora: new Date(Date.now() - 60_000).toISOString(),
    local: 'Pátio',
    turmaId: 1,
    categoriaId: 1,
    descricao: 'Descrição objetiva fictícia do fato.',
    estudanteIds: [ID_ESTUDANTE_TUTORADO, ID_ESTUDANTE_SEM_TUTOR],
    encaminhamentos: [
      { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: ID_TUTOR, observacao: 'Observação fictícia do encaminhamento.' },
      { destinatarioPerfil: 'GESTAO' },
    ],
  });
  const CORPO_COMUNICACAO = {
    destinatario: 'Responsável Fictício da Silva',
    meio: 'Telefone fictício',
    descricao: 'Conteúdo fictício e sigiloso da comunicação.',
    dataHora: '2026-10-20T14:30:00-03:00',
  };
  const CONTEUDO_PROVIDENCIA = 'Conteúdo fictício e sigiloso da providência.';
  const instante = (n) => new Date(INICIO_RELOGIO_BANCO + n * 60_000).toISOString();

  async function registrar() {
    const res = await request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token(ID_PROFESSOR)}`)
      .send(CORPO_REGISTRO());
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('ocorrência recém-registrada: "ocorrência registrada" e um "encaminhamento registrado" por destinatário, nessa ordem', async () => {
    const id = await registrar();
    const res = await getHistorico(id, ID_PROFESSOR);
    expect(res.status).toBe(200);
    expect(res.body.map(({ id: _id, ...resto }) => resto)).toEqual([
      { acao: ACOES_HISTORICO.OCORRENCIA_REGISTRADA, descricao: null, dataHora: instante(1), usuario: { id: ID_PROFESSOR, nome: nomeUsuario(ID_PROFESSOR) } },
      { acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: tutor', dataHora: instante(1), usuario: { id: ID_PROFESSOR, nome: nomeUsuario(ID_PROFESSOR) } },
      { acao: ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, descricao: 'Destinatário: gestão', dataHora: instante(1), usuario: { id: ID_PROFESSOR, nome: nomeUsuario(ID_PROFESSOR) } },
    ]);
    // Mesmo instante (mesma transação): a ordem vem do id.
    const ids = res.body.map((h) => h.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('depois de encaminhar, comunicar, registrar providência e encerrar, todas as ações aparecem do mais antigo para o mais novo', async () => {
    const id = await registrar(); // transação 1

    const encaminhamento = await request(app) // transação 2
      .post(`/ocorrencias/${id}/encaminhamentos`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .send({
        destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
        observacao: 'Observação fictícia do segundo encaminhamento.',
        responsavelAcompanhamentoId: ID_TUTOR,
      });
    expect(encaminhamento.status).toBe(201);

    const comunicacao = await request(app) // transação 3
      .post(`/ocorrencias/${id}/comunicacoes`)
      .set('Authorization', `Bearer ${token(ID_TUTOR)}`)
      .send(CORPO_COMUNICACAO);
    expect(comunicacao.status).toBe(201);

    // Providência (#81) e encerramento (#82): inseridos direto no banco, com
    // as ações fixas da Seção 12 (SSD 1.8).
    const proximoId = () => Math.max(...banco.historicos.map((h) => h.id)) + 1;
    banco.providencias.push({
      id: 1,
      ocorrencia_id: id,
      descricao: CONTEUDO_PROVIDENCIA,
      registrado_por_id: ID_PEDAGOGICO,
      data_hora: data(instante(4)),
    });
    banco.historicos.push({
      id: proximoId(),
      ocorrencia_id: id,
      usuario_id: ID_PEDAGOGICO,
      acao: 'providência registrada',
      descricao: null,
      data_hora: data(instante(4)),
    });
    banco.historicos.push({
      id: proximoId(),
      ocorrencia_id: id,
      usuario_id: ID_TUTOR,
      acao: ACOES_HISTORICO.STATUS_ALTERADO,
      descricao: 'De em acompanhamento para encerrado',
      data_hora: data(instante(5)),
    });
    Object.assign(
      banco.ocorrencias.find((o) => o.id === id),
      { status: 'ENCERRADO', data_encerramento: data(instante(5)) },
    );

    const esperado = [
      [ACOES_HISTORICO.OCORRENCIA_REGISTRADA, null, 1, ID_PROFESSOR],
      [ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: tutor', 1, ID_PROFESSOR],
      [ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: gestão', 1, ID_PROFESSOR],
      [ACOES_HISTORICO.ENCAMINHAMENTO_REGISTRADO, 'Destinatário: equipe pedagógica', 2, ID_GESTAO],
      [ACOES_HISTORICO.STATUS_ALTERADO, DESCRICAO_HISTORICO_ABERTO_PARA_ACOMPANHAMENTO, 2, ID_GESTAO],
      [ACOES_HISTORICO.RESPONSAVEL_DEFINIDO, null, 2, ID_GESTAO],
      [ACOES_HISTORICO.COMUNICACAO_REGISTRADA, null, 3, ID_TUTOR],
      ['providência registrada', null, 4, ID_PEDAGOGICO],
      [ACOES_HISTORICO.STATUS_ALTERADO, 'De em acompanhamento para encerrado', 5, ID_TUTOR],
    ].map(([acao, descricao, n, usuarioId]) => ({
      acao,
      descricao,
      dataHora: instante(n),
      usuario: { id: usuarioId, nome: nomeUsuario(usuarioId) },
    }));

    // Todos os que veem a ocorrência recebem o mesmo histórico: quem registrou,
    // o tutor (destinatário, responsável e tutor do estudante), Gestão e
    // Pedagógico. A ocorrência encerrada continua com histórico visível.
    for (const usuarioId of [ID_PROFESSOR, ID_TUTOR, ID_GESTAO, ID_PEDAGOGICO]) {
      const res = await getHistorico(id, usuarioId);
      expect(res.status).toBe(200);
      expect(res.body.map(({ id: _id, ...resto }) => resto)).toEqual(esperado);
      const ids = res.body.map((h) => h.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
    // O Técnico não tem vínculo com ela.
    expect((await getHistorico(id, ID_TECNICO)).status).toBe(404);
  });

  it('nenhum item traz e-mail, perfil, status do usuário, conteúdo de comunicação, de providência, observação nem nome de estudante', async () => {
    const id = await registrar();
    await request(app)
      .post(`/ocorrencias/${id}/encaminhamentos`)
      .set('Authorization', `Bearer ${token(ID_GESTAO)}`)
      .send({ destinatarioPerfil: 'EQUIPE_PEDAGOGICA', observacao: 'Observação fictícia do segundo encaminhamento.', responsavelAcompanhamentoId: ID_TUTOR })
      .expect(201);
    await request(app)
      .post(`/ocorrencias/${id}/comunicacoes`)
      .set('Authorization', `Bearer ${token(ID_TUTOR)}`)
      .send(CORPO_COMUNICACAO)
      .expect(201);
    banco.providencias.push({ id: 1, ocorrencia_id: id, descricao: CONTEUDO_PROVIDENCIA, registrado_por_id: ID_PEDAGOGICO, data_hora: data(instante(4)) });
    banco.historicos.push({ id: 500, ocorrencia_id: id, usuario_id: ID_PEDAGOGICO, acao: 'providência registrada', descricao: null, data_hora: data(instante(4)) });

    const res = await getHistorico(id, ID_GESTAO);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const registro of res.body) {
      expect(Object.keys(registro.usuario).sort()).toEqual(['id', 'nome']);
    }
    const texto = JSON.stringify(res.body);
    const proibidos = [
      '@sisto.exemplo', // e-mails
      'senha',
      'hash-ficticio',
      '"perfil"',
      '"status"',
      'ATIVO',
      NOME_ESTUDANTE_TUTORADO,
      NOME_ESTUDANTE_SEM_TUTOR,
      'TESTE-000', // código escolar
      CORPO_COMUNICACAO.destinatario,
      CORPO_COMUNICACAO.meio,
      CORPO_COMUNICACAO.descricao,
      CONTEUDO_PROVIDENCIA,
      'Observação fictícia',
      'Descrição objetiva fictícia', // descrição da ocorrência
    ];
    for (const termo of proibidos) expect(texto).not.toContain(termo);
  });
});

// ---------------------------------------------------------------------------
// Visibilidade (RN19) e 404
// ---------------------------------------------------------------------------
describe('visibilidade por perfil (RN19)', () => {
  for (const [usuarioId, visiveis] of Object.entries(VISIVEIS).map(([k, v]) => [Number(k), v])) {
    it(`${ROTULO[usuarioId]}: 200 nas visíveis (${visiveis.join(', ')}) e 404 nas demais — igual ao GET /ocorrencias/{id}`, async () => {
      for (const ocorrenciaId of [O_PROFESSOR, O_TUTORADO, O_TECNICO]) {
        const historico = await getHistorico(ocorrenciaId, usuarioId);
        const detalhe = await getDetalhe(ocorrenciaId, usuarioId);
        const esperado = visiveis.includes(ocorrenciaId) ? 200 : 404;
        expect(historico.status).toBe(esperado);
        expect(detalhe.status).toBe(esperado);
        if (esperado === 404) expect(historico.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
      }
    });
  }

  it('404 com a MESMA mensagem para inexistente e para fora da visibilidade', async () => {
    const inexistente = await getHistorico(ID_INEXISTENTE, ID_PROFESSOR);
    const naoPermitida = await getHistorico(O_TUTORADO, ID_PROFESSOR);
    const maiorIdInexistente = await getHistorico(2147483647, ID_GESTAO);
    for (const res of [inexistente, naoPermitida, maiorIdInexistente]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    }
  });

  it('fora da visibilidade: só a consulta com filtro roda (o histórico não é lido)', async () => {
    await getHistorico(O_TUTORADO, ID_PROFESSOR);
    expect(consultasTx).toEqual(['ocorrencia.findFirst']);
  });

  it('Tutor vê o histórico do tutorado (vínculo atual) e recebe 404 depois da troca de tutor', async () => {
    expect((await getHistorico(O_TUTORADO, ID_TUTOR)).status).toBe(200);
    expect((await getHistorico(O_TUTORADO, ID_TUTOR_2)).status).toBe(404);

    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).tutor_id = ID_TUTOR_2;

    const antigo = await getHistorico(O_TUTORADO, ID_TUTOR);
    expect(antigo.status).toBe(404);
    expect(antigo.body).toEqual({ erro: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
    const novo = await getHistorico(O_TUTORADO, ID_TUTOR_2);
    expect(novo.status).toBe(200);
    expect(novo.body.map((h) => h.id)).toEqual([6, 3, 7]);
  });

  it('Tutor que acompanha a ocorrência continua vendo o histórico após a troca de tutor (outra condição da RN19)', async () => {
    banco.ocorrencias.find((o) => o.id === O_TUTORADO).responsavel_acompanhamento_id = ID_TUTOR;
    banco.estudantes.find((e) => e.id === ID_ESTUDANTE_TUTORADO).tutor_id = ID_TUTOR_2;
    expect((await getHistorico(O_TUTORADO, ID_TUTOR)).status).toBe(200);
  });

  it('Tutor destinatário de encaminhamento vê o histórico', async () => {
    banco.encaminhamentos.push({
      id: 10,
      ocorrencia_id: O_PROFESSOR,
      destinatario_perfil: 'TUTOR',
      destinatario_usuario_id: ID_TUTOR_2,
      registrado_por_id: ID_GESTAO,
      data_hora: data('2026-10-06T10:00:00.000Z'),
      observacao: null,
    });
    expect((await getHistorico(O_PROFESSOR, ID_TUTOR_2)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// id da URL, autenticação e troca de senha
// ---------------------------------------------------------------------------
describe('id da URL, autenticação e perfis', () => {
  for (const id of ['abc', '0', '1.5', '-1', '01', '1e3', '2147483648', '99999999999']) {
    it(`id "${id}" responde 400 sem abrir transação`, async () => {
      const res = await getHistorico(id, ID_GESTAO);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ erro: MENSAGEM_ID_OCORRENCIA_INVALIDO });
      expect(mocks.$transaction).not.toHaveBeenCalled();
    });
  }

  it('401 sem token', async () => {
    const res = await getHistorico(O_PROFESSOR);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get(`/ocorrencias/${O_PROFESSOR}/historico`)
      .set('Authorization', 'Bearer token-ficticio-invalido');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
  });

  it('401 para usuário bloqueado (RN09), mesmo com token válido', async () => {
    const res = await getHistorico(O_PROFESSOR, ID_BLOQUEADO);
    expect(res.status).toBe(401);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('403 com troca de senha pendente (mesmo sendo Gestão), sem consultar o histórico', async () => {
    const res = await getHistorico(O_PROFESSOR, ID_TROCA_PENDENTE);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('a rota GET /:id/historico libera exatamente os 5 perfis', async () => {
    const { default: rotas } = await import('../src/routes/ocorrencias.js');
    const camada = rotas.stack.find((c) => c.route.path === '/:id/historico');
    expect(Object.keys(camada.route.methods)).toEqual(['get']);
    const verificarPerfil = camada.route.stack.map((c) => c.handle).find((h) => h.name === 'verificarPerfil');
    expect(verificarPerfil).toBeTypeOf('function');

    const liberados = [];
    for (const perfil of ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', 'PERFIL_INEXISTENTE']) {
      const next = vi.fn();
      try {
        verificarPerfil({ usuario: { id: 1, perfil } }, {}, next);
        if (next.mock.calls.length === 1 && next.mock.calls[0].length === 0) liberados.push(perfil);
      } catch {
        // perfil recusado
      }
    }
    expect(liberados).toEqual(['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO']);
  });
});

// ---------------------------------------------------------------------------
// Leitura consistente, sem gravação
// ---------------------------------------------------------------------------
describe('leitura consistente e sem gravação', () => {
  it('confere a visibilidade e lê o histórico numa única transação REPEATABLE READ', async () => {
    await getHistorico(O_TUTORADO, ID_TUTOR);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(consultasTx).toEqual(['ocorrencia.findFirst', 'historicoOcorrencia.findMany']);
  });

  it('não grava histórico, auditoria nem altera nada no banco', async () => {
    const antes = structuredClone(banco);
    for (const usuarioId of [ID_PROFESSOR, ID_TUTOR, ID_GESTAO, ID_PEDAGOGICO, ID_TECNICO]) {
      await getHistorico(O_PROFESSOR, usuarioId);
      await getHistorico(O_TUTORADO, usuarioId);
      await getHistorico(ID_INEXISTENTE, usuarioId);
    }
    expect(banco).toEqual(antes);
    expect(consultasTx.every((c) => /\.(findFirst|findMany)$/.test(c))).toBe(true);
  });

  it('o service aceita db injetado e devolve 404 quando a ocorrência não é visível', async () => {
    const db = {
      $transaction: vi.fn((operacao) =>
        operacao({ ocorrencia: { findFirst: vi.fn().mockResolvedValue(null) }, historicoOcorrencia: { findMany: vi.fn() } }),
      ),
    };
    await expect(
      listarHistoricoOcorrencia('1', { id: ID_TUTOR, perfil: 'TUTOR' }, { db }),
    ).rejects.toMatchObject({ status: 404, message: MENSAGEM_OCORRENCIA_NAO_ENCONTRADA });
  });

  it('erro inesperado do banco responde 500 sem detalhes internos', async () => {
    mocks.$transaction.mockRejectedValueOnce(new Error('falha fictícia do banco'));
    const res = await getHistorico(O_PROFESSOR, ID_GESTAO);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('falha fictícia');
  });
});
