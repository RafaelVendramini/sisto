// Caractere nulo (U+0000) de ponta a ponta (Issue #127): app real + banco de
// testes REAL (PostgreSQL). Confirma que o banco recusa o U+0000 (o que antes
// virava 500) e que a API agora responde 400, sem gravar nada, nos textos de
// usuários, turmas, categorias, estudantes e no e-mail do login.
// Somente dados fictícios (RN05).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { criarApp } from '../../src/app.js';
import { MENSAGEM_TEXTO_CARACTERE_INVALIDO } from '../../src/lib/texto.js';
import {
  criarCategoria,
  criarEstudante,
  criarTurma,
  criarUsuario,
  criarUsuarioLogado,
  desconectarPrisma,
  enviar,
  limparBanco,
  prisma,
} from './apoio/dados.js';

const app = criarApp();
const NULO = '\u0000';

let gestao;
let professor;
let turma;
let categoria;
let estudante;

beforeAll(async () => {
  await limparBanco();
  gestao = await criarUsuarioLogado(app, 'GESTAO');
  await criarUsuario({ perfil: 'GESTAO' }); // RN11: segunda Gestão ativa
  professor = await criarUsuario({ perfil: 'PROFESSOR' });
  turma = await criarTurma();
  categoria = await criarCategoria();
  estudante = await criarEstudante({ turmaId: turma.id });
});

afterAll(async () => {
  await desconectarPrisma();
});

/** Contagem das tabelas afetadas, para provar que nada foi gravado. */
async function contagens() {
  const [usuarios, turmas, categorias, estudantes, logs] = await Promise.all([
    prisma.usuario.count(),
    prisma.turma.count(),
    prisma.categoria.count(),
    prisma.estudante.count(),
    prisma.logAuditoria.count(),
  ]);
  return { usuarios, turmas, categorias, estudantes, logs };
}

describe('Premissa: o PostgreSQL recusa o U+0000 em texto', () => {
  it('gravar direto pelo Prisma falha (sem a checagem, a API responderia 500)', async () => {
    await expect(
      prisma.categoria.create({ data: { nome: `Categoria${NULO}Fictícia` } }),
    ).rejects.toThrow();
  });
});

describe('API: U+0000 recusado com 400, sem gravar nada', () => {
  const casos = () => [
    ['POST /usuarios — nome', 'POST', '/usuarios', { nome: `Nome${NULO}`, email: 'nulo.1@escola-ficticia.test', perfil: 'PROFESSOR', senha: 'SenhaFicticia#2026' }],
    ['POST /usuarios — email', 'POST', '/usuarios', { nome: 'Nome Fictício', email: `nulo${NULO}.2@escola-ficticia.test`, perfil: 'PROFESSOR', senha: 'SenhaFicticia#2026' }],
    ['PUT /usuarios/{id} — nome', 'PUT', `/usuarios/${professor.id}`, { nome: `Nome${NULO}` }],
    ['PUT /usuarios/{id} — email', 'PUT', `/usuarios/${professor.id}`, { email: `nulo${NULO}@escola-ficticia.test` }],
    ['POST /turmas — nome', 'POST', '/turmas', { nome: `Turma${NULO}`, etapa: 'Ensino Médio', anoLetivo: 2026 }],
    ['POST /turmas — etapa', 'POST', '/turmas', { nome: 'Turma Nula', etapa: `Ensino${NULO}Médio`, anoLetivo: 2026 }],
    ['PUT /turmas/{id} — nome', 'PUT', `/turmas/${turma.id}`, { nome: `Turma${NULO}`, etapa: 'Ensino Médio', anoLetivo: 2026 }],
    ['POST /categorias — nome', 'POST', '/categorias', { nome: `Categoria${NULO}` }],
    ['POST /categorias — descricao', 'POST', '/categorias', { nome: 'Categoria Nula', descricao: `Desc${NULO}` }],
    ['PUT /categorias/{id} — descricao', 'PUT', `/categorias/${categoria.id}`, { nome: categoria.nome, descricao: `Desc${NULO}` }],
    ['POST /estudantes — nomeCompleto', 'POST', '/estudantes', { nomeCompleto: `Estudante${NULO}`, turmaId: turma.id }],
    ['POST /estudantes — codigoEscolar', 'POST', '/estudantes', { nomeCompleto: 'Estudante Nulo', codigoEscolar: `FIC${NULO}`, turmaId: turma.id }],
    ['PUT /estudantes/{id} — codigoEscolar', 'PUT', `/estudantes/${estudante.id}`, { nomeCompleto: estudante.nome_completo, codigoEscolar: `FIC${NULO}`, turmaId: turma.id }],
  ];

  it('cada texto de entrada responde 400 com a mensagem comum', async () => {
    const antes = await contagens();
    for (const [descricao, metodo, url, corpo] of casos()) {
      const res = await enviar(app, metodo, url, { token: gestao.token, corpo });
      expect(res.status, descricao).toBe(400);
      expect(res.body, descricao).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
    }
    expect(await contagens()).toEqual(antes);
    // Os registros editados continuam com os valores originais.
    const professorDepois = await prisma.usuario.findUnique({ where: { id: professor.id } });
    expect(professorDepois.nome).toBe(professor.nome);
    expect(professorDepois.email).toBe(professor.email);
  });

  it('POST /auth/login com U+0000 no e-mail: 400 (não 500)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: `${gestao.email}${NULO}`, senha: gestao.senha });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ erro: MENSAGEM_TEXTO_CARACTERE_INVALIDO });
  });
});
