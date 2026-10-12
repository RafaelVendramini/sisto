// Lógica do seed de usuários fictícios — Sisto (Subtask #9).
// Separada da execução (prisma/seed.js) para ser testada sem banco: o client
// Prisma e as variáveis de ambiente são injetados.
//
// Regras:
// - Somente dados fictícios (RN05, RNF06). Todos os usuários criados com status ATIVO.
// - O usuário de Gestão é o primeiro administrador do sistema (inclusive em
//   produção): e-mail e senha vêm do .env (SEED_GESTAO_EMAIL / SEED_GESTAO_SENHA).
// - Ambiente (decisão do Rafael):
//   - NODE_ENV === 'production': cria SOMENTE o usuário de Gestão;
//     SEED_SENHA_USUARIOS não é exigida (e é ignorada).
//   - Qualquer outro ambiente: cria 1 usuário por perfil (5 no total); os 4
//     fictícios não-Gestão usam a senha SEED_SENHA_USUARIOS.
// - Nenhuma senha no código. Senhas com no mínimo 8 caracteres (RN10), no
//   máximo 72 bytes (limite técnico do bcrypt), sem o prefixo de exemplo
//   "TROQUE_" do .env.example; gravadas só como hash bcrypt (RNF03).
// - Idempotente: upsert pelo e-mail. Usuário já existente NÃO é alterado
//   (senha, perfil, status e nome são preservados), para que uma nova execução
//   não reative usuário bloqueado/desativado nem troque senha em produção.
//   Só os usuários ausentes são criados.
import { gerarHashSenha, mensagemPoliticaSenha, CUSTO_BCRYPT } from '../src/services/senha.js';

/**
 * Erro de validação do próprio seed (variáveis de ambiente). A mensagem é
 * segura para exibir: nunca contém valores das variáveis.
 */
export class ErroValidacaoSeed extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroValidacaoSeed';
  }
}

/**
 * Prefixo dos valores de exemplo do .env.example (publicado no repositório).
 * Senha com esse prefixo é recusada: seria uma senha conhecida publicamente.
 */
export const PREFIXO_SENHA_EXEMPLO = 'TROQUE_';

/** Nomes das variáveis de ambiente usadas pelo seed. */
export const VARIAVEIS_SEED = Object.freeze({
  gestaoEmail: 'SEED_GESTAO_EMAIL',
  gestaoSenha: 'SEED_GESTAO_SENHA',
  senhaUsuarios: 'SEED_SENHA_USUARIOS',
});

/**
 * Usuários fictícios fixos (exceto Gestão, cujo e-mail vem do .env).
 * Domínio "sisto.exemplo" (TLD inexistente) para deixar claro que são fictícios.
 */
export const USUARIOS_FICTICIOS = Object.freeze([
  { nome: 'Professor Exemplo', email: 'professor@sisto.exemplo', perfil: 'PROFESSOR' },
  { nome: 'Tutor Exemplo', email: 'tutor@sisto.exemplo', perfil: 'TUTOR' },
  { nome: 'Pedagógico Exemplo', email: 'pedagogico@sisto.exemplo', perfil: 'PEDAGOGICO' },
  {
    nome: 'Técnico-administrativo Exemplo',
    email: 'tecnico.administrativo@sisto.exemplo',
    perfil: 'TECNICO_ADMINISTRATIVO',
  },
]);

/** Nome do usuário de Gestão (administrador inicial). */
export const NOME_GESTAO = 'Administrador da Gestão';

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Em produção o seed cria somente o usuário de Gestão. */
export function ehProducao(env) {
  return env.NODE_ENV === 'production';
}

/** Normaliza e-mail: remove espaços nas pontas e converte para minúsculas (RF02). */
export function normalizarEmail(email) {
  return String(email).trim().toLowerCase();
}

/**
 * Valida as variáveis de ambiente do seed. Nunca inclui os valores nas
 * mensagens de erro (podem ser senhas).
 * Em produção (NODE_ENV === 'production') SEED_SENHA_USUARIOS não é exigida.
 * @param {Record<string, string | undefined>} env
 * @returns {{ somenteGestao: boolean, gestaoEmail: string, gestaoSenha: string, senhaUsuarios: string | null }}
 * @throws {ErroValidacaoSeed} lista todos os problemas encontrados
 */
export function validarVariaveisSeed(env) {
  const erros = [];
  const ler = (nome) => (typeof env[nome] === 'string' ? env[nome] : '');
  const somenteGestao = ehProducao(env);
  const senhasExigidas = somenteGestao
    ? [VARIAVEIS_SEED.gestaoSenha]
    : [VARIAVEIS_SEED.gestaoSenha, VARIAVEIS_SEED.senhaUsuarios];

  const emailBruto = ler(VARIAVEIS_SEED.gestaoEmail);
  const gestaoEmail = normalizarEmail(emailBruto);
  if (!gestaoEmail) {
    erros.push(`${VARIAVEIS_SEED.gestaoEmail} não definida.`);
  } else if (!FORMATO_EMAIL.test(gestaoEmail)) {
    erros.push(`${VARIAVEIS_SEED.gestaoEmail} não é um e-mail válido.`);
  } else if (USUARIOS_FICTICIOS.some((u) => u.email === gestaoEmail)) {
    erros.push(`${VARIAVEIS_SEED.gestaoEmail} não pode repetir o e-mail de outro usuário do seed.`);
  }

  for (const nome of senhasExigidas) {
    const valor = ler(nome);
    const problema = valor ? mensagemPoliticaSenha(valor) : null;
    if (!valor) {
      erros.push(`${nome} não definida.`);
    } else if (valor.toUpperCase().startsWith(PREFIXO_SENHA_EXEMPLO)) {
      erros.push(`${nome} ainda usa o valor de exemplo do .env.example; defina uma senha própria.`);
    } else if (problema) {
      // Ex.: "SEED_GESTAO_SENHA: A senha deve ter no mínimo 8 caracteres."
      erros.push(`${nome}: ${problema}`);
    }
  }

  if (erros.length > 0) {
    throw new ErroValidacaoSeed(
      `Seed abortado — nada foi gravado. Ajuste o .env do back-end (veja .env.example):\n- ${erros.join('\n- ')}`,
    );
  }

  return {
    somenteGestao,
    gestaoEmail,
    gestaoSenha: ler(VARIAVEIS_SEED.gestaoSenha),
    senhaUsuarios: somenteGestao ? null : ler(VARIAVEIS_SEED.senhaUsuarios),
  };
}

/**
 * Monta a lista de usuários do seed (com hash bcrypt, sem senha em texto).
 * @param {ReturnType<typeof validarVariaveisSeed>} config
 * @param {{ custoBcrypt?: number }} [opcoes] custoBcrypt: padrão CUSTO_BCRYPT (12);
 *   valores menores só em testes, para acelerar.
 * @returns {Promise<Array<{nome: string, email: string, senha_hash: string, perfil: string, status: 'ATIVO'}>>}
 */
export async function montarUsuariosSeed(config, { custoBcrypt = CUSTO_BCRYPT } = {}) {
  const definicoes = [
    { nome: NOME_GESTAO, email: config.gestaoEmail, perfil: 'GESTAO', senha: config.gestaoSenha },
    // Em produção, apenas o administrador de Gestão.
    ...(config.somenteGestao
      ? []
      : USUARIOS_FICTICIOS.map((u) => ({ ...u, senha: config.senhaUsuarios }))),
  ];

  // Um hash por usuário (salt próprio), mesmo quando a senha é a mesma.
  return Promise.all(
    definicoes.map(async ({ nome, email, perfil, senha }) => ({
      nome,
      email: normalizarEmail(email),
      senha_hash: await gerarHashSenha(senha, custoBcrypt),
      perfil,
      status: 'ATIVO',
    })),
  );
}

/**
 * Executa o seed de usuários com o client Prisma informado.
 * Valida tudo antes de qualquer acesso ao banco; grava em uma única transação.
 * @param {object} prisma PrismaClient (ou fake com usuario.findMany/upsert e $transaction)
 * @param {Record<string, string | undefined>} [env] padrão: process.env
 * @param {{ custoBcrypt?: number }} [opcoes] ver montarUsuariosSeed
 * @returns {Promise<{ criados: Array<{email: string, perfil: string}>, existentes: Array<{email: string, perfil: string}> }>}
 *   sem senhas nem hashes
 */
export async function executarSeedUsuarios(prisma, env = process.env, opcoes = {}) {
  const config = validarVariaveisSeed(env);
  const usuarios = await montarUsuariosSeed(config, opcoes);
  const emails = usuarios.map((u) => u.email);

  const jaExistentes = await prisma.usuario.findMany({
    where: { email: { in: emails } },
    select: { email: true },
  });
  const existentes = new Set(jaExistentes.map((u) => u.email));

  // update vazio: usuário existente é mantido como está (ver cabeçalho).
  await prisma.$transaction(
    usuarios.map((usuario) =>
      prisma.usuario.upsert({
        where: { email: usuario.email },
        update: {},
        create: usuario,
        select: { id: true },
      }),
    ),
  );

  const resumo = usuarios.map(({ email, perfil }) => ({ email, perfil }));
  return {
    criados: resumo.filter((u) => !existentes.has(u.email)),
    existentes: resumo.filter((u) => existentes.has(u.email)),
  };
}
