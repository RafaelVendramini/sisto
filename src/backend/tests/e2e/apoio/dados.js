// Apoio dos testes de ponta a ponta (Issue #93): limpeza do banco de TESTE,
// criação de dados fictícios (RN05) e chamadas HTTP à app real (Supertest).
//
// Os usuários, turmas, categorias e estudantes de base são gravados direto
// pelo Prisma (dados de partida); tudo o que o teste quer verificar passa
// pela API — login real, JWT real, rotas e services reais, banco real.
import bcrypt from 'bcrypt';
import request from 'supertest';
import prisma, { desconectarPrisma } from '../../../src/lib/prisma.js';
import { nomeBancoDeTeste } from './ambiente.js';

export { prisma, desconectarPrisma };

/**
 * Os 6 perfis (RF01), na ordem das colunas da matriz da Seção 4. O Psicólogo
 * escolar (PSICOLOGO) entrou no SSD 1.18 (Issues #152 e #154).
 */
export const PERFIS = Object.freeze([
  'PROFESSOR',
  'TUTOR',
  'PSICOLOGO',
  'GESTAO',
  'PEDAGOGICO',
  'TECNICO_ADMINISTRATIVO',
]);

/** Senha fictícia padrão dos usuários de teste (8+ caracteres — RN10). */
export const SENHA_PADRAO = 'SenhaFicticia#2026';

/** Data/hora fictícia do fato (no passado — RN17), em São Paulo. */
export const DATA_HORA_FATO = '2026-03-10T10:00:00-03:00';
/** Dia de DATA_HORA_FATO no formato dos filtros (AAAA-MM-DD). */
export const DIA_FATO = '2026-03-10';

// Todas as tabelas da Seção 11 (nomes do @@map do schema.prisma).
const TABELAS = [
  'historicos_ocorrencia',
  'comunicacoes',
  'providencias',
  'encaminhamentos',
  'ocorrencias_estudantes',
  'ocorrencias',
  'estudantes',
  'turmas',
  'categorias',
  'logs_auditoria',
  'usuarios',
];

/**
 * Apaga TODOS os dados do banco de testes e reinicia os ids. Confere duas
 * vezes que é o banco de testes: pela DATABASE_URL e pelo banco de fato
 * conectado (current_database()).
 */
export async function limparBanco() {
  nomeBancoDeTeste(process.env.DATABASE_URL);
  let banco;
  try {
    [{ banco }] = await prisma.$queryRaw`SELECT current_database() AS banco`;
  } catch (erro) {
    throw new Error(
      `Testes e2e: não foi possível conectar ao banco de testes (${erro.message}). ` +
        'Confira se o PostgreSQL está rodando e a DATABASE_URL do .env.test.',
      { cause: erro },
    );
  }
  if (!String(banco).endsWith('_test')) {
    throw new Error(`Testes e2e abortados: conectado ao banco "${banco}", que não termina em "_test".`);
  }
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABELAS.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  } catch (erro) {
    throw new Error(
      `Testes e2e: falha ao limpar as tabelas (${erro.message}). ` +
        'As migrations foram aplicadas? Rode `npm run db:test:reset`.',
      { cause: erro },
    );
  }
}

const hashes = new Map();
/** Hash bcrypt de custo baixo (só teste): o login compara com o hash real. */
async function hashDe(senha) {
  if (!hashes.has(senha)) hashes.set(senha, await bcrypt.hash(senha, 4));
  return hashes.get(senha);
}

let sequencia = 0;
/** Sufixo único para e-mails, nomes e códigos fictícios. */
export function proximo() {
  sequencia += 1;
  return sequencia;
}

/**
 * Grava um usuário fictício direto no banco (dado de partida).
 * @returns {Promise<{ id: number, nome: string, email: string, perfil: string, senha: string }>}
 */
export async function criarUsuario({
  perfil,
  senha = SENHA_PADRAO,
  status = 'ATIVO',
  trocaSenhaObrigatoria = false,
  nome,
} = {}) {
  const n = proximo();
  const email = `${perfil.toLowerCase()}.${n}@escola-ficticia.test`;
  const usuario = await prisma.usuario.create({
    data: {
      nome: nome ?? `Usuário Fictício ${perfil} ${n}`,
      email,
      senha_hash: await hashDe(senha),
      perfil,
      status,
      troca_senha_obrigatoria: trocaSenhaObrigatoria,
    },
    select: { id: true, nome: true, email: true, perfil: true },
  });
  return { ...usuario, senha };
}

/** POST /auth/login real; exige 200 e devolve o corpo ({ token, usuario, trocaSenhaObrigatoria }). */
export async function entrar(app, email, senha = SENHA_PADRAO) {
  const res = await request(app).post('/auth/login').send({ email, senha });
  if (res.status !== 200) {
    throw new Error(`Login fictício falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Cria um usuário e faz login pela API. */
export async function criarUsuarioLogado(app, perfil, opcoes = {}) {
  const usuario = await criarUsuario({ perfil, ...opcoes });
  const { token } = await entrar(app, usuario.email, usuario.senha);
  return { ...usuario, token };
}

export async function criarTurma(nome = `Turma Fictícia ${proximo()}`) {
  return prisma.turma.create({
    data: { nome, etapa: 'Ensino Fundamental II', ano_letivo: 2026 },
    select: { id: true, nome: true },
  });
}

export async function criarCategoria(nome = `Categoria Fictícia ${proximo()}`) {
  return prisma.categoria.create({ data: { nome }, select: { id: true, nome: true } });
}

export async function criarEstudante({ turmaId, tutorId = null }) {
  const n = proximo();
  return prisma.estudante.create({
    data: {
      nome_completo: `Estudante Fictício ${n}`,
      codigo_escolar: `FIC-${n}`,
      turma_id: turmaId,
      tutor_id: tutorId,
    },
    select: { id: true, nome_completo: true },
  });
}

/**
 * Requisição à app real. Sem `token`, vai sem o cabeçalho Authorization.
 * @param {import('express').Express} app
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} metodo
 * @param {string} url
 * @param {{ token?: string, corpo?: object }} [opcoes]
 */
export function enviar(app, metodo, url, { token, corpo } = {}) {
  let req = request(app)[metodo.toLowerCase()](url);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  if (corpo !== undefined) req = req.send(corpo);
  return req;
}

/** Exige o código HTTP esperado, mostrando o corpo da resposta se falhar. */
export function exigirStatus(res, esperado, contexto = '') {
  if (res.status !== esperado) {
    throw new Error(
      `${contexto} esperava HTTP ${esperado}, recebeu ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

/** POST /ocorrencias pela API (201), com encaminhamento inicial para a Gestão (RN03). */
export async function registrarOcorrencia(
  app,
  token,
  { turmaId, categoriaId, estudanteIds, encaminhamentos = [{ destinatarioPerfil: 'GESTAO' }], dataHora = DATA_HORA_FATO },
) {
  const res = await enviar(app, 'POST', '/ocorrencias', {
    token,
    corpo: {
      dataHora,
      local: 'Pátio (fictício)',
      turmaId,
      categoriaId,
      descricao: 'Descrição objetiva e fictícia do fato, para teste (RN05, RN06).',
      estudanteIds,
      encaminhamentos,
    },
  });
  return exigirStatus(res, 201, 'POST /ocorrencias');
}

/**
 * POST /ocorrencias/{id}/encaminhamentos pela API (201), definindo o responsável (RN15).
 * `observacao` é a justificativa obrigatória no encaminhamento ao psicólogo (RN03, SSD 1.18).
 */
export async function encaminhar(
  app,
  token,
  ocorrenciaId,
  { destinatarioPerfil, destinatarioUsuarioId, responsavelAcompanhamentoId, observacao },
) {
  const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/encaminhamentos`, {
    token,
    corpo: { destinatarioPerfil, destinatarioUsuarioId, responsavelAcompanhamentoId, observacao },
  });
  return exigirStatus(res, 201, 'POST encaminhamentos');
}

/** POST /ocorrencias/{id}/providencias pela API (201). */
export async function providenciar(app, token, ocorrenciaId) {
  const res = await enviar(app, 'POST', `/ocorrencias/${ocorrenciaId}/providencias`, {
    token,
    corpo: { descricao: 'Providência fictícia: conversa orientadora com o estudante.' },
  });
  return exigirStatus(res, 201, 'POST providencias');
}

/** Corpo válido de comunicação (RN16, RN17), com dados fictícios. */
export function corpoComunicacao() {
  return {
    destinatario: 'Responsável legal (fictício)',
    meio: 'Telefone',
    descricao: 'Contato fictício com a família para informar o ocorrido.',
    dataHora: DATA_HORA_FATO,
  };
}
