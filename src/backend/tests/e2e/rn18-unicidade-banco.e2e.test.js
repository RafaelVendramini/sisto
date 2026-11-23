// RN18 garantida também no banco (Issue #129): índices únicos por expressão
// em categorias (lower(btrim(nome))) e turmas (lower(btrim(nome)),
// lower(btrim(etapa)), ano_letivo), criados pela migration
// 20261123120000_unicidade_rn18_turma_categoria.
//
// - Gravações feitas POR FORA da API (Prisma direto, como um script faria)
//   com textos equivalentes pela RN18 são recusadas pelo próprio banco (P2002).
// - Pela API, a duplicidade continua respondendo o mesmo 409, inclusive com
//   duas gravações simultâneas (a checagem do service, o conflito de
//   serialização e o índice levam ao mesmo resultado).
// App real + banco de testes real, somente dados fictícios (RN05).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { CODIGOS_ERRO } from '../../src/lib/erros.js';
import { MENSAGEM_CATEGORIA_DUPLICADA } from '../../src/services/categorias.js';
import { MENSAGEM_TURMA_DUPLICADA } from '../../src/services/turmas.js';
import {
  criarUsuario,
  desconectarPrisma,
  enviar,
  entrar,
  limparBanco,
  prisma,
} from './apoio/dados.js';

const app = criarApp();
let tokenGestao;

/** Espera a recusa do banco pelo índice único (P2002 no Prisma). */
async function esperarRecusaDoIndice(promessa, indice) {
  const erro = await promessa.then(
    () => null,
    (e) => e,
  );
  expect(erro, 'o banco deveria recusar a gravação').not.toBeNull();
  expect(erro.code).toBe('P2002');
  // Prisma 7 + adapter-pg: o nome do índice violado vem na mensagem do driver.
  expect(JSON.stringify({ mensagem: erro.message, meta: erro.meta })).toContain(indice);
}

beforeAll(async () => {
  await limparBanco();
  const gestao = await criarUsuario({ perfil: 'GESTAO' });
  await criarUsuario({ perfil: 'GESTAO' }); // RN11: duas Gestões ativas
  tokenGestao = (await entrar(app, gestao.email)).token;
});

beforeEach(async () => {
  // Cada teste parte sem turmas nem categorias (a auditoria pode acumular).
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "categorias", "turmas" RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await desconectarPrisma();
});

describe('RN18 no banco — categoria (índice categorias_nome_normalizado_key)', () => {
  it('"Bullying" e " bullying " gravadas por fora da API: o banco recusa a segunda', async () => {
    await prisma.categoria.create({ data: { nome: 'Bullying' } });
    await esperarRecusaDoIndice(
      prisma.categoria.create({ data: { nome: ' bullying ' } }),
      'categorias_nome_normalizado_key',
    );
    expect(await prisma.categoria.count()).toBe(1);
  });

  it('a edição por fora da API para um nome equivalente também é recusada', async () => {
    await prisma.categoria.create({ data: { nome: 'Indisciplina Fictícia' } });
    const outra = await prisma.categoria.create({ data: { nome: 'Conflitos Fictícios' } });
    await esperarRecusaDoIndice(
      prisma.categoria.update({ where: { id: outra.id }, data: { nome: '  INDISCIPLINA FICTÍCIA' } }),
      'categorias_nome_normalizado_key',
    );
  });

  it('nomes diferentes continuam aceitos', async () => {
    await prisma.categoria.create({ data: { nome: 'Bullying' } });
    await prisma.categoria.create({ data: { nome: 'Bullying virtual' } });
    expect(await prisma.categoria.count()).toBe(2);
  });

  it('pela API, o duplicado continua respondendo 409 CATEGORIA_DUPLICADA', async () => {
    await prisma.categoria.create({ data: { nome: 'Bullying' } });
    const res = await enviar(app, 'POST', '/categorias', {
      token: tokenGestao,
      corpo: { nome: ' bullying ' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: MENSAGEM_CATEGORIA_DUPLICADA,
      codigo: CODIGOS_ERRO.CATEGORIA_DUPLICADA,
    });
  });

  it('dois POST /categorias simultâneos com nomes equivalentes: um 201 e um 409 CATEGORIA_DUPLICADA', async () => {
    const [a, b] = await Promise.all([
      enviar(app, 'POST', '/categorias', { token: tokenGestao, corpo: { nome: 'Evasão Fictícia' } }),
      enviar(app, 'POST', '/categorias', { token: tokenGestao, corpo: { nome: ' evasão fictícia ' } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const recusada = a.status === 409 ? a : b;
    expect(recusada.body.codigo).toBe(CODIGOS_ERRO.CATEGORIA_DUPLICADA);
    expect(await prisma.categoria.count()).toBe(1);
  });
});

describe('RN18 no banco — turma (índice turmas_nome_etapa_ano_letivo_normalizado_key)', () => {
  const TURMA = { nome: '6º A Fictício', etapa: 'Ensino Fundamental', ano_letivo: 2026 };

  it('o mesmo trio com outra caixa e espaços nas pontas, gravado por fora da API: o banco recusa', async () => {
    await prisma.turma.create({ data: TURMA });
    await esperarRecusaDoIndice(
      prisma.turma.create({
        data: { nome: ' 6º a fictício ', etapa: ' ENSINO FUNDAMENTAL ', ano_letivo: 2026 },
      }),
      'turmas_nome_etapa_ano_letivo_normalizado_key',
    );
    expect(await prisma.turma.count()).toBe(1);
  });

  it('a mesma turma em outro ano letivo, ou com outra etapa, é aceita', async () => {
    await prisma.turma.create({ data: TURMA });
    await prisma.turma.create({ data: { ...TURMA, ano_letivo: 2027 } });
    await prisma.turma.create({ data: { ...TURMA, etapa: 'Ensino Médio' } });
    expect(await prisma.turma.count()).toBe(3);
  });

  it('pela API, o duplicado continua respondendo 409 TURMA_DUPLICADA', async () => {
    await prisma.turma.create({ data: TURMA });
    const res = await enviar(app, 'POST', '/turmas', {
      token: tokenGestao,
      corpo: { nome: '6º a fictício', etapa: 'ensino fundamental ', anoLetivo: 2026 },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ erro: MENSAGEM_TURMA_DUPLICADA, codigo: CODIGOS_ERRO.TURMA_DUPLICADA });
  });
});
