// Matriz de permissões de ponta a ponta pela API (Issue #93, item 2 — RF14,
// RN01, RN10, RN19, RN20, RN22). App real + banco de testes real, somente
// dados fictícios (RN05). Insumo para a validação da matriz com a escola (#95).
//
// COMO LER A TABELA `MATRIZ`: cada linha é um endpoint da Seção 12 do SSD
// (às vezes repetido em mais de um contexto, ex.: "ocorrência de um
// tutorado"), com o código HTTP esperado para cada um dos 5 perfis, nesta
// ordem de colunas (a mesma da matriz da Seção 4):
//
//     Prof = Professor | Tutor | Gestão | Pedag = Pedagógico | TécAdm = Técnico-administrativo
//
//   2xx  = permitido (a operação foi feita de verdade, no banco de testes);
//   403  = perfil sem permissão (permitirPerfis — Seção 4; ou RN22);
//   404  = a ocorrência existe, mas está fora da visibilidade do perfil (RN19),
//          ou o endpoint é reservado/não implementado no MVP.
//
// Cada requisição usa um token obtido pelo login real do perfil (JWT real).
// Linhas que alteram dados preparam um recurso novo para cada perfil, para que
// as linhas não dependam umas das outras.
//
// Depois da matriz: todos os endpoints protegidos sem token (401) e com a
// troca de senha pendente (403 — RN10).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import {
  MENSAGEM_PERFIL_SEM_PERMISSAO,
  MENSAGEM_TROCA_SENHA_OBRIGATORIA,
} from '../../src/middlewares/autenticacao.js';
import { MENSAGEM_NAO_AUTENTICADO } from '../../src/services/sessao.js';
import {
  DIA_FATO,
  PERFIS,
  SENHA_PADRAO,
  corpoComunicacao,
  criarCategoria,
  criarEstudante,
  criarTurma,
  criarUsuario,
  criarUsuarioLogado,
  desconectarPrisma,
  encaminhar,
  entrar,
  enviar,
  exigirStatus,
  limparBanco,
  providenciar,
  proximo,
  registrarOcorrencia,
} from './apoio/dados.js';

const app = criarApp();

/** Dados de partida, preenchidos no beforeAll. */
const c = {
  logados: {}, // perfil -> { id, email, senha, token }
};

const tokenDe = (perfil) => c.logados[perfil].token;

// ---------------------------------------------------------------------------
// Preparadores de ocorrências (sempre pela API, com o token da Gestão)
// ---------------------------------------------------------------------------

/** Ocorrência registrada pela Gestão com estudante SEM tutor: só Gestão e Pedagógico a veem (RN19). */
async function ocorrenciaForaDaVisibilidade() {
  const o = await registrarOcorrencia(app, tokenDe('GESTAO'), {
    turmaId: c.turma.id,
    categoriaId: c.categoria.id,
    estudanteIds: [c.estudanteSemTutor.id],
  });
  return o.id;
}

/** Ocorrência registrada pela Gestão com estudante tutorado do Tutor logado (RN19). */
async function ocorrenciaDoTutorado() {
  const o = await registrarOcorrencia(app, tokenDe('GESTAO'), {
    turmaId: c.turma.id,
    categoriaId: c.categoria.id,
    estudanteIds: [c.estudanteTutorado.id],
  });
  return o.id;
}

/**
 * Ocorrência "em acompanhamento" (RN15).
 * @param {'tutor' | 'pedagogico'} responsavel quem acompanha
 * @param {'semTutor' | 'tutorado'} estudante
 * @param {{ comProvidencia?: boolean }} [opcoes]
 */
async function ocorrenciaEmAcompanhamento(responsavel, estudante, { comProvidencia = false } = {}) {
  const o = await registrarOcorrencia(app, tokenDe('GESTAO'), {
    turmaId: c.turma.id,
    categoriaId: c.categoria.id,
    estudanteIds: [estudante === 'tutorado' ? c.estudanteTutorado.id : c.estudanteSemTutor.id],
  });
  if (responsavel === 'tutor') {
    await encaminhar(app, tokenDe('GESTAO'), o.id, {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: c.logados.TUTOR.id,
      responsavelAcompanhamentoId: c.logados.TUTOR.id,
    });
  } else {
    await encaminhar(app, tokenDe('GESTAO'), o.id, {
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      responsavelAcompanhamentoId: c.logados.PEDAGOGICO.id,
    });
  }
  if (comProvidencia) await providenciar(app, tokenDe('GESTAO'), o.id);
  return o.id;
}

function corpoOcorrencia() {
  return {
    dataHora: '2026-03-10T10:00:00-03:00',
    local: 'Sala de aula (fictícia)',
    turmaId: c.turma.id,
    categoriaId: c.categoria.id,
    descricao: 'Descrição objetiva e fictícia para a matriz de permissões.',
    estudanteIds: [c.estudanteSemTutor.id],
    encaminhamentos: [{ destinatarioPerfil: 'GESTAO' }],
  };
}

// ---------------------------------------------------------------------------
// A MATRIZ
// ---------------------------------------------------------------------------

/**
 * @param {string} metodo
 * @param {string} rota rota como na Seção 12
 * @param {string} regra ação da matriz da Seção 4 / regra do SSD (e o contexto, se houver)
 * @param {number[]} codigos [Prof, Tutor, Gestão, Pedag, TécAdm]
 * @param {(perfil: string) => Promise<{ url: string, corpo?: object, token?: string, publica?: boolean }>} preparar
 */
function linha(metodo, rota, regra, codigos, preparar) {
  return { metodo, rota, regra, codigos, preparar };
}

const MATRIZ = [
  //    método   rota                                    regra / contexto                                                   Prof Tutor Gestão Pedag TécAdm
  linha('POST', '/auth/login', 'Autenticar (público, sem token)', [200, 200, 200, 200, 200], async (p) => ({
    url: '/auth/login',
    corpo: { email: c.logados[p].email, senha: SENHA_PADRAO },
    publica: true,
  })),
  linha('POST', '/auth/recuperar-senha', 'Reservado — não implementado no MVP', [404, 404, 404, 404, 404], async () => ({
    url: '/auth/recuperar-senha',
    corpo: { email: 'qualquer@escola-ficticia.test' },
    publica: true,
  })),

  // Usuários (RN01, RN20, RF01, RF03, RF04)
  linha('GET', '/usuarios', 'Listar usuários (reduzido para quem não é Gestão — RN20)', [200, 200, 200, 200, 200], async () => ({
    url: '/usuarios',
  })),
  linha('POST', '/usuarios', 'Gerenciar usuários', [403, 403, 201, 403, 403], async () => {
    const n = proximo();
    return {
      url: '/usuarios',
      corpo: { nome: `Professor Fictício Novo ${n}`, email: `novo.${n}@escola-ficticia.test`, perfil: 'PROFESSOR', senha: 'TemporariaFicticia#1' },
    };
  }),
  linha('PUT', '/usuarios/{id}', 'Gerenciar usuários (editar)', [403, 403, 200, 403, 403], async () => ({
    url: `/usuarios/${c.alvo.id}`,
    corpo: { nome: `Professor Fictício Editado ${proximo()}` },
  })),
  linha('PUT', '/usuarios/{id}/senha', 'Redefinir senha de usuário', [403, 403, 204, 403, 403], async () => ({
    url: `/usuarios/${c.alvo.id}/senha`,
    corpo: { novaSenha: `TemporariaFicticia#${proximo()}` },
  })),
  linha('PUT', '/conta/senha', 'Trocar a própria senha (usuário novo por perfil — RN12 derruba o token)', [204, 204, 204, 204, 204], async (p) => {
    const u = await criarUsuarioLogado(app, p);
    return { url: '/conta/senha', token: u.token, corpo: { senhaAtual: u.senha, novaSenha: 'NovaSenhaFicticia#2026' } };
  }),

  // Turmas (RN20, RN21)
  linha('GET', '/turmas', 'Consultar turmas (RN20)', [200, 200, 200, 200, 200], async () => ({ url: '/turmas' })),
  linha('POST', '/turmas', 'Gerenciar turmas', [403, 403, 201, 403, 403], async () => ({
    url: '/turmas',
    corpo: { nome: `Turma Fictícia Nova ${proximo()}`, etapa: 'Ensino Médio', anoLetivo: 2026 },
  })),
  linha('PUT', '/turmas/{id}', 'Gerenciar turmas (editar)', [403, 403, 200, 403, 403], async () => ({
    url: `/turmas/${c.turmaEditavel.id}`,
    corpo: { nome: `Turma Fictícia Editada ${proximo()}`, etapa: 'Ensino Médio', anoLetivo: 2026 },
  })),

  // Estudantes (RN13, RN20)
  linha('GET', '/estudantes', 'Consultar estudantes (reduzido para quem não é Gestão — RN20)', [200, 200, 200, 200, 200], async () => ({
    url: '/estudantes',
  })),
  linha('POST', '/estudantes', 'Gerenciar estudantes', [403, 403, 201, 403, 403], async () => ({
    url: '/estudantes',
    corpo: { nomeCompleto: `Estudante Fictício Novo ${proximo()}`, turmaId: c.turma.id },
  })),
  linha('PUT', '/estudantes/{id}', 'Gerenciar estudantes (editar)', [403, 403, 200, 403, 403], async () => ({
    url: `/estudantes/${c.estudanteEditavel.id}`,
    corpo: { nomeCompleto: `Estudante Fictício Editado ${proximo()}`, turmaId: c.turma.id },
  })),

  // Categorias (RN18, RN21)
  linha('GET', '/categorias', 'Consultar categorias (RN20)', [200, 200, 200, 200, 200], async () => ({ url: '/categorias' })),
  linha('POST', '/categorias', 'Gerenciar categorias', [403, 403, 201, 201, 403], async () => ({
    url: '/categorias',
    corpo: { nome: `Categoria Fictícia Nova ${proximo()}` },
  })),
  linha('PUT', '/categorias/{id}', 'Gerenciar categorias (editar)', [403, 403, 200, 200, 403], async () => ({
    url: `/categorias/${c.categoriaEditavel.id}`,
    corpo: { nome: `Categoria Fictícia Editada ${proximo()}` },
  })),

  // Ocorrências — registro e consulta (RN02, RN03, RN19)
  linha('POST', '/ocorrencias', 'Registrar ocorrência', [201, 201, 201, 201, 201], async () => ({
    url: '/ocorrencias',
    corpo: corpoOcorrencia(),
  })),
  linha('GET', '/ocorrencias', 'Consultar ocorrências (lista limitada pela RN19)', [200, 200, 200, 200, 200], async () => ({
    url: '/ocorrencias',
  })),
  linha('GET', '/ocorrencias/{id}', 'Ver ocorrência que registrou', [200, 200, 200, 200, 200], async (p) => {
    const o = await registrarOcorrencia(app, tokenDe(p), {
      turmaId: c.turma.id,
      categoriaId: c.categoria.id,
      estudanteIds: [c.estudanteSemTutor.id],
    });
    return { url: `/ocorrencias/${o.id}` };
  }),
  linha('GET', '/ocorrencias/{id}', 'Ver ocorrência de um tutorado do Tutor', [404, 200, 200, 200, 404], async () => ({
    url: `/ocorrencias/${c.ocorrenciaTutorado}`,
  })),
  linha('GET', '/ocorrencias/{id}', 'Ver todas — ocorrência de outro usuário, sem vínculo (RN19)', [404, 404, 200, 200, 404], async () => ({
    url: `/ocorrencias/${c.ocorrenciaForaDaVisibilidade}`,
  })),
  linha('GET', '/ocorrencias/{id}/historico', 'Histórico de ocorrência que registrou', [200, 200, 200, 200, 200], async (p) => {
    const o = await registrarOcorrencia(app, tokenDe(p), {
      turmaId: c.turma.id,
      categoriaId: c.categoria.id,
      estudanteIds: [c.estudanteSemTutor.id],
    });
    return { url: `/ocorrencias/${o.id}/historico` };
  }),
  linha('GET', '/ocorrencias/{id}/historico', 'Histórico de ocorrência de um tutorado do Tutor', [404, 200, 200, 200, 404], async () => ({
    url: `/ocorrencias/${c.ocorrenciaTutorado}/historico`,
  })),
  linha('GET', '/ocorrencias/{id}/historico', 'Histórico de ocorrência de outro usuário, sem vínculo (RN19)', [404, 404, 200, 200, 404], async () => ({
    url: `/ocorrencias/${c.ocorrenciaForaDaVisibilidade}/historico`,
  })),
  linha('PUT', '/ocorrencias/{id}', 'Reservado — fora do MVP', [404, 404, 404, 404, 404], async () => ({
    url: `/ocorrencias/${c.ocorrenciaForaDaVisibilidade}`,
    corpo: { local: 'Outro local (fictício)' },
  })),

  // Ocorrências — encaminhamento (RN15)
  linha('POST', '/ocorrencias/{id}/encaminhamentos', 'Encaminhar ocorrência (aberta)', [403, 403, 201, 201, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaForaDaVisibilidade()}/encaminhamentos`,
    corpo: {
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuarioId: c.logados.TUTOR.id,
      responsavelAcompanhamentoId: c.logados.TUTOR.id,
    },
  })),

  // Ocorrências — comunicação (RN16)
  linha('POST', '/ocorrencias/{id}/comunicacoes', 'Registrar comunicação — ocorrência de tutorado do Tutor', [403, 201, 201, 201, 403], async () => ({
    url: `/ocorrencias/${c.ocorrenciaTutorado}/comunicacoes`,
    corpo: corpoComunicacao(),
  })),
  linha('POST', '/ocorrencias/{id}/comunicacoes', 'Registrar comunicação — fora da visibilidade do Tutor (RN16/RN19)', [403, 404, 201, 201, 403], async () => ({
    url: `/ocorrencias/${c.ocorrenciaForaDaVisibilidade}/comunicacoes`,
    corpo: corpoComunicacao(),
  })),

  // Ocorrências — providência (RN04, RN22)
  linha('POST', '/ocorrencias/{id}/providencias', 'Atualizar — Tutor é o responsável pelo acompanhamento', [403, 201, 201, 201, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('tutor', 'semTutor')}/providencias`,
    corpo: { descricao: 'Providência fictícia da matriz.' },
  })),
  linha('POST', '/ocorrencias/{id}/providencias', 'Atualizar — Tutor vê (tutorado), mas não é o responsável (RN22)', [403, 403, 201, 201, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('pedagogico', 'tutorado')}/providencias`,
    corpo: { descricao: 'Providência fictícia da matriz.' },
  })),
  linha('POST', '/ocorrencias/{id}/providencias', 'Atualizar — fora da visibilidade do Tutor (RN19)', [403, 404, 201, 201, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('pedagogico', 'semTutor')}/providencias`,
    corpo: { descricao: 'Providência fictícia da matriz.' },
  })),

  // Ocorrências — encerramento (RN04, RN22)
  linha('PATCH', '/ocorrencias/{id}/status', 'Encerrar — Tutor é o responsável pelo acompanhamento', [403, 200, 200, 200, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('tutor', 'semTutor', { comProvidencia: true })}/status`,
    corpo: { status: 'ENCERRADO' },
  })),
  linha('PATCH', '/ocorrencias/{id}/status', 'Encerrar — Tutor vê (tutorado), mas não é o responsável (RN22)', [403, 403, 200, 200, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('pedagogico', 'tutorado', { comProvidencia: true })}/status`,
    corpo: { status: 'ENCERRADO' },
  })),
  linha('PATCH', '/ocorrencias/{id}/status', 'Encerrar — fora da visibilidade do Tutor (RN19)', [403, 404, 200, 200, 403], async () => ({
    url: `/ocorrencias/${await ocorrenciaEmAcompanhamento('pedagogico', 'semTutor', { comProvidencia: true })}/status`,
    corpo: { status: 'ENCERRADO' },
  })),

  // Relatórios (UC05)
  linha('GET', '/relatorios', 'Gerar relatórios', [403, 403, 200, 200, 403], async () => ({
    url: `/relatorios?tipo=categoria&dataInicio=${DIA_FATO}&dataFim=${DIA_FATO}`,
  })),
];

/** Todos os endpoints da tabela da Seção 12 do SSD 1.8 (inclusive os reservados). */
const ENDPOINTS_SECAO_12 = [
  'POST /auth/login',
  'POST /auth/recuperar-senha',
  'GET /usuarios',
  'POST /usuarios',
  'PUT /usuarios/{id}',
  'PUT /usuarios/{id}/senha',
  'PUT /conta/senha',
  'GET /turmas',
  'POST /turmas',
  'PUT /turmas/{id}',
  'GET /estudantes',
  'POST /estudantes',
  'PUT /estudantes/{id}',
  'GET /categorias',
  'POST /categorias',
  'PUT /categorias/{id}',
  'POST /ocorrencias',
  'GET /ocorrencias',
  'GET /ocorrencias/{id}',
  'PUT /ocorrencias/{id}',
  'PATCH /ocorrencias/{id}/status',
  'POST /ocorrencias/{id}/encaminhamentos',
  'POST /ocorrencias/{id}/providencias',
  'POST /ocorrencias/{id}/comunicacoes',
  'GET /ocorrencias/{id}/historico',
  'GET /relatorios',
];

/** Endpoints protegidos por JWT (tudo fora de /auth/*), com ids fictícios na URL. */
const PROTEGIDOS = [
  ['GET', '/usuarios'],
  ['POST', '/usuarios'],
  ['PUT', '/usuarios/1'],
  ['PUT', '/usuarios/1/senha'],
  ['PUT', '/conta/senha'],
  ['GET', '/turmas'],
  ['POST', '/turmas'],
  ['PUT', '/turmas/1'],
  ['GET', '/estudantes'],
  ['POST', '/estudantes'],
  ['PUT', '/estudantes/1'],
  ['GET', '/categorias'],
  ['POST', '/categorias'],
  ['PUT', '/categorias/1'],
  ['POST', '/ocorrencias'],
  ['GET', '/ocorrencias'],
  ['GET', '/ocorrencias/1'],
  ['PUT', '/ocorrencias/1'],
  ['PATCH', '/ocorrencias/1/status'],
  ['POST', '/ocorrencias/1/encaminhamentos'],
  ['POST', '/ocorrencias/1/providencias'],
  ['POST', '/ocorrencias/1/comunicacoes'],
  ['GET', '/ocorrencias/1/historico'],
  ['GET', '/relatorios'],
];

beforeAll(async () => {
  await limparBanco();
  for (const perfil of PERFIS) {
    c.logados[perfil] = await criarUsuarioLogado(app, perfil);
  }
  // RN11: segunda Gestão ativa.
  await criarUsuario({ perfil: 'GESTAO' });
  c.alvo = await criarUsuario({ perfil: 'PROFESSOR' });

  c.turma = await criarTurma();
  c.turmaEditavel = await criarTurma();
  c.categoria = await criarCategoria();
  c.categoriaEditavel = await criarCategoria();
  c.estudanteSemTutor = await criarEstudante({ turmaId: c.turma.id });
  c.estudanteTutorado = await criarEstudante({ turmaId: c.turma.id, tutorId: c.logados.TUTOR.id });
  c.estudanteEditavel = await criarEstudante({ turmaId: c.turma.id });

  c.ocorrenciaForaDaVisibilidade = await ocorrenciaForaDaVisibilidade();
  c.ocorrenciaTutorado = await ocorrenciaDoTutorado();
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('Matriz de permissões: endpoint × perfil (RF14, Seção 4)', () => {
  it('a tabela cobre todos os endpoints da Seção 12', () => {
    const cobertos = new Set(MATRIZ.map((l) => `${l.metodo} ${l.rota}`));
    expect(ENDPOINTS_SECAO_12.filter((e) => !cobertos.has(e))).toEqual([]);
    expect([...cobertos].filter((e) => !ENDPOINTS_SECAO_12.includes(e))).toEqual([]);
    for (const l of MATRIZ) expect(l.codigos, `${l.metodo} ${l.rota}`).toHaveLength(PERFIS.length);
  });

  describe.each(MATRIZ)('$metodo $rota — $regra', (l) => {
    const casos = PERFIS.map((perfil, i) => ({ perfil, codigo: l.codigos[i] }));

    it.each(casos)('$perfil → $codigo', async ({ perfil, codigo }) => {
      const { url, corpo, token, publica } = await l.preparar(perfil);
      const res = await enviar(app, l.metodo, url, {
        token: publica ? undefined : (token ?? tokenDe(perfil)),
        corpo,
      });
      expect(res.status, `${l.metodo} ${url} como ${perfil}: ${JSON.stringify(res.body)}`).toBe(codigo);
      if (codigo === 403 || codigo === 404) expect(res.body.erro).toEqual(expect.any(String));
    });
  });

  it('o 403 de perfil sem permissão traz a mensagem padrão (RN01)', async () => {
    const res = await enviar(app, 'GET', '/relatorios', { token: tokenDe('PROFESSOR') });
    expect(res.status).toBe(403);
    expect(res.body.erro).toBe(MENSAGEM_PERFIL_SEM_PERMISSAO);
  });
});

describe('Visibilidade e dados reduzidos nas listas (RN19, RN20)', () => {
  it.each([
    ['PROFESSOR', false],
    ['TUTOR', false],
    ['GESTAO', true],
    ['PEDAGOGICO', true],
    ['TECNICO_ADMINISTRATIVO', false],
  ])('GET /ocorrencias como %s inclui a ocorrência sem vínculo? %s', async (perfil, ve) => {
    // Filtra pelo profissional que registrou (a Gestão): para quem não vê
    // todas, o filtro nunca amplia a visibilidade (RN19, Issue #86).
    const url = `/ocorrencias?profissionalResponsavelId=${c.logados.GESTAO.id}&dataInicio=${DIA_FATO}&dataFim=${DIA_FATO}`;
    const ids = [];
    for (let pagina = 1; ; pagina += 1) {
      const corpo = exigirStatus(await enviar(app, 'GET', `${url}&pagina=${pagina}`, { token: tokenDe(perfil) }), 200, perfil);
      ids.push(...corpo.itens.map((o) => o.id));
      if (corpo.itens.length < corpo.tamanhoPagina) break;
    }
    expect(ids.includes(c.ocorrenciaForaDaVisibilidade)).toBe(ve);
  });

  it.each(PERFIS.filter((p) => p !== 'GESTAO'))('GET /usuarios e /estudantes como %s: sem e-mail, status nem código escolar (RN20)', async (perfil) => {
    const usuarios = exigirStatus(await enviar(app, 'GET', '/usuarios', { token: tokenDe(perfil) }), 200, 'usuarios');
    expect(usuarios.length).toBeGreaterThan(0);
    for (const u of usuarios) {
      expect(Object.keys(u).sort()).toEqual(['id', 'nome', 'perfil']);
      expect(['TUTOR', 'PEDAGOGICO', 'GESTAO']).toContain(u.perfil);
    }
    const estudantes = exigirStatus(await enviar(app, 'GET', '/estudantes', { token: tokenDe(perfil) }), 200, 'estudantes');
    expect(estudantes.length).toBeGreaterThan(0);
    for (const e of estudantes) expect(e).not.toHaveProperty('codigoEscolar');
  });
});

describe('Sem token: todo endpoint protegido responde 401 (RNF03, Seção 12)', () => {
  it.each(PROTEGIDOS)('%s %s → 401', async (metodo, url) => {
    const res = await enviar(app, metodo, url, { corpo: metodo === 'GET' ? undefined : {} });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_NAO_AUTENTICADO });
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('token inválido também responde 401', async () => {
    const res = await enviar(app, 'GET', '/turmas', { token: 'token.ficticio.invalido' });
    expect(res.status).toBe(401);
  });
});

describe('Troca de senha pendente: 403 em tudo, exceto PUT /conta/senha (RN10)', () => {
  const pendentes = {};

  beforeAll(async () => {
    for (const perfil of PERFIS) {
      const u = await criarUsuario({ perfil, trocaSenhaObrigatoria: true });
      const login = await entrar(app, u.email, u.senha);
      expect(login.trocaSenhaObrigatoria).toBe(true);
      pendentes[perfil] = { ...u, token: login.token };
    }
  });

  const casos = PERFIS.flatMap((perfil) =>
    PROTEGIDOS.filter(([, url]) => url !== '/conta/senha').map(([metodo, url]) => ({ perfil, metodo, url })),
  );

  it.each(casos)('$perfil: $metodo $url → 403', async ({ perfil, metodo, url }) => {
    const res = await enviar(app, metodo, url, {
      token: pendentes[perfil].token,
      corpo: metodo === 'GET' ? undefined : {},
    });
    expect(res.status).toBe(403);
    // Corpo exato: mensagem + código estável (Subtask #115 — D1 da #72; SSD 1.9, Seção 12).
    expect(res.body).toEqual({ erro: MENSAGEM_TROCA_SENHA_OBRIGATORIA, codigo: 'TROCA_SENHA_OBRIGATORIA' });
  });

  it.each(PERFIS)('%s: PUT /conta/senha continua liberado (204) e libera o acesso após novo login', async (perfil) => {
    const u = pendentes[perfil];
    const res = await enviar(app, 'PUT', '/conta/senha', {
      token: u.token,
      corpo: { senhaAtual: u.senha, novaSenha: 'DefinitivaFicticia#2026' },
    });
    expect(res.status).toBe(204);
    const novo = await entrar(app, u.email, 'DefinitivaFicticia#2026');
    expect(novo.trocaSenhaObrigatoria).toBe(false);
    const turmas = await enviar(app, 'GET', '/turmas', { token: novo.token });
    expect(turmas.status).toBe(200);
  });
});
