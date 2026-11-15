import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  api,
  requisicao,
  obterUrlBase,
  ErroApi,
  definirAoNaoAutenticado,
} from '../src/services/api.js';

function respostaFalsa(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
  };
}

describe('services/api', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.exemplo.test/');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('lê a URL base da variável de ambiente VITE_API_URL (sem barra final)', () => {
    expect(obterUrlBase()).toBe('http://api.exemplo.test');
  });

  it('lança erro claro quando VITE_API_URL não está definida', () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(() => obterUrlBase()).toThrow(/VITE_API_URL/);
  });

  it('monta a URL a partir da variável de ambiente e devolve o JSON', async () => {
    fetch.mockResolvedValue(respostaFalsa(200, { status: 'ok' }));

    const dados = await api.get('/saude');

    expect(fetch).toHaveBeenCalledWith(
      'http://api.exemplo.test/saude',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(dados).toEqual({ status: 'ok' });
  });

  it('envia corpo em JSON e token no cabeçalho Authorization', async () => {
    fetch.mockResolvedValue(respostaFalsa(201, { id: 1 }));

    await api.post('/exemplo', { nome: 'Teste Fictício' }, { token: 'token-ficticio' });

    const [, opcoes] = fetch.mock.calls[0];
    expect(opcoes.method).toBe('POST');
    expect(opcoes.body).toBe(JSON.stringify({ nome: 'Teste Fictício' }));
    expect(opcoes.headers['Content-Type']).toBe('application/json');
    expect(opcoes.headers.Authorization).toBe('Bearer token-ficticio');
  });

  it('usa a mensagem do campo "erro" devolvida pelo back-end', async () => {
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));

    const promessa = requisicao('/auth/login', { metodo: 'POST', corpo: {} });

    await expect(promessa).rejects.toBeInstanceOf(ErroApi);
    await expect(promessa).rejects.toMatchObject({
      message: 'E-mail ou senha inválidos.',
      status: 401,
      doServidor: true,
    });
  });

  it('usa mensagem padrão quando o erro não vem no formato esperado', async () => {
    fetch.mockResolvedValue(respostaFalsa(500));

    await expect(api.get('/qualquer')).rejects.toMatchObject({
      message: 'Não foi possível concluir a ação. Tente novamente.',
      status: 500,
      doServidor: false,
    });
  });

  it('informa falta de conexão quando o servidor não responde', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.get('/qualquer')).rejects.toMatchObject({
      message: expect.stringMatching(/não foi possível conectar ao servidor/i),
      status: 0,
    });
  });
});

describe('services/api — tratamento central de 401', () => {
  let remover;

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.exemplo.test');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    remover?.();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('avisa o app quando uma chamada com token recebe 401', async () => {
    const aoNaoAutenticado = vi.fn();
    remover = definirAoNaoAutenticado(aoNaoAutenticado);
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }));

    await expect(api.get('/usuarios', { token: 'token-ficticio' })).rejects.toMatchObject({
      status: 401,
    });
    expect(aoNaoAutenticado).toHaveBeenCalledTimes(1);
  });

  it('não avisa em 401 sem token (ex.: credenciais inválidas no login)', async () => {
    const aoNaoAutenticado = vi.fn();
    remover = definirAoNaoAutenticado(aoNaoAutenticado);
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    expect(aoNaoAutenticado).not.toHaveBeenCalled();
  });

  it('não avisa em 403 (perfil sem permissão)', async () => {
    const aoNaoAutenticado = vi.fn();
    remover = definirAoNaoAutenticado(aoNaoAutenticado);
    fetch.mockResolvedValue(respostaFalsa(403, { erro: 'Acesso negado.' }));

    await expect(api.get('/usuarios', { token: 'token-ficticio' })).rejects.toMatchObject({
      status: 403,
    });
    expect(aoNaoAutenticado).not.toHaveBeenCalled();
  });

  it('rota autenticada sem token: aciona o aviso e não chama a API', async () => {
    const aoNaoAutenticado = vi.fn();
    remover = definirAoNaoAutenticado(aoNaoAutenticado);

    await expect(api.get('/usuarios', { autenticada: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(aoNaoAutenticado).toHaveBeenCalledTimes(1);
  });
});
