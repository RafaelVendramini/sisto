// Issue #90 — limite de tentativas com falha (SSD 1.8, Seção 12): as telas de
// login e de troca de senha mostram a mensagem do 429, e o 429 NÃO é tratado
// como sessão expirada. API mockada (sem rede). Somente dados fictícios (RN05).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { definirAoNaoAutenticado, requisicao } from '../src/services/api.js';
import { MENSAGEM_MUITAS_TENTATIVAS } from '../src/services/mensagens.js';
import {
  CHAVE_SESSAO,
  USUARIO_FICTICIO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_API_429 = 'Muitas tentativas. Tente novamente em alguns minutos.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
const EMAIL_FICTICIO = 'joana@exemplo.test';
const SENHA_FICTICIA = 'senha-ficticia-456';
const SENHA_ATUAL = 'senha-atual-ficticia';
const NOVA_SENHA = 'nova-senha-ficticia';

function sessaoGravada() {
  return sessionStorage.getItem(CHAVE_SESSAO);
}

describe('Limite de tentativas com falha — mensagem do 429 (#90)', () => {
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

  describe('tela de login', () => {
    async function entrar() {
      await usuario.type(screen.getByLabelText('E-mail'), EMAIL_FICTICIO);
      await usuario.type(screen.getByLabelText('Senha'), SENHA_FICTICIA);
      await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
    }

    it('mostra a mensagem do 429 vinda da API, sem gravar sessão', async () => {
      fetch.mockResolvedValue(respostaFalsa(429, { erro: MSG_API_429 }));
      renderizarApp('/login');

      await entrar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_API_429);
      expect(screen.queryByText('E-mail ou senha inválidos.')).toBeNull();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(sessaoGravada()).toBeNull();
      // A senha é apagada, como em qualquer falha, e o botão volta a funcionar.
      expect(screen.getByLabelText('Senha')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    });

    it('429 sem corpo usa a mensagem reserva (não a genérica)', async () => {
      fetch.mockResolvedValue(respostaFalsa(429));
      renderizarApp('/login');

      await entrar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MENSAGEM_MUITAS_TENTATIVAS);
    });
  });

  describe('tela de troca da própria senha', () => {
    async function trocar() {
      await usuario.type(screen.getByLabelText('Senha atual'), SENHA_ATUAL);
      await usuario.type(screen.getByLabelText('Nova senha'), NOVA_SENHA);
      await usuario.type(screen.getByLabelText('Confirme a nova senha'), NOVA_SENHA);
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));
    }

    it('mostra a mensagem do 429 e mantém a sessão (não é sessão expirada)', async () => {
      const token = gravarSessaoFicticia();
      fetch.mockResolvedValue(respostaFalsa(429, { erro: MSG_API_429 }));
      renderizarApp('/conta/senha');

      await trocar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_API_429);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(AVISO_SESSAO)).toBeNull();
      expect(JSON.parse(sessaoGravada())).toEqual({ token, usuario: USUARIO_FICTICIO });
      expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
      // Os campos ficam liberados para tentar de novo depois.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Alterar senha' })).toBeEnabled(),
      );
    });

    it('429 sem corpo usa a mensagem reserva', async () => {
      gravarSessaoFicticia();
      fetch.mockResolvedValue(respostaFalsa(429));
      renderizarApp('/conta/senha');

      await trocar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MENSAGEM_MUITAS_TENTATIVAS);
      expect(sessaoGravada()).not.toBeNull();
    });
  });

  describe('cliente da API', () => {
    it('429 em chamada autenticada não aciona o tratamento de sessão inválida', async () => {
      const aoNaoAutenticado = vi.fn();
      const remover = definirAoNaoAutenticado(aoNaoAutenticado);
      fetch.mockResolvedValue(respostaFalsa(429, { erro: MSG_API_429 }));

      await expect(
        requisicao('/conta/senha', { metodo: 'PUT', corpo: {}, token: 'x.y.z', autenticada: true }),
      ).rejects.toMatchObject({ status: 429, message: MSG_API_429, doServidor: true });
      expect(aoNaoAutenticado).not.toHaveBeenCalled();
      remover();
    });
  });
});
