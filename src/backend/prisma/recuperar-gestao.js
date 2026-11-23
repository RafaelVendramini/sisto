// Script de recuperação da Gestão — Sisto (Issue #80; SSD 1.8, Seção 10).
//
// Último recurso, executado pela equipe técnica FORA da API e com acesso ao
// banco, quando nenhum usuário Gestão consegue entrar (RN11). Com DATABASE_URL
// e RECUPERACAO_SENHA_TEMPORARIA definidas no TERMINAL (o script não lê o .env):
//
//   npm run --silent recuperar-gestao -- --email gestao@exemplo.org
//
// No PowerShell, use npm.cmd (o npm.ps1 descarta o `--`); passo a passo em
// docs/deploy.md.
//
// Regras:
// - Usuário identificado pelo e-mail (argumento --email). Só usuário com
//   perfil GESTAO é aceito.
// - Senha temporária SOMENTE pela variável de ambiente
//   RECUPERACAO_SENHA_TEMPORARIA (nunca por argumento, para não ficar no
//   histórico do terminal nem na lista de processos). Mesma política do resto
//   do sistema: mínimo de 8 caracteres (RN10) e máximo de 72 bytes em UTF-8
//   (limite do bcrypt); os espaços das pontas NÃO são retirados.
// - Numa única transação: hash bcrypt (services/senha.js), troca obrigatória
//   no próximo login (RN10), senha_alterada_em atualizada com o mesmo
//   critério da troca pela API — encerra as sessões abertas (RN12) —,
//   reativação se o usuário estiver BLOQUEADO ou DESATIVADO (RN07, RN09) e
//   LogAuditoria com usuario_id nulo (ação fora da API), sem a senha (RNF04).
// - O "agora" de senha_alterada_em vem do relógio do BANCO (clock_timestamp(),
//   lido dentro da transação), não do computador que executa o script: quem
//   compara o iat dos tokens com senha_alterada_em é o servidor da API, e um
//   relógio local atrasado deixaria tokens antigos valendo (RN12).
// - O terminal mostra só o resultado: nunca a senha, o hash, a DATABASE_URL
//   nem o e-mail (RNF06).
//
// A lógica fica aqui, testável sem subprocesso (o client Prisma, os
// argumentos e o ambiente são injetados); o ponto de entrada da linha de
// comando é prisma/recuperar-gestao-cli.js (mesmo padrão de seed.js +
// seed-usuarios.js).
import { parseArgs } from 'node:util';
import { Prisma } from '@prisma/client';
import { criarPrismaClient } from '../src/lib/prisma.js';
import { ehConflitoDeSerializacao } from '../src/lib/transacao.js';
import { gerarHashSenha, mensagemPoliticaSenha } from '../src/services/senha.js';
import { normalizarEmail } from '../src/services/email.js';
import { proximaSenhaAlteradaEm } from '../src/services/troca-senha.js';
import {
  ACOES_AUDITORIA,
  recursoAuditoria,
  registrarAuditoria,
} from '../src/services/auditoria.js';

/** Variável de ambiente com a senha temporária (única forma aceita). */
export const VARIAVEL_SENHA_TEMPORARIA = 'RECUPERACAO_SENHA_TEMPORARIA';

const USO =
  'Uso: npm run --silent recuperar-gestao -- --email <e-mail-da-gestao> (no PowerShell, use npm.cmd; ver docs/deploy.md)';

export const MENSAGEM_ARGUMENTOS_INVALIDOS = `Argumentos inválidos: só o argumento --email é aceito (a senha vai na variável de ambiente ${VARIAVEL_SENHA_TEMPORARIA}). ${USO}`;
export const MENSAGEM_EMAIL_AUSENTE = `Informe o e-mail do usuário Gestão. ${USO}`;
export const MENSAGEM_SENHA_AUSENTE = `Defina a variável de ambiente ${VARIAVEL_SENHA_TEMPORARIA} com a senha temporária (ela não é aceita por argumento).`;
export const MENSAGEM_USUARIO_NAO_ENCONTRADO = 'Nenhum usuário encontrado com o e-mail informado.';
export const MENSAGEM_USUARIO_NAO_GESTAO =
  'O usuário informado não tem o perfil Gestão. O script de recuperação só redefine a senha de usuários Gestão.';
export const MENSAGEM_CONFLITO =
  'O usuário foi alterado por outra operação ao mesmo tempo. Execute o script novamente.';
export const MENSAGEM_DATABASE_URL_AUSENTE =
  'DATABASE_URL não definida. Defina-a no próprio terminal antes de executar (o script não lê o .env); ver docs/deploy.md.';
/** Prefixo das recusas de validação do próprio script (nada chegou a ser gravado). */
export const PREFIXO_RECUSA = 'Recuperação recusada — nada foi alterado.';
/**
 * Falha inesperada (conexão, gravação, COMMIT...). Não afirma que nada foi
 * alterado: a falha pode ter ocorrido depois de o banco confirmar a gravação.
 */
export const MENSAGEM_FALHA_BANCO =
  'Falha ao conectar ou gravar no banco — verifique a DATABASE_URL e confira o resultado antes de executar de novo.';

/** Tentativas da transação serializável antes de desistir (mesmo valor da troca de senha). */
const TENTATIVAS_TRANSACAO = 3;

/**
 * Erro de validação do script. A mensagem é segura para exibir: nunca
 * contém a senha, o hash, o e-mail nem a DATABASE_URL.
 */
export class ErroRecuperacaoGestao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroRecuperacaoGestao';
  }
}

/**
 * Lê o e-mail dos argumentos da linha de comando (--email x ou --email=x).
 * Qualquer outro argumento é recusado, sem repetir o valor na mensagem.
 * @param {string[]} args argumentos depois do nome do script
 * @returns {string} e-mail normalizado
 * @throws {ErroRecuperacaoGestao}
 */
export function lerEmailDosArgumentos(args) {
  let valores;
  try {
    ({ values: valores } = parseArgs({
      args,
      options: { email: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new ErroRecuperacaoGestao(MENSAGEM_ARGUMENTOS_INVALIDOS);
  }
  return validarEmail(valores.email);
}

function validarEmail(email) {
  const normalizado = typeof email === 'string' ? normalizarEmail(email) : '';
  if (!normalizado) throw new ErroRecuperacaoGestao(MENSAGEM_EMAIL_AUSENTE);
  return normalizado;
}

/**
 * Valida a senha temporária com a política do sistema (RN10 + limite do
 * bcrypt). Sem trim: espaços nas pontas fazem parte da senha.
 * @param {unknown} senha
 * @returns {string}
 * @throws {ErroRecuperacaoGestao}
 */
export function validarSenhaTemporaria(senha) {
  if (senha === undefined || senha === null || senha === '') {
    throw new ErroRecuperacaoGestao(MENSAGEM_SENHA_AUSENTE);
  }
  const problema = mensagemPoliticaSenha(senha);
  if (problema) {
    // Ex.: "RECUPERACAO_SENHA_TEMPORARIA: A senha deve ter no mínimo 8 caracteres."
    throw new ErroRecuperacaoGestao(`${VARIAVEL_SENHA_TEMPORARIA}: ${problema}`);
  }
  return senha;
}

const SELECAO_USUARIO = Object.freeze({
  id: true,
  perfil: true,
  status: true,
  senha_alterada_em: true,
});

function conferirGestao(usuario) {
  if (!usuario) throw new ErroRecuperacaoGestao(MENSAGEM_USUARIO_NAO_ENCONTRADO);
  if (usuario.perfil !== 'GESTAO') throw new ErroRecuperacaoGestao(MENSAGEM_USUARIO_NAO_GESTAO);
}

/**
 * Instante atual segundo o relógio do banco (RN12): é o mesmo referencial da
 * API em produção, independente do relógio do computador que roda o script.
 * clock_timestamp() (e não now()) dá a hora real, não a do início da transação.
 * @param {object} tx client Prisma da transação
 * @returns {Promise<Date>}
 */
async function agoraNoBanco(tx) {
  const [linha] = await tx.$queryRaw`SELECT clock_timestamp() AS agora`;
  // new Date(null) seria 1970 (válido), por isso o null é tratado à parte.
  const agora = linha?.agora == null ? null : new Date(linha.agora);
  if (!agora || Number.isNaN(agora.getTime())) {
    // Vira a mensagem genérica de falha do banco no ponto de entrada.
    throw new Error('O banco não devolveu um instante válido em clock_timestamp().');
  }
  return agora;
}

/**
 * Redefine a senha de um usuário Gestão (troca obrigatória no próximo login),
 * encerra as sessões abertas e, se ele não estiver ativo, o reativa — tudo
 * numa única transação SERIALIZABLE, junto com o LogAuditoria.
 *
 * @param {object} db client Prisma
 * @param {{ email: unknown, senha: unknown }} dados
 * @param {object} [deps]
 * @param {(senha: string) => Promise<string>} [deps.gerarHash] padrão: gerarHashSenha (custo 12)
 * @param {() => Date} [deps.agora] só para testes; padrão: relógio do banco
 *   (clock_timestamp(), lido dentro da transação)
 * @returns {Promise<{ usuarioId: number, reativado: boolean }>}
 * @throws {ErroRecuperacaoGestao} dados inválidos, usuário inexistente, sem
 *   perfil Gestão ou conflito concorrente. Falhas do banco são relançadas
 *   como estão (o ponto de entrada mostra só uma mensagem genérica).
 */
export async function recuperarGestao(
  db,
  { email, senha },
  { gerarHash = gerarHashSenha, agora } = {},
) {
  const emailNormalizado = validarEmail(email);
  const senhaTemporaria = validarSenhaTemporaria(senha);

  // Pré-checagem (evita gastar um hash bcrypt à toa); repetida na transação.
  conferirGestao(
    await db.usuario.findUnique({ where: { email: emailNormalizado }, select: SELECAO_USUARIO }),
  );

  const senha_hash = await gerarHash(senhaTemporaria);

  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const usuario = await tx.usuario.findUnique({
            where: { email: emailNormalizado },
            select: SELECAO_USUARIO,
          });
          conferirGestao(usuario);

          const instante = agora ? agora() : await agoraNoBanco(tx);
          const reativado = usuario.status !== 'ATIVO';
          await tx.usuario.update({
            where: { id: usuario.id },
            data: {
              senha_hash,
              troca_senha_obrigatoria: true, // RN10
              // RN12: mesmo critério da troca pela API (desempate por segundo),
              // com o relógio do banco como referência.
              senha_alterada_em: proximaSenhaAlteradaEm(instante, usuario.senha_alterada_em),
              ...(reativado ? { status: 'ATIVO' } : {}), // RN07, RN09
            },
            select: { id: true },
          });

          const recurso = recursoAuditoria('usuarios', usuario.id);
          await registrarAuditoria(
            {
              usuarioId: null,
              acao: ACOES_AUDITORIA.SENHA_REDEFINIDA_PELO_SCRIPT_DE_RECUPERACAO,
              recurso,
            },
            tx,
          );
          if (reativado) {
            await registrarAuditoria(
              {
                usuarioId: null,
                acao: ACOES_AUDITORIA.USUARIO_REATIVADO_PELO_SCRIPT_DE_RECUPERACAO,
                recurso,
              },
              tx,
            );
          }

          return { usuarioId: usuario.id, reativado };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (erro) {
      if (erro instanceof ErroRecuperacaoGestao) throw erro;
      // Usuário removido entre a leitura e o update (usuários não são excluídos — RN07).
      if (erro?.code === 'P2025') throw new ErroRecuperacaoGestao(MENSAGEM_USUARIO_NAO_ENCONTRADO);
      // P2034 ou o mesmo conflito detectado no COMMIT (DriverAdapterError
      // "TransactionWriteConflict" do adapter-pg — Issue #129).
      if (ehConflitoDeSerializacao(erro)) {
        if (tentativa < TENTATIVAS_TRANSACAO) continue;
        throw new ErroRecuperacaoGestao(MENSAGEM_CONFLITO);
      }
      throw erro;
    }
  }
}

/**
 * Executa o script como na linha de comando e devolve o código de saída
 * (0 = sucesso; 1 = recusado ou falha). Valida argumentos e senha antes de
 * abrir a conexão com o banco.
 * @param {object} [opcoes]
 * @param {string[]} [opcoes.args] padrão: process.argv.slice(2)
 * @param {Record<string, string | undefined>} [opcoes.env] padrão: process.env
 * @param {(databaseUrl: string) => object} [opcoes.criarCliente]
 * @param {(texto: string) => void} [opcoes.escrever] saída de sucesso
 * @param {(texto: string) => void} [opcoes.escreverErro] saída de erro
 * @param {object} [opcoes.deps] repassado a recuperarGestao (gerarHash, agora)
 * @returns {Promise<number>}
 */
export async function executarRecuperacaoGestao({
  args = process.argv.slice(2),
  env = process.env,
  criarCliente = criarPrismaClient,
  escrever = console.log,
  escreverErro = console.error,
  deps,
} = {}) {
  let db = null;
  try {
    const email = lerEmailDosArgumentos(args);
    const senha = validarSenhaTemporaria(env[VARIAVEL_SENHA_TEMPORARIA]);
    if (!env.DATABASE_URL) throw new ErroRecuperacaoGestao(MENSAGEM_DATABASE_URL_AUSENTE);

    db = criarCliente(env.DATABASE_URL);
    const { usuarioId, reativado } = await recuperarGestao(db, { email, senha }, deps);

    // Somente o id — nunca a senha, o hash, o e-mail ou a DATABASE_URL.
    escrever(
      `Recuperação concluída: senha temporária definida para o usuário Gestão de id ${usuarioId}. ` +
        'A troca de senha será obrigatória no próximo login, e as sessões abertas foram encerradas.',
    );
    if (reativado) {
      escrever('O usuário não estava ativo e foi reativado (status ATIVO).');
    }
    escrever(`Remova a variável ${VARIAVEL_SENHA_TEMPORARIA} do ambiente.`);
    return 0;
  } catch (erro) {
    // Só as mensagens do próprio script são exibidas por completo (não contêm
    // valores) — são recusas de validação, antes de qualquer gravação ou com
    // a transação desfeita. Erros do Prisma/pg podem trazer detalhes internos
    // (host, usuário, consultas) e podem ter ocorrido no COMMIT, então
    // mostramos apenas uma mensagem genérica, sem afirmar que nada mudou.
    if (erro instanceof ErroRecuperacaoGestao) {
      escreverErro(`${PREFIXO_RECUSA} ${erro.message}`);
    } else {
      escreverErro(MENSAGEM_FALHA_BANCO);
    }
    return 1;
  } finally {
    if (db) await db.$disconnect().catch(() => {});
  }
}
