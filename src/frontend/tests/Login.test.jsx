// Fluxos da Issue #14 — login, logout e redirecionamentos (API mockada, sem rede).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { requisicaoAutenticada } from '../src/services/auth.js';
import {
  CHAVE_SESSAO,
  USUARIO_FICTICIO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
  tokenFicticio,
} from './utilitarios.jsx';

const EMAIL_FICTICIO = 'maria@exemplo.test';
const SENHA_FICTICIA = 'senha-ficticia-123';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

function campos() {
  return {
    email: screen.getByLabelText('E-mail'),
    senha: screen.getByLabelText('Senha'),
    entrar: screen.getByRole('button', { name: 'Entrar' }),
  };
}

async function preencherEEnviar(usuario) {
  const { email, senha, entrar } = campos();
  await usuario.type(email, EMAIL_FICTICIO);
  await usuario.type(senha, SENHA_FICTICIA);
  await usuario.click(entrar);
}

describe('Tela de login e logout (#14)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', 'http://api.exemplo.test');
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar fetch/env: nenhuma chamada pendente vaza.
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('renderiza e-mail, senha mascarada e botão Entrar, com foco no e-mail', () => {
    renderizarApp('/login');

    const { email, senha, entrar } = campos();
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
    expect(email).toHaveAttribute('type', 'email');
    expect(senha).toHaveAttribute('type', 'password');
    expect(entrar).toBeEnabled();
    expect(email).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('valida campos obrigatórios sem chamar a API', async () => {
    renderizarApp('/login');

    await usuario.click(campos().entrar);

    expect(screen.getByText('Informe o seu e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Informe a sua senha.')).toBeInTheDocument();
    expect(campos().email).toHaveAttribute('aria-invalid', 'true');
    expect(campos().email).toHaveAccessibleDescription('Informe o seu e-mail.');
    expect(campos().email).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('valida a senha quando só o e-mail foi preenchido (e e-mail só com espaços)', async () => {
    renderizarApp('/login');

    await usuario.type(campos().email, '   ');
    await usuario.click(campos().entrar);
    expect(screen.getByText('Informe o seu e-mail.')).toBeInTheDocument();

    await usuario.clear(campos().email);
    await usuario.type(campos().email, EMAIL_FICTICIO);
    await usuario.click(campos().entrar);

    expect(screen.queryByText('Informe o seu e-mail.')).not.toBeInTheDocument();
    expect(screen.getByText('Informe a sua senha.')).toBeInTheDocument();
    expect(campos().senha).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('com sucesso, vai para a área autenticada e mostra nome e perfil', async () => {
    fetch.mockResolvedValue(
      respostaFalsa(200, { token: tokenFicticio(), usuario: USUARIO_FICTICIO }),
    );
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Gestão');
    expect(screen.getByRole('banner')).toHaveTextContent('Maria Fictícia');
    expect(screen.getByRole('banner')).toHaveTextContent('Gestão');
    expect(screen.getByRole('button', { name: 'Sair' })).toBeVisible();

    const [url, opcoes] = fetch.mock.calls[0];
    expect(url).toBe('http://api.exemplo.test/auth/login');
    expect(JSON.parse(opcoes.body)).toEqual({ email: EMAIL_FICTICIO, senha: SENHA_FICTICIA });
  });

  it('desabilita o botão e mostra "Entrando..." durante o envio', async () => {
    let responder;
    fetch.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    const botao = screen.getByRole('button', { name: 'Entrando...' });
    expect(botao).toBeDisabled();
    await usuario.click(botao);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      responder(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));
    });
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('com credenciais inválidas (401), mostra mensagem genérica e continua no login', async () => {
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
    expect(campos().senha).toHaveValue('');
    expect(campos().senha).toHaveFocus();
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    // 401 do login não é tratado como "sessão expirada".
    expect(screen.queryByText(AVISO_SESSAO)).not.toBeInTheDocument();
  });

  it('"Mostrar senha" alterna a senha entre mascarada e visível, sem enviar o formulário', async () => {
    renderizarApp('/login');

    const { senha } = campos();
    expect(senha).toHaveAttribute('autocomplete', 'current-password');
    await usuario.type(senha, SENHA_FICTICIA);

    const mostrar = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(mostrar).toHaveAttribute('type', 'button');
    expect(mostrar).toHaveAttribute('aria-controls', 'login-senha');
    expect(mostrar).not.toHaveAttribute('aria-pressed');
    expect(mostrar).toHaveAttribute('title', 'Mostrar senha');
    // Botão de ícone: sem texto visível, nome acessível pelo aria-label, ícone decorativo.
    expect(mostrar).toHaveAttribute('aria-label', 'Mostrar senha');
    expect(mostrar).toHaveTextContent('');
    expect(mostrar.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(mostrar.querySelector('svg')).toHaveAttribute('data-icone', 'olho');

    await usuario.click(mostrar);
    expect(senha).toHaveAttribute('type', 'text');
    expect(senha).toHaveValue(SENHA_FICTICIA);
    const ocultar = screen.getByRole('button', { name: 'Ocultar senha' });
    expect(ocultar).toHaveAttribute('title', 'Ocultar senha');
    expect(ocultar).not.toHaveAttribute('aria-pressed');
    expect(ocultar.querySelector('svg')).toHaveAttribute('data-icone', 'olho-cortado');

    await usuario.click(ocultar);
    expect(senha).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toHaveAttribute(
      'title',
      'Mostrar senha',
    );
    // Alternar não envia o formulário nem mostra erros de validação.
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Informe o seu e-mail.')).not.toBeInTheDocument();
  });

  it('após erro de login com a senha visível, apaga a senha e volta a mascarar', async () => {
    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'E-mail ou senha inválidos.' }));
    renderizarApp('/login');

    const { email, senha, entrar } = campos();
    await usuario.type(email, EMAIL_FICTICIO);
    await usuario.type(senha, SENHA_FICTICIA);
    await usuario.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(senha).toHaveAttribute('type', 'text');
    await usuario.click(entrar);

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos.');
    expect(senha).toHaveValue('');
    expect(senha).toHaveAttribute('type', 'password');
    // Voltou a mascarar: o botão volta a oferecer "Mostrar senha" (olho aberto).
    const mostrarDeNovo = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(mostrarDeNovo.querySelector('svg')).toHaveAttribute('data-icone', 'olho');
  });

  it('com falha de rede, mostra mensagem amigável', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      'Não foi possível conectar ao servidor. Tente novamente em instantes.',
    );
    expect(alerta).not.toHaveTextContent(/failed to fetch|typeerror/i);
    consoleErro.mockRestore();
  });

  it('sem VITE_API_URL, mostra mensagem amigável e deixa o detalhe só no console', async () => {
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('VITE_API_URL', '');
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      'Não foi possível conectar ao servidor. Tente novamente em instantes.',
    );
    expect(document.body.textContent).not.toMatch(/VITE_API_URL|\.env/);
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleErro).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/VITE_API_URL/),
    );
    consoleErro.mockRestore();
  });

  it('com resposta de login sem token, mostra erro genérico e não grava sessão', async () => {
    fetch.mockResolvedValue(respostaFalsa(200, { usuario: USUARIO_FICTICIO }));
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível entrar agora. Tente novamente em instantes.',
    );
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
  });

  it('com erro inesperado do servidor (500), não mostra detalhes técnicos', async () => {
    fetch.mockResolvedValue(respostaFalsa(500, { erro: 'PrismaClientKnownRequestError: P1001' }));
    renderizarApp('/login');

    await preencherEEnviar(usuario);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível entrar agora. Tente novamente em instantes.');
    expect(alerta).not.toHaveTextContent(/prisma/i);
  });

  it('a senha não aparece em lugar nenhum além do campo de senha', async () => {
    fetch.mockResolvedValue(
      respostaFalsa(200, { token: tokenFicticio(), usuario: USUARIO_FICTICIO }),
    );
    renderizarApp('/login');

    const { senha } = campos();
    await usuario.type(campos().email, EMAIL_FICTICIO);
    await usuario.type(senha, SENHA_FICTICIA);
    expect(document.body.textContent).not.toContain(SENHA_FICTICIA);
    await usuario.click(campos().entrar);

    await screen.findByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' });
    expect(document.body.innerHTML).not.toContain(SENHA_FICTICIA);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SENHA_FICTICIA);
    expect(localStorage.length).toBe(0);
  });

  it('Sair limpa o sessionStorage e volta ao login', async () => {
    gravarSessaoFicticia();
    renderizarApp('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' })).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: 'Sair' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(screen.queryByText('Maria Fictícia')).not.toBeInTheDocument();
  });

  it('sem token, a área autenticada redireciona para o login', () => {
    renderizarApp('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
    expect(screen.queryByText(/olá/i)).not.toBeInTheDocument();
  });

  it('com token expirado (8h), descarta a sessão e mostra o login', () => {
    gravarSessaoFicticia({ expiraEmSegundos: -60 });
    renderizarApp('/');

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
  });

  it('401 em chamada autenticada limpa a sessão e volta ao login com aviso', async () => {
    gravarSessaoFicticia();
    renderizarApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' })).toBeInTheDocument();

    fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }));
    await act(async () => {
      await requisicaoAutenticada('/usuarios').catch(() => {});
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(AVISO_SESSAO);
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('sessão expirada no navegador + chamada autenticada: volta ao login com aviso, sem chamar a API', async () => {
    gravarSessaoFicticia({ expiraEmSegundos: 2 });
    renderizarApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' })).toBeInTheDocument();

    // Simula a passagem do tempo até depois da expiração do token.
    const agora = Date.now();
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora + 60_000);
    await act(async () => {
      await requisicaoAutenticada('/usuarios').catch(() => {});
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(AVISO_SESSAO);
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    relogio.mockRestore();
  });

  it('a região de aviso existe antes do texto (anunciada por leitores de tela)', () => {
    renderizarApp('/login');

    const regiao = screen.getByRole('status');
    expect(regiao).toHaveAttribute('aria-live', 'polite');
    expect(regiao).toBeEmptyDOMElement();
  });

  it('após o aviso de sessão encerrada, consegue entrar de novo', async () => {
    gravarSessaoFicticia();
    renderizarApp('/');
    fetch.mockResolvedValueOnce(respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }));
    await act(async () => {
      await requisicaoAutenticada('/usuarios').catch(() => {});
    });
    await screen.findByText(AVISO_SESSAO);

    fetch.mockResolvedValueOnce(
      respostaFalsa(200, { token: tokenFicticio(), usuario: USUARIO_FICTICIO }),
    );
    await preencherEEnviar(usuario);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
      ).toBeInTheDocument(),
    );
  });
});
