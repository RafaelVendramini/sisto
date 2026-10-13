import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { definirAoNaoAutenticado } from '../src/services/api.js';
import {
  login,
  logout,
  obterSessao,
  obterToken,
  obterUsuario,
  estaAutenticado,
  lerExpiracaoDoToken,
  requisicaoAutenticada,
} from '../src/services/auth.js';
import {
  CHAVE_SESSAO,
  USUARIO_FICTICIO,
  gravarSessaoFicticia,
  respostaFalsa,
  tokenFicticio,
} from './utilitarios.jsx';

const SENHA_FICTICIA = 'senha-ficticia-123';

describe('services/auth', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', 'http://api.exemplo.test');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('faz login em POST /auth/login e guarda só token e { id, nome, perfil } no sessionStorage', async () => {
    const token = tokenFicticio();
    fetch.mockResolvedValue(
      respostaFalsa(200, { token, usuario: { ...USUARIO_FICTICIO, email: 'maria@exemplo.test' } }),
    );

    const usuario = await login('maria@exemplo.test', SENHA_FICTICIA);

    const [url, opcoes] = fetch.mock.calls[0];
    expect(url).toBe('http://api.exemplo.test/auth/login');
    expect(opcoes.method).toBe('POST');
    expect(usuario).toEqual(USUARIO_FICTICIO);

    const salvo = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO));
    expect(salvo).toEqual({ token, usuario: USUARIO_FICTICIO });
    expect(sessionStorage.getItem(CHAVE_SESSAO)).not.toContain(SENHA_FICTICIA);
    expect(localStorage.length).toBe(0);
    expect(obterToken()).toBe(token);
    expect(obterUsuario()).toEqual(USUARIO_FICTICIO);
    expect(estaAutenticado()).toBe(true);
  });

  it('não guarda nada quando o login falha', async () => {
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));

    await expect(login('maria@exemplo.test', SENHA_FICTICIA)).rejects.toMatchObject({ status: 401 });
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(estaAutenticado()).toBe(false);
  });

  it('logout descarta a sessão', () => {
    gravarSessaoFicticia();
    expect(estaAutenticado()).toBe(true);

    logout();

    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(obterSessao()).toBeNull();
  });

  it('considera expirado o token com "exp" no passado e limpa a sessão', () => {
    gravarSessaoFicticia({ expiraEmSegundos: -10 });

    expect(estaAutenticado()).toBe(false);
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
  });

  it('lê a expiração do token e tolera token malformado', () => {
    const token = tokenFicticio({ expiraEmSegundos: 60 });
    expect(lerExpiracaoDoToken(token)).toBeGreaterThan(Date.now());
    expect(lerExpiracaoDoToken('nao-e-um-jwt')).toBeNull();
  });

  it('ignora conteúdo corrompido no armazenamento', () => {
    sessionStorage.setItem(CHAVE_SESSAO, '{ isso não é json');
    expect(obterSessao()).toBeNull();
  });

  it('não quebra quando o sessionStorage está indisponível', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });

    expect(obterSessao()).toBeNull();
    expect(() => logout()).not.toThrow();
  });

  it('requisicaoAutenticada envia o token da sessão no cabeçalho Authorization', async () => {
    const token = gravarSessaoFicticia();
    fetch.mockResolvedValue(respostaFalsa(200, []));

    await requisicaoAutenticada('/usuarios');

    const [url, opcoes] = fetch.mock.calls[0];
    expect(url).toBe('http://api.exemplo.test/usuarios');
    expect(opcoes.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('trata token sem "exp" como sessão inválida', () => {
    const semExp = `${btoa(JSON.stringify({ alg: 'HS256' }))}.${btoa(JSON.stringify({ sub: 1 }))}.x`;
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token: semExp, usuario: USUARIO_FICTICIO }));

    expect(estaAutenticado()).toBe(false);
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
  });

  it('login com resposta sem token falha e não grava sessão', async () => {
    fetch.mockResolvedValue(respostaFalsa(200, { usuario: USUARIO_FICTICIO }));

    await expect(login('maria@exemplo.test', SENHA_FICTICIA)).rejects.toMatchObject({
      status: 502,
    });
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
  });

  it('requisicaoAutenticada com sessão expirada aciona o aviso sem chamar a API', async () => {
    gravarSessaoFicticia({ expiraEmSegundos: -60 });
    const aoNaoAutenticado = vi.fn();
    const remover = definirAoNaoAutenticado(aoNaoAutenticado);

    await expect(requisicaoAutenticada('/usuarios')).rejects.toMatchObject({ status: 401 });

    remover();
    expect(fetch).not.toHaveBeenCalled();
    expect(aoNaoAutenticado).toHaveBeenCalledTimes(1);
  });
});
