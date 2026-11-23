// Issue #56 — o navegador não deve preencher o cadastro de usuário nem a
// redefinição de senha com as credenciais de quem está logado (RNF02/RNF03).
// Verifica o atributo autocomplete de cada campo (o comportamento real do
// navegador é conferido manualmente). API mockada, somente dados fictícios (RN05).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';

// A sessão fictícia (utilitarios.jsx) é a de Maria Fictícia, id 1, Gestão.
const USUARIOS_FICTICIOS = [
  { id: 2, nome: 'Bruno Ficcional', email: 'bruno@sisto.exemplo', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 1, nome: 'Maria Fictícia', email: 'maria@sisto.exemplo', perfil: 'GESTAO', status: 'ATIVO' },
];

function mockarListaUsuarios() {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/usuarios` && opcoes.method === 'GET') {
      return respostaFalsa(200, USUARIOS_FICTICIOS);
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

async function abrirUsuarios() {
  gravarSessaoFicticia();
  mockarListaUsuarios();
  renderizarApp('/usuarios');
  await screen.findByRole('table');
}

describe('Preenchimento automático de credenciais (#56)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar fetch/env: nenhuma chamada pendente vaza.
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('cadastro de usuário (/usuarios)', () => {
    it('"Senha temporária" usa new-password e começa vazia', async () => {
      await abrirUsuarios();

      const senha = screen.getByLabelText('Senha temporária');
      expect(senha).toHaveAttribute('autocomplete', 'new-password');
      expect(senha).toHaveAttribute('type', 'password');
      expect(senha).toHaveValue('');
    });

    it('"E-mail" continua com autocomplete off e começa vazio', async () => {
      await abrirUsuarios();

      const formulario = screen.getByRole('form', { name: 'Cadastrar usuário' });
      const email = within(formulario).getByLabelText('E-mail');
      expect(email).toHaveAttribute('autocomplete', 'off');
      expect(email).toHaveAttribute('type', 'email');
      expect(email).toHaveValue('');
    });

    it('nenhum campo de senha do cadastro usa current-password', async () => {
      await abrirUsuarios();

      const formulario = screen.getByRole('form', { name: 'Cadastrar usuário' });
      const senhas = formulario.querySelectorAll('input[type="password"]');
      expect(senhas.length).toBeGreaterThan(0);
      senhas.forEach((campo) => {
        expect(campo).toHaveAttribute('autocomplete', 'new-password');
      });
    });
  });

  it('diálogo "Redefinir senha": "Nova senha temporária" usa new-password e começa vazio', async () => {
    await abrirUsuarios();

    await usuario.click(screen.getByRole('button', { name: 'Redefinir senha de Bruno Ficcional' }));
    const dialogo = screen.getByRole('dialog', { name: 'Redefinir senha' });
    const campo = within(dialogo).getByLabelText('Nova senha temporária');
    expect(campo).toHaveAttribute('autocomplete', 'new-password');
    expect(campo).toHaveValue('');
  });

  it('diálogo "Editar usuário": "E-mail" continua com autocomplete off', async () => {
    await abrirUsuarios();

    await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
    expect(within(dialogo).getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'off');
    // A edição não tem campo de senha.
    expect(dialogo.querySelector('input[type="password"]')).toBeNull();
  });

  it('login não muda: e-mail com username e senha com current-password', () => {
    renderizarApp('/login');

    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Senha')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('"Alterar minha senha" não muda: atual com current-password, nova e confirmação com new-password', async () => {
    gravarSessaoFicticia();
    renderizarApp('/conta/senha');

    expect(await screen.findByLabelText('Senha atual')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('Nova senha')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirme a nova senha')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });
});
