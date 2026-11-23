// Testes complementares da Issue #16 (QA): acesso por perfil (RN01/RF14),
// erros 400/404/409/500 sem mensagem do back-end (RNF02) e 404 na edição.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';
import { mensagemErroAlteracaoUsuario } from '../src/services/mensagensUsuarios.js';

const URL_API = 'http://api.exemplo.test';

const USUARIOS_FICTICIOS = [
  { id: 2, nome: 'Bruno Ficcional', email: 'bruno@sisto.exemplo', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 1, nome: 'Maria Fictícia', email: 'maria@sisto.exemplo', perfil: 'GESTAO', status: 'ATIVO' },
];

function mockarApi(aoAtualizar) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/usuarios` && opcoes.method === 'GET') {
      return respostaFalsa(200, USUARIOS_FICTICIOS);
    }
    if (/\/usuarios\/\d+$/.test(url) && opcoes.method === 'PUT' && aoAtualizar) {
      return aoAtualizar();
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadasPut() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'PUT');
}

describe('Gestão de usuários #16 — testes complementares do QA', () => {
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
  });

  describe('acesso por perfil (RN01/RF14): só a Gestão edita ou muda status', () => {
    it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      'perfil %s não vê a página, nem botões de editar/bloquear/desativar/reativar, e a API não é chamada',
      (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        renderizarApp('/usuarios');

        expect(
          screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /Editar|Bloquear|Desativar|Reativar/ }),
        ).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  });

  describe('mensagens de erro sem texto do back-end (RNF02)', () => {
    it.each([
      [400, 'Não foi possível salvar a alteração agora. Tente novamente em instantes.'],
      [404, 'Usuário não encontrado. Atualize a página e tente novamente.'],
      [409, 'Não foi possível salvar esta alteração agora. Atualize a página e tente novamente.'],
      [500, 'Não foi possível salvar a alteração agora. Tente novamente em instantes.'],
    ])('%i sem corpo mostra mensagem clara, sem nada técnico', async (status, esperado) => {
      gravarSessaoFicticia();
      mockarApi(() => respostaFalsa(status));
      renderizarApp('/usuarios');
      await screen.findByRole('table');

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));

      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(esperado);
      expect(alerta).not.toHaveTextContent(/\b(400|404|409|500)\b|Error|undefined/);
    });

    it('500 com mensagem do servidor não expõe o texto técnico', () => {
      const falha = { status: 500, doServidor: true, message: 'PrismaClientKnownRequestError P2002' };
      expect(mensagemErroAlteracaoUsuario(falha)).toBe(
        'Não foi possível salvar a alteração agora. Tente novamente em instantes.',
      );
    });
  });

  describe('edição', () => {
    it('404 na edição mostra a mensagem do back-end e mantém o diálogo aberto', async () => {
      gravarSessaoFicticia();
      mockarApi(() => respostaFalsa(404, { erro: 'Usuário não encontrado.' }));
      renderizarApp('/usuarios');
      await screen.findByRole('table');

      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      await usuario.type(within(dialogo).getByLabelText('Nome completo'), ' Jr');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Usuário não encontrado.',
      );
      expect(screen.getByRole('dialog', { name: 'Editar usuário' })).toBeInTheDocument();
    });

    it('edição de e-mail e perfil juntos envia os dois campos e atualiza a linha', async () => {
      gravarSessaoFicticia();
      mockarApi(() =>
        respostaFalsa(200, {
          ...USUARIOS_FICTICIOS[0],
          email: 'bruno.novo@sisto.exemplo',
          perfil: 'TUTOR',
        }),
      );
      renderizarApp('/usuarios');
      await screen.findByRole('table');

      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const email = within(dialogo).getByLabelText('E-mail');
      await usuario.clear(email);
      await usuario.type(email, 'bruno.novo@sisto.exemplo');
      await usuario.selectOptions(within(dialogo).getByLabelText('Perfil'), 'TUTOR');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await screen.findByText('Dados de Bruno Ficcional atualizados.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({
        email: 'bruno.novo@sisto.exemplo',
        perfil: 'TUTOR',
      });
      const tabela = screen.getByRole('table');
      expect(within(tabela).getByText('bruno.novo@sisto.exemplo')).toBeInTheDocument();
      expect(within(tabela).getByText('Tutor')).toBeInTheDocument();
    });
  });
});
