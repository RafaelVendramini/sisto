// Módulo base para chamadas à API do Sisto.
// A URL vem da variável de ambiente VITE_API_URL (ver .env.example); nunca fica fixa no código.

import { CODIGOS_ERRO, falhaTemCodigo } from './codigosErro.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_TROCA_SENHA_PENDENTE } from './mensagens.js';

const MENSAGEM_PADRAO = 'Não foi possível concluir a ação. Tente novamente.';
const MENSAGEM_SESSAO_INVALIDA = 'Não autenticado. Faça login novamente.';

export class ErroApi extends Error {
  /**
   * @param {string} mensagem
   * @param {number} status - 0 quando não houve resposta (sem conexão)
   * @param {boolean} [doServidor=false] - true se a mensagem veio do campo `erro` da API
   * @param {string | null} [codigo=null] - código estável do campo `codigo` da API
   *   (ver codigosErro.js — Issue #72), ou null quando a resposta não trouxe
   */
  constructor(mensagem, status, doServidor = false, codigo = null) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.doServidor = doServidor;
    this.codigo = codigo;
  }
}

// Tratamento central de sessão inválida (RNF03, RN09): quando uma chamada
// autenticada (com token) recebe 401, o app é avisado por este callback para
// descartar a sessão e voltar ao login. Chamadas sem token (ex.: /auth/login)
// não disparam o aviso: ali o 401 significa apenas credenciais inválidas.
// Só o 401 encerra a sessão: o 429 do limite de tentativas (Issue #90) chega
// à tela como ErroApi comum, com a mensagem da API.
let aoNaoAutenticado = null;

/**
 * Registra a função chamada quando uma requisição autenticada recebe 401.
 * @param {(() => void) | null} callback
 * @returns {() => void} função que remove o registro
 */
export function definirAoNaoAutenticado(callback) {
  aoNaoAutenticado = callback;
  return () => {
    if (aoNaoAutenticado === callback) aoNaoAutenticado = null;
  };
}

// Troca de senha obrigatória pendente (RN10): quando uma chamada autenticada
// recebe o 403 específico desse caso (codigo TROCA_SENHA_OBRIGATORIA; sem
// código, pela mensagem), o app é avisado para levar o usuário à tela de
// troca. Os demais 403 (perfil sem permissão) seguem para a tela.
let aoTrocaSenhaPendente = null;

/**
 * Registra a função chamada quando uma requisição autenticada recebe o 403
 * de troca de senha pendente.
 * @param {(() => void) | null} callback
 * @returns {() => void} função que remove o registro
 */
export function definirAoTrocaSenhaPendente(callback) {
  aoTrocaSenhaPendente = callback;
  return () => {
    if (aoTrocaSenhaPendente === callback) aoTrocaSenhaPendente = null;
  };
}

export function obterUrlBase() {
  const url = import.meta.env.VITE_API_URL;
  if (!url) {
    throw new ErroApi(
      'Endereço da API não configurado. Defina VITE_API_URL no arquivo .env.',
      0,
    );
  }
  return url.replace(/\/+$/, '');
}

/**
 * Faz uma requisição JSON à API.
 * @param {string} caminho - ex.: '/auth/login'
 * @param {object} [opcoes]
 * @param {string} [opcoes.metodo='GET']
 * @param {object} [opcoes.corpo] - enviado como JSON
 * @param {string} [opcoes.token] - token JWT, enviado no cabeçalho Authorization
 * @param {boolean} [opcoes.autenticada=false] - rota protegida: sem token válido,
 *   aciona o tratamento de sessão inválida sem fazer a requisição; e 401 sempre o aciona
 * @returns {Promise<any>} corpo da resposta já convertido de JSON (ou null se vazio)
 * @throws {ErroApi} com a mensagem do campo `erro` devolvido pelo back-end
 */
export async function requisicao(
  caminho,
  { metodo = 'GET', corpo, token, autenticada = false } = {},
) {
  const exigeSessao = autenticada || Boolean(token);

  // Rota protegida sem token válido (ex.: expirou após 8h): nem chega a chamar a API.
  if (autenticada && !token) {
    if (aoNaoAutenticado) aoNaoAutenticado();
    throw new ErroApi(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  const cabecalhos = { Accept: 'application/json' };
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (token) cabecalhos.Authorization = `Bearer ${token}`;

  const caminhoNormalizado = caminho.startsWith('/') ? caminho : `/${caminho}`;

  let resposta;
  try {
    resposta = await fetch(`${obterUrlBase()}${caminhoNormalizado}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;
    throw new ErroApi(MENSAGEM_SEM_CONEXAO, 0);
  }

  const texto = await resposta.text();
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = null;
    }
  }

  if (!resposta.ok) {
    if (resposta.status === 401 && exigeSessao && aoNaoAutenticado) {
      aoNaoAutenticado();
    }
    const doServidor = Boolean(dados && typeof dados.erro === 'string' && dados.erro);
    const codigo = dados && typeof dados.codigo === 'string' && dados.codigo ? dados.codigo : null;
    const mensagem = doServidor ? dados.erro : MENSAGEM_PADRAO;
    const falha = new ErroApi(mensagem, resposta.status, doServidor, codigo);
    if (
      resposta.status === 403 &&
      exigeSessao &&
      aoTrocaSenhaPendente &&
      falhaTemCodigo(
        falha,
        CODIGOS_ERRO.TROCA_SENHA_OBRIGATORIA,
        (f) => f.doServidor && f.message === MENSAGEM_TROCA_SENHA_PENDENTE,
      )
    ) {
      aoTrocaSenhaPendente();
    }
    throw falha;
  }

  return dados;
}

export const api = {
  get: (caminho, opcoes) => requisicao(caminho, { ...opcoes, metodo: 'GET' }),
  post: (caminho, corpo, opcoes) => requisicao(caminho, { ...opcoes, metodo: 'POST', corpo }),
  put: (caminho, corpo, opcoes) => requisicao(caminho, { ...opcoes, metodo: 'PUT', corpo }),
  patch: (caminho, corpo, opcoes) => requisicao(caminho, { ...opcoes, metodo: 'PATCH', corpo }),
  delete: (caminho, opcoes) => requisicao(caminho, { ...opcoes, metodo: 'DELETE' }),
};
