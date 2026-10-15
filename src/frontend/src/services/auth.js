// Serviço de autenticação (RF02, RNF03).
//
// Armazenamento: sessionStorage (a sessão termina ao fechar a aba/navegador),
// nunca localStorage. Guardamos apenas o token JWT e os dados mínimos para
// exibição do usuário logado ({ id, nome, perfil }). A senha nunca é guardada.
// Se a troca de senha for obrigatória (RN10), guarda também o indicador
// `trocaSenhaObrigatoria: true` (só quando verdadeiro).
// O token expira em 8h (RNF03); a expiração lida do próprio token é
// respeitada aqui, e o back-end continua sendo a proteção real (401).
import { ErroApi, api, requisicao } from './api.js';

const CHAVE_SESSAO = 'sisto.sessao';

function lerArmazenamento() {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_SESSAO);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function gravarArmazenamento(sessao) {
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
  } catch {
    // Armazenamento indisponível (ex.: modo restrito do navegador):
    // o login continua válido só enquanto a página estiver aberta.
  }
}

function limparArmazenamento() {
  try {
    window.sessionStorage.removeItem(CHAVE_SESSAO);
  } catch {
    // nada a fazer
  }
}

/**
 * Lê a data de expiração (campo `exp`, em segundos) do payload do JWT.
 * Não valida a assinatura — isso é papel do back-end.
 * @returns {number | null} expiração em milissegundos, ou null se ausente
 */
export function lerExpiracaoDoToken(token) {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const dados = JSON.parse(atob(base64));
    return typeof dados.exp === 'number' ? dados.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Retorna a sessão atual válida ({ token, usuario }) ou null. */
export function obterSessao() {
  const sessao = lerArmazenamento();
  if (!sessao || typeof sessao.token !== 'string' || !sessao.usuario) {
    return null;
  }
  // Token sem `exp` legível também é tratado como sessão inválida.
  const expiraEm = lerExpiracaoDoToken(sessao.token);
  if (expiraEm === null || expiraEm <= Date.now()) {
    limparArmazenamento();
    return null;
  }
  return sessao;
}

export function obterToken() {
  return obterSessao()?.token ?? null;
}

export function obterUsuario() {
  return obterSessao()?.usuario ?? null;
}

export function estaAutenticado() {
  return obterSessao() !== null;
}

/**
 * Autentica na API (POST /auth/login) e guarda a sessão.
 * @returns {Promise<{ id: number, nome: string, perfil: string }>} usuário logado
 * @throws {ErroApi} com mensagem amigável (401 → credenciais inválidas)
 */
export async function login(email, senha) {
  const dados = await api.post('/auth/login', { email, senha });
  if (typeof dados?.token !== 'string' || !dados.token || !dados.usuario) {
    // Resposta fora do contrato: não grava sessão; a tela mostra erro genérico.
    throw new ErroApi('Resposta inesperada do servidor ao entrar.', 502);
  }
  const { id, nome, perfil } = dados?.usuario ?? {};
  const usuario = { id, nome, perfil };
  const sessao = { token: dados?.token, usuario };
  if (dados.trocaSenhaObrigatoria === true) sessao.trocaSenhaObrigatoria = true;
  gravarArmazenamento(sessao);
  return usuario;
}

/** Indica se a sessão atual está com a troca de senha obrigatória pendente (RN10). */
export function trocaSenhaPendente() {
  return obterSessao()?.trocaSenhaObrigatoria === true;
}

/**
 * Marca a sessão atual com a troca de senha obrigatória pendente (ex.: a API
 * respondeu o 403 de troca pendente — RN10). Mantém o mesmo token.
 * @returns {boolean} true se havia sessão para marcar
 */
export function marcarTrocaSenhaPendente() {
  const sessao = obterSessao();
  if (!sessao) return false;
  gravarArmazenamento({ ...sessao, trocaSenhaObrigatoria: true });
  return true;
}

/**
 * Atualiza o nome do usuário logado guardado na sessão (ex.: a Gestão editou
 * o próprio nome — RF04). Mantém o mesmo token; nenhum outro dado é guardado.
 * @param {string} nome
 * @returns {{ id: number, nome: string, perfil: string } | null} usuário atualizado
 */
export function atualizarNomeNaSessao(nome) {
  const sessao = obterSessao();
  if (!sessao || typeof nome !== 'string' || !nome) return null;
  const { id, perfil } = sessao.usuario;
  const usuario = { id, nome, perfil };
  gravarArmazenamento({ ...sessao, usuario });
  return usuario;
}

/** Logout no front-end (não há endpoint de logout — SSD, Seção 12). */
export function logout() {
  limparArmazenamento();
}

/**
 * Chamada à API já com o token da sessão atual. Se não houver sessão válida
 * (ex.: token expirado) ou a API responder 401, o tratamento central do api.js
 * leva o usuário de volta ao login com aviso.
 */
export function requisicaoAutenticada(caminho, opcoes = {}) {
  return requisicao(caminho, {
    ...opcoes,
    token: obterToken() ?? undefined,
    autenticada: true,
  });
}
