// Testes do caractere nulo (U+0000) fora das ocorrências (Issue #127).
// O PostgreSQL não grava U+0000 em texto (erro 22021); sem a checagem, a API
// responderia 500. Aqui se confere que cada texto de entrada é recusado com
// 400 e a mensagem comum de lib/texto.js, ANTES de qualquer consulta ou
// gravação no banco. Somente dados fictícios (RN05).
// Não dependem do banco: src/lib/prisma.js é substituído por espiões (a
// única consulta esperada é a da sessão, em usuario.findUnique).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => {
  const metodos = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  });
  return {
    usuario: metodos(),
    turma: metodos(),
    categoria: metodos(),
    estudante: metodos(),
    logAuditoria: metodos(),
    $transaction: vi.fn(),
  };
});

vi.mock('../src/lib/prisma.js', () => ({ default: mocks }));

const { default: app } = await import('../src/app.js');
const {
  MENSAGEM_TEXTO_CARACTERE_INVALIDO,
  contemCaractereNulo,
  garantirSemCaractereNulo,
} = await import('../src/lib/texto.js');
const ocorrencias = await import('../src/services/ocorrencias.js');
const { ErroHttp } = await import('../src/lib/erros.js');
const { CHAVE_LIMITADORES, criarLimitadoresTentativas, LIMITE_TENTATIVAS_COM_FALHA } =
  await import('../src/middlewares/limite-tentativas.js');
const { MENSAGEM_CREDENCIAIS_INVALIDAS } = await import('../src/services/auth.js');

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const ID_GESTAO = 1;
const NULO = '\u0000';
const ERRO_CARACTERE = { erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO };

/** Usuário da sessão (Gestão ativa, sem troca pendente). */
const GESTAO_SESSAO = {
  id: ID_GESTAO,
  perfil: 'GESTAO',
  status: 'ATIVO',
  troca_senha_obrigatoria: false,
  senha_alterada_em: null,
};

let token;

function todosOsEspioes() {
  return [
    ...['usuario', 'turma', 'categoria', 'estudante', 'logAuditoria'].flatMap((modelo) =>
      Object.values(mocks[modelo]),
    ),
    mocks.$transaction,
  ];
}

beforeEach(() => {
  process.env.JWT_SECRET = SEGREDO_TESTE;
  app.locals[CHAVE_LIMITADORES] = criarLimitadoresTentativas();
  for (const espiao of todosOsEspioes()) espiao.mockReset();
  mocks.usuario.findUnique.mockImplementation(async ({ where }) =>
    where.id === ID_GESTAO ? { ...GESTAO_SESSAO } : null,
  );
  token = jwt.sign({ id: ID_GESTAO, perfil: 'GESTAO' }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
});

afterEach(() => {
  delete process.env.JWT_SECRET;
});

/** Nenhuma consulta além da sessão (usuario.findUnique por id) e nenhuma gravação. */
function esperarBancoIntocado() {
  for (const espiao of todosOsEspioes()) {
    if (espiao === mocks.usuario.findUnique) continue;
    expect(espiao).not.toHaveBeenCalled();
  }
  for (const [argumentos] of mocks.usuario.findUnique.mock.calls) {
    expect(argumentos.where).toEqual({ id: ID_GESTAO });
  }
}

function enviar(metodo, caminho, corpo) {
  return request(app)[metodo](caminho).set('Authorization', `Bearer ${token}`).send(corpo);
}

// ---------------------------------------------------------------------------
// Módulo comum (lib/texto.js)
// ---------------------------------------------------------------------------

describe('lib/texto.js', () => {
  it('detecta o U+0000 em qualquer posição', () => {
    expect(contemCaractereNulo(`${NULO}abc`)).toBe(true);
    expect(contemCaractereNulo(`a${NULO}c`)).toBe(true);
    expect(contemCaractereNulo(`abc${NULO}`)).toBe(true);
    expect(contemCaractereNulo(NULO)).toBe(true);
    expect(contemCaractereNulo('Texto fictício sem nulo')).toBe(false);
    expect(contemCaractereNulo('')).toBe(false);
    // "\0" escrito como texto (barra + zero) não é o caractere nulo.
    expect(contemCaractereNulo('\\0 e \\u0000')).toBe(false);
  });

  it('garantirSemCaractereNulo lança ErroHttp 400 com a mensagem comum', () => {
    expect(() => garantirSemCaractereNulo('sem nulo')).not.toThrow();
    let erro;
    try {
      garantirSemCaractereNulo(`com${NULO}nulo`);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroHttp);
    expect(erro.status).toBe(400);
    expect(erro.message).toBe(MENSAGEM_TEXTO_CARACTERE_INVALIDO);
  });

  it('services/ocorrencias.js continua exportando a MESMA mensagem', () => {
    expect(ocorrencias.MENSAGEM_TEXTO_CARACTERE_INVALIDO).toBe(MENSAGEM_TEXTO_CARACTERE_INVALIDO);
    expect(MENSAGEM_TEXTO_CARACTERE_INVALIDO).toBe(
      'O texto contém um caractere inválido. Remova-o e tente novamente.',
    );
  });
});

// ---------------------------------------------------------------------------
// Cadastros: 400 antes de qualquer acesso ao banco
// ---------------------------------------------------------------------------

const USUARIO_VALIDO = {
  nome: 'Usuário Fictício Nulo',
  email: 'ficticio.nulo@sisto.exemplo',
  perfil: 'PROFESSOR',
  senha: 'SenhaFicticia123',
};
const TURMA_VALIDA = { nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2026 };
const CATEGORIA_VALIDA = { nome: 'Categoria Fictícia', descricao: 'Descrição fictícia.' };
const ESTUDANTE_VALIDO = { nomeCompleto: 'Estudante Fictício', codigoEscolar: 'FIC-001', turmaId: 1 };

const CASOS = [
  // [descrição, método, caminho, corpo]
  ['POST /usuarios — nome', 'post', '/usuarios', { ...USUARIO_VALIDO, nome: `Usuário${NULO}Fictício` }],
  ['POST /usuarios — nome só com U+0000', 'post', '/usuarios', { ...USUARIO_VALIDO, nome: NULO }],
  ['POST /usuarios — email', 'post', '/usuarios', { ...USUARIO_VALIDO, email: `ficticio${NULO}@sisto.exemplo` }],
  ['PUT /usuarios/{id} — nome', 'put', '/usuarios/2', { nome: `Nome${NULO}` }],
  ['PUT /usuarios/{id} — email', 'put', '/usuarios/2', { email: `ficticio@sisto.exemplo${NULO}` }],
  ['POST /turmas — nome', 'post', '/turmas', { ...TURMA_VALIDA, nome: `1º${NULO}A` }],
  ['POST /turmas — etapa', 'post', '/turmas', { ...TURMA_VALIDA, etapa: `Ensino${NULO}Médio` }],
  ['PUT /turmas/{id} — nome', 'put', '/turmas/1', { ...TURMA_VALIDA, nome: `${NULO}1º A` }],
  ['PUT /turmas/{id} — etapa', 'put', '/turmas/1', { ...TURMA_VALIDA, etapa: `Ensino Médio${NULO}` }],
  ['POST /categorias — nome', 'post', '/categorias', { ...CATEGORIA_VALIDA, nome: `Categoria${NULO}` }],
  ['POST /categorias — descricao', 'post', '/categorias', { ...CATEGORIA_VALIDA, descricao: `Desc${NULO}rição` }],
  ['POST /categorias — descricao só com U+0000', 'post', '/categorias', { ...CATEGORIA_VALIDA, descricao: NULO }],
  ['PUT /categorias/{id} — nome', 'put', '/categorias/1', { nome: `Cat${NULO}egoria` }],
  ['PUT /categorias/{id} — descricao', 'put', '/categorias/1', { ...CATEGORIA_VALIDA, descricao: `${NULO}` }],
  ['POST /estudantes — nomeCompleto', 'post', '/estudantes', { ...ESTUDANTE_VALIDO, nomeCompleto: `Estudante${NULO}Fictício` }],
  ['POST /estudantes — codigoEscolar', 'post', '/estudantes', { ...ESTUDANTE_VALIDO, codigoEscolar: `FIC${NULO}001` }],
  ['PUT /estudantes/{id} — nomeCompleto', 'put', '/estudantes/1', { ...ESTUDANTE_VALIDO, nomeCompleto: `${NULO}Estudante` }],
  ['PUT /estudantes/{id} — codigoEscolar', 'put', '/estudantes/1', { ...ESTUDANTE_VALIDO, codigoEscolar: `FIC-001${NULO}` }],
];

describe('U+0000 nos cadastros: 400 com a mensagem comum, sem tocar no banco', () => {
  it.each(CASOS)('%s', async (_descricao, metodo, caminho, corpo) => {
    const res = await enviar(metodo, caminho, corpo);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(ERRO_CARACTERE);
    esperarBancoIntocado();
  });

  it('a mensagem do 400 não repete o texto enviado (nem o e-mail)', async () => {
    const email = `fulano.ficticio${NULO}@sisto.exemplo`;
    const res = await enviar('post', '/usuarios', { ...USUARIO_VALIDO, email });

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('fulano.ficticio');
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('POST /auth/login com U+0000 no e-mail', () => {
  function login(corpo) {
    return request(app).post('/auth/login').send(corpo);
  }

  it('400 genérico, sem consultar o banco', async () => {
    const res = await login({ email: `gestao${NULO}@sisto.exemplo`, senha: 'SenhaFicticia123' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(ERRO_CARACTERE);
    expect(mocks.usuario.findUnique).not.toHaveBeenCalled();
  });

  it('a resposta não revela se o e-mail existe (mesmo corpo para cadastrado e inexistente)', async () => {
    // Um e-mail "cadastrado" (o mock o encontraria sem o U+0000) e um inexistente.
    mocks.usuario.findUnique.mockImplementation(async ({ where }) =>
      where.email === 'gestao@sisto.exemplo'
        ? { ...GESTAO_SESSAO, nome: 'Gestão Fictícia', senha_hash: 'hash-ficticio' }
        : null,
    );

    const existente = await login({ email: `gestao@sisto.exemplo${NULO}`, senha: 'SenhaFicticia123' });
    const inexistente = await login({ email: `ninguem@sisto.exemplo${NULO}`, senha: 'SenhaFicticia123' });

    expect(existente.status).toBe(400);
    expect(inexistente.status).toBe(400);
    expect(existente.body).toEqual(inexistente.body);
    expect(existente.body).toEqual(ERRO_CARACTERE);
    expect(mocks.usuario.findUnique).not.toHaveBeenCalled();
    expect(existente.text).not.toContain('gestao');
  });

  it('não soma no limite de tentativas (só o 401 conta — Seção 12)', async () => {
    const corpo = { email: `gestao${NULO}@sisto.exemplo`, senha: 'SenhaFicticia123' };
    for (let i = 0; i < LIMITE_TENTATIVAS_COM_FALHA + 2; i += 1) {
      const res = await login(corpo);
      expect(res.status).toBe(400);
    }
  });

  it('U+0000 na senha não causa 500: credencial inválida (401) como qualquer senha errada', async () => {
    mocks.usuario.findUnique.mockResolvedValue(null);

    const res = await login({ email: 'ninguem@sisto.exemplo', senha: `Senha${NULO}Ficticia` });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ erro: MENSAGEM_CREDENCIAIS_INVALIDAS });
  });
});
