// Issue #128 (item 4): limite do corpo JSON e erros do leitor de JSON
// (body-parser) em português. Somente dados fictícios (RN05). Não usa o banco:
// src/lib/prisma.js é substituído; a "transação" só responde que a turma não
// existe, o que prova que o corpo passou pelo parser e por toda a validação
// do POST /ocorrencias (validarOcorrencia) antes de chegar ao banco.
// Nenhum teste depende da data real: a dataHora é relativa ao relógio atual.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({
  default: { usuario: { findUnique: mocks.findUnique }, $transaction: mocks.$transaction },
}));

const { default: app, criarApp, LIMITE_CORPO_JSON, LIMITE_CORPO_LOGIN } = await import(
  '../src/app.js'
);
const { MENSAGEM_TURMA_INEXISTENTE } = await import('../src/services/ocorrencias.js');
const { MENSAGENS_ERRO_CORPO, MENSAGEM_ERRO_CORPO_GENERICA } = await import(
  '../src/middlewares/erros.js'
);

const SEGREDO_TESTE = 'segredo-ficticio-de-teste-com-mais-de-32-caracteres';
const LIMITE_BYTES = 512 * 1024;
const MAIOR_ID = 2147483647;
let segredoOriginal;
let token;

beforeEach(() => {
  segredoOriginal = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SEGREDO_TESTE;
  mocks.findUnique.mockReset();
  mocks.findUnique.mockResolvedValue({
    id: 1,
    perfil: 'GESTAO',
    status: 'ATIVO',
    troca_senha_obrigatoria: false,
    senha_alterada_em: null,
  });
  mocks.$transaction.mockReset();
  mocks.$transaction.mockImplementation(async (operacao) =>
    operacao({ turma: { findUnique: async () => null } }),
  );
  token = jwt.sign({ id: 1, perfil: 'GESTAO' }, SEGREDO_TESTE, {
    algorithm: 'HS256',
    expiresIn: '8h',
  });
});

afterEach(() => {
  if (segredoOriginal === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = segredoOriginal;
});

/**
 * Corpo do POST /ocorrencias no maior tamanho permitido pela Seção 11 do SSD:
 * todos os textos no máximo, 50 estudantes e 10 encaminhamentos, com ids de
 * 10 dígitos. Os textos repetem `padrao` (caracteres de 1 unidade UTF-16)
 * até o tamanho máximo.
 */
function corpoPiorCaso(padrao) {
  const gerar = (n) => padrao.repeat(Math.ceil(n / padrao.length)).slice(0, n);
  const texto = gerar(5000);
  return {
    // 1 hora antes do relógio atual: válida (RN17) em qualquer data.
    dataHora: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    local: gerar(150),
    turmaId: MAIOR_ID,
    categoriaId: MAIOR_ID,
    descricao: texto,
    demaisEnvolvidos: texto,
    testemunhas: texto,
    providenciasImediatas: texto,
    observacoes: texto,
    estudanteIds: Array.from({ length: 50 }, (_, i) => MAIOR_ID - i),
    encaminhamentos: Array.from({ length: 10 }, (_, i) => ({
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      destinatarioUsuarioId: MAIOR_ID - i,
      observacao: texto,
    })),
  };
}

function postarOcorrencia(corpoBruto, contentType = 'application/json') {
  return request(app)
    .post('/ocorrencias')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', contentType)
    .send(corpoBruto);
}

describe('Limite do corpo JSON (Issue #128)', () => {
  it('o limite configurado é 512 kB', () => {
    expect(LIMITE_CORPO_JSON).toBe('512kb');
  });

  it('pior caso do SSD com acentos escapados (\\u00e9, 6 bytes por caractere) passa pelo parser e pela validação', async () => {
    // JSON só com ASCII: cada "é" vira a sequência de 6 bytes é.
    const corpoBruto = JSON.stringify(corpoPiorCaso('é')).replace(/é/g, '\\u00e9');
    const bytes = Buffer.byteLength(corpoBruto, 'utf8');
    expect(bytes).toBeGreaterThan(400 * 1024); // bem acima dos 100 kB padrão
    expect(bytes).toBeLessThanOrEqual(LIMITE_BYTES);

    const res = await postarOcorrencia(corpoBruto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('pior caso do SSD em UTF-8 cru (acentos de 2 bytes e "€" de 3 bytes) passa pelo parser e pela validação', async () => {
    // Textos mistos: "ç" e "ã" (2 bytes em UTF-8) e "€" (3 bytes).
    const corpoBruto = JSON.stringify(corpoPiorCaso('çã€'));
    const bytes = Buffer.byteLength(corpoBruto, 'utf8');
    expect(bytes).toBeGreaterThan(100 * 1024);
    expect(bytes).toBeLessThanOrEqual(LIMITE_BYTES);

    const res = await postarOcorrencia(corpoBruto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('corpo com exatamente o limite (524.288 bytes) passa pelo parser e chega à validação', async () => {
    const prefixo = '{"descricao":"';
    const sufixo = '"}';
    const corpoBruto = prefixo + 'a'.repeat(LIMITE_BYTES - prefixo.length - sufixo.length) + sufixo;
    expect(Buffer.byteLength(corpoBruto)).toBe(LIMITE_BYTES);

    const res = await postarOcorrencia(corpoBruto);

    // Recusado pela validação (falta dataHora etc.), não pelo tamanho.
    expect(res.status).toBe(400);
    expect(res.body.erro).toEqual(expect.any(String));
    expect(res.body.erro).not.toBe(MENSAGENS_ERRO_CORPO['entity.too.large']);
    expect(res.body.erro).not.toBe(MENSAGENS_ERRO_CORPO['entity.parse.failed']);
  });

  it('corpo 1 byte acima do limite responde 413 com mensagem em português', async () => {
    const prefixo = '{"descricao":"';
    const sufixo = '"}';
    const corpoBruto =
      prefixo + 'a'.repeat(LIMITE_BYTES + 1 - prefixo.length - sufixo.length) + sufixo;
    expect(Buffer.byteLength(corpoBruto)).toBe(LIMITE_BYTES + 1);

    const res = await postarOcorrencia(corpoBruto);

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: 'O corpo da requisição passa do tamanho máximo permitido.' });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('o limite é global: PUT /usuarios/{id} acima do limite também responde 413', async () => {
    const res = await request(app)
      .put('/usuarios/2')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ nome: 'a'.repeat(LIMITE_BYTES) }));

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ erro: MENSAGENS_ERRO_CORPO['entity.too.large'] });
  });
});

describe('Erros do leitor de JSON em português (Issue #128)', () => {
  it('charset não suportado responde 415 com mensagem em português', async () => {
    const res = await postarOcorrencia('{"local":"Pátio"}', 'application/json; charset=latin1');

    expect(res.status).toBe(415);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      erro: 'Codificação de caracteres não suportada no corpo da requisição. Use UTF-8.',
    });
  });

  it('Content-Encoding não suportado responde 415 com mensagem em português', async () => {
    const res = await request(app)
      .post('/ocorrencias')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{"local":"Pátio"}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({
      erro: 'Compressão (Content-Encoding) não suportada no corpo da requisição.',
    });
  });

  it('JSON malformado continua respondendo 400 com a mesma mensagem', async () => {
    const res = await postarOcorrencia('{"descricao":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: 'JSON inválido no corpo da requisição' });
  });

  it('outro erro do parser com expose usa a mensagem genérica em português, mantendo o status', async () => {
    const appComErro = criarApp({
      registrarRotasExtras: (a) => {
        a.get('/teste/erro-parser', () => {
          // Mesmo formato do erro do raw-body quando o cliente interrompe o envio.
          const erro = new Error('request aborted');
          Object.assign(erro, { status: 400, expose: true, type: 'request.aborted' });
          throw erro;
        });
      },
    });

    const res = await request(appComErro)
      .get('/teste/erro-parser')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_ERRO_CORPO_GENERICA });
    expect(res.text).not.toMatch(/aborted/);
  });

  it('erros 4xx de negócio (ErroHttp) continuam com a própria mensagem', async () => {
    const res = await postarOcorrencia(JSON.stringify(corpoPiorCaso('a')));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
  });
});

describe('Limite menor no POST /auth/login (Issue #128)', () => {
  const LIMITE_LOGIN_BYTES = 10 * 1024;
  const EMAIL = 'professor.corpo@sisto.exemplo';
  const SENHA = 'SenhaFicticia123';
  // Custo baixo: só para o teste ser rápido.
  const HASH = bcrypt.hashSync(SENHA, 4);

  beforeEach(() => {
    // O login consulta por e-mail; a autenticação das rotas protegidas, por id.
    mocks.findUnique.mockImplementation(async ({ where }) =>
      where.email === undefined || where.email === EMAIL
        ? {
            id: 1,
            nome: 'Professor Fictício do Corpo',
            perfil: 'PROFESSOR',
            status: 'ATIVO',
            senha_hash: HASH,
            troca_senha_obrigatoria: false,
            senha_alterada_em: null,
          }
        : null,
    );
  });

  /** Login com corpo de exatamente `tamanho` bytes (e-mail preenchido com "a"). */
  function corpoLoginComTamanho(tamanho) {
    const base = JSON.stringify({ email: '', senha: 'SenhaErrada123' });
    return JSON.stringify({ email: 'a'.repeat(tamanho - base.length), senha: 'SenhaErrada123' });
  }

  function postarLogin(corpoBruto) {
    // Cada teste usa um app novo: o contador de tentativas fica no app.
    return request(criarApp())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(corpoBruto);
  }

  it('o limite do login é 10 kB', () => {
    expect(LIMITE_CORPO_LOGIN).toBe('10kb');
  });

  it('login normal continua funcionando (200 com token)', async () => {
    const res = await postarLogin(JSON.stringify({ email: EMAIL, senha: SENHA }));

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.usuario).toEqual({ id: 1, nome: 'Professor Fictício do Corpo', perfil: 'PROFESSOR' });
  });

  it('login com exatamente 10 kB passa pelo parser (401 de credenciais, não 413)', async () => {
    const corpoBruto = corpoLoginComTamanho(LIMITE_LOGIN_BYTES);
    expect(Buffer.byteLength(corpoBruto)).toBe(LIMITE_LOGIN_BYTES);

    const res = await postarLogin(corpoBruto);

    expect(res.status).toBe(401);
  });

  it('login 1 byte acima de 10 kB responde 413 com a mensagem em português', async () => {
    const corpoBruto = corpoLoginComTamanho(LIMITE_LOGIN_BYTES + 1);
    expect(Buffer.byteLength(corpoBruto)).toBe(LIMITE_LOGIN_BYTES + 1);

    const res = await postarLogin(corpoBruto);

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ erro: MENSAGENS_ERRO_CORPO['entity.too.large'] });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('o limite do login vale também com barra no fim e maiúsculas no caminho', async () => {
    const corpoBruto = corpoLoginComTamanho(LIMITE_LOGIN_BYTES + 1);
    for (const caminho of ['/auth/login/', '/AUTH/Login']) {
      const res = await request(criarApp())
        .post(caminho)
        .set('Content-Type', 'application/json')
        .send(corpoBruto);
      expect(res.status).toBe(413);
      expect(res.body).toEqual({ erro: MENSAGENS_ERRO_CORPO['entity.too.large'] });
    }
  });

  it('as outras rotas continuam com 512 kB: corpo de 20 kB no POST /ocorrencias não recebe 413', async () => {
    const corpo = corpoPiorCaso('a');
    corpo.descricao = 'a'.repeat(5000);
    corpo.encaminhamentos = corpo.encaminhamentos.slice(0, 3);
    const corpoBruto = JSON.stringify(corpo);
    expect(Buffer.byteLength(corpoBruto)).toBeGreaterThan(20 * 1024);

    const res = await postarOcorrencia(corpoBruto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_INEXISTENTE });
  });
});