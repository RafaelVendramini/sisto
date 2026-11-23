// Fluxos da Issue #18 — recuperação de acesso (RF03, RN10, RN12): troca da
// própria senha, troca obrigatória após redefinição pela Gestão e redefinição
// pela Gestão na tela de Usuários. API mockada (sem rede).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHAVE_SESSAO,
  USUARIO_FICTICIO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
  tokenFicticio,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_TROCA_PENDENTE =
  'Você precisa trocar a sua senha temporária para continuar usando o sistema.';
const MSG_SENHA_ALTERADA = 'Senha alterada. Entre com a nova senha.';
const MSG_SENHA_ATUAL_INCORRETA = 'A senha atual está incorreta.';
const MSG_NOVA_IGUAL_ATUAL = 'A nova senha deve ser diferente da senha atual.';
const MSG_PROPRIA_SENHA =
  'Você não pode redefinir a sua própria senha por aqui. Use a opção "Alterar minha senha".';
const MSG_NAO_ENCONTRADO = 'Usuário não encontrado.';
const ORIENTACAO_LOGIN = 'Esqueceu a senha? Procure a Gestão da escola.';

const SENHA_ATUAL = 'senha-atual-ficticia';
const NOVA_SENHA = 'nova-senha-ficticia';
const SENHA_TEMPORARIA = 'temporaria-ficticia-123';

const PROFESSOR_FICTICIO = Object.freeze({ id: 7, nome: 'Ana Professora Fictícia', perfil: 'PROFESSOR' });

// A sessão fictícia padrão é a de Maria Fictícia, id 1, Gestão.
const USUARIOS_FICTICIOS = [
  { id: 2, nome: 'Bruno Ficcional', email: 'bruno@sisto.exemplo', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 1, nome: 'Maria Fictícia', email: 'maria@sisto.exemplo', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 3, nome: 'Paulo Exemplo', email: 'paulo@sisto.exemplo', perfil: 'TUTOR', status: 'BLOQUEADO' },
  {
    id: 4,
    nome: 'Rita Teste',
    email: 'rita@sisto.exemplo',
    perfil: 'TECNICO_ADMINISTRATIVO',
    status: 'DESATIVADO',
  },
];

/** Grava uma sessão fictícia com a troca de senha obrigatória pendente (RN10). */
function gravarSessaoComTrocaPendente(usuario = PROFESSOR_FICTICIO) {
  const token = tokenFicticio();
  sessionStorage.setItem(
    CHAVE_SESSAO,
    JSON.stringify({ token, usuario, trocaSenhaObrigatoria: true }),
  );
  return token;
}

/**
 * Mock da API por rota. Cada manipulador recebe o corpo (JSON já lido) e
 * devolve uma respostaFalsa. Rota não prevista quebra o teste.
 */
function mockarApi(rotas) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const caminho = url.replace(URL_API, '');
    const chave = `${opcoes.method} ${caminho}`;
    const manipulador = rotas[chave];
    if (!manipulador) throw new Error(`Chamada inesperada: ${chave}`);
    return manipulador(opcoes.body ? JSON.parse(opcoes.body) : undefined, opcoes);
  });
}

function chamadas(metodo, caminho) {
  return fetch.mock.calls.filter(
    ([url, opcoes]) => opcoes?.method === metodo && url === `${URL_API}${caminho}`,
  );
}

function sessaoGravada() {
  return sessionStorage.getItem(CHAVE_SESSAO);
}

describe('Recuperação de acesso (#18)', () => {
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

  async function preencherTroca({ atual = SENHA_ATUAL, nova = NOVA_SENHA, confirmacao = nova } = {}) {
    if (atual) await usuario.type(screen.getByLabelText('Senha atual'), atual);
    if (nova) await usuario.type(screen.getByLabelText('Nova senha'), nova);
    if (confirmacao) await usuario.type(screen.getByLabelText('Confirme a nova senha'), confirmacao);
  }

  describe('tela de login', () => {
    it('mostra a orientação "Procure a Gestão" e não oferece recuperação por e-mail', () => {
      renderizarApp('/login');

      expect(screen.getByText(ORIENTACAO_LOGIN)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /esqueci|recuperar|redefinir/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /esqueci|recuperar|redefinir/i })).toBeNull();
    });
  });

  describe('trocar a própria senha (todos os perfis)', () => {
    it('o cabeçalho leva à tela; no 204 a sessão é descartada e o login mostra a confirmação', async () => {
      const token = gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({ 'PUT /conta/senha': () => respostaFalsa(204) });
      renderizarApp('/');

      await usuario.click(screen.getByRole('link', { name: 'Alterar minha senha' }));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      // Fora da troca obrigatória o menu continua disponível.
      expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeInTheDocument();

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(MSG_SENHA_ALTERADA)).toHaveClass('mensagem--sucesso');
      expect(sessaoGravada()).toBeNull();
      expect(localStorage.length).toBe(0);
      expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();

      const [[, opcoes]] = chamadas('PUT', '/conta/senha');
      // A confirmação é só validação do front-end: não vai para a API.
      expect(JSON.parse(opcoes.body)).toEqual({ senhaAtual: SENHA_ATUAL, novaSenha: NOVA_SENHA });
      expect(opcoes.headers.Authorization).toBe(`Bearer ${token}`);
    });

    it('400 de senha atual incorreta: mensagem junto ao campo "Senha atual", sessão mantida', async () => {
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({
        'PUT /conta/senha': () => respostaFalsa(400, { erro: MSG_SENHA_ATUAL_INCORRETA }),
      });
      renderizarApp('/conta/senha');

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      const campo = screen.getByLabelText('Senha atual');
      await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
      expect(campo).toHaveAccessibleDescription(MSG_SENHA_ATUAL_INCORRETA);
      expect(campo).toHaveValue('');
      expect(campo).toHaveFocus();
      expect(screen.getByLabelText('Nova senha')).toHaveAttribute('aria-invalid', 'false');
      expect(sessaoGravada()).not.toBeNull();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
    });

    it('400 de nova senha igual à atual: mensagem junto ao campo "Nova senha"', async () => {
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({ 'PUT /conta/senha': () => respostaFalsa(400, { erro: MSG_NOVA_IGUAL_ATUAL }) });
      renderizarApp('/conta/senha');

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      const campo = screen.getByLabelText('Nova senha');
      await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
      expect(campo).toHaveAccessibleDescription(expect.stringContaining(MSG_NOVA_IGUAL_ATUAL));
      expect(sessaoGravada()).not.toBeNull();
    });

    it('400 de política de senha vindo da API aparece como mensagem clara', async () => {
      const msgPolitica = 'A senha deve ter no máximo 72 bytes (letras acentuadas contam 2 bytes).';
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({ 'PUT /conta/senha': () => respostaFalsa(400, { erro: msgPolitica }) });
      renderizarApp('/conta/senha');

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(msgPolitica);
    });

    it('409 de alteração simultânea vindo da API aparece como mensagem clara', async () => {
      const msgConflito =
        'A senha deste usuário foi alterada por outra operação ao mesmo tempo. Tente novamente.';
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({ 'PUT /conta/senha': () => respostaFalsa(409, { erro: msgConflito, codigo: 'CONFLITO_CONCORRENTE' }) });
      renderizarApp('/conta/senha');

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(msgConflito);
    });

    it('valida antes do envio: obrigatórios, mínimo de 8, confirmação igual e nova diferente da atual', async () => {
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      renderizarApp('/conta/senha');
      const botao = screen.getByRole('button', { name: 'Alterar senha' });
      const atual = screen.getByLabelText('Senha atual');
      const nova = screen.getByLabelText('Nova senha');
      const confirmacao = screen.getByLabelText('Confirme a nova senha');

      // Tudo vazio.
      await usuario.click(botao);
      expect(atual).toHaveAccessibleDescription('Informe a sua senha atual.');
      expect(nova).toHaveAccessibleDescription(expect.stringContaining('Informe a nova senha.'));
      expect(confirmacao).toHaveAccessibleDescription('Repita a nova senha para confirmar.');
      expect(atual).toHaveFocus();

      // Nova senha curta.
      await usuario.type(atual, SENHA_ATUAL);
      await usuario.type(nova, 'curta');
      await usuario.type(confirmacao, 'curta');
      await usuario.click(botao);
      expect(nova).toHaveAccessibleDescription(
        expect.stringContaining('A senha deve ter no mínimo 8 caracteres.'),
      );
      expect(nova).toHaveFocus();

      // Confirmação diferente.
      await usuario.clear(nova);
      await usuario.type(nova, NOVA_SENHA);
      await usuario.clear(confirmacao);
      await usuario.type(confirmacao, 'outra-senha-ficticia');
      await usuario.click(botao);
      expect(nova).toHaveAttribute('aria-invalid', 'false');
      expect(confirmacao).toHaveAccessibleDescription(
        expect.stringContaining('A confirmação não é igual à nova senha.'),
      );

      // Nova senha igual à atual.
      await usuario.clear(nova);
      await usuario.type(nova, SENHA_ATUAL);
      await usuario.clear(confirmacao);
      await usuario.type(confirmacao, SENHA_ATUAL);
      await usuario.click(botao);
      expect(nova).toHaveAccessibleDescription(expect.stringContaining(MSG_NOVA_IGUAL_ATUAL));

      expect(fetch).not.toHaveBeenCalled();
    });

    it('as senhas nunca vão para o armazenamento do navegador', async () => {
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      mockarApi({
        'PUT /conta/senha': () => respostaFalsa(400, { erro: MSG_SENHA_ATUAL_INCORRETA }),
      });
      renderizarApp('/conta/senha');

      await preencherTroca();
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));
      await screen.findByText(MSG_SENHA_ATUAL_INCORRETA);

      expect(sessaoGravada()).not.toContain(SENHA_ATUAL);
      expect(sessaoGravada()).not.toContain(NOVA_SENHA);
      expect(localStorage.length).toBe(0);
    });
  });

  describe('troca obrigatória (RN10)', () => {
    it('login com trocaSenhaObrigatoria leva direto à troca, com aviso e sem menu', async () => {
      mockarApi({
        'POST /auth/login': () =>
          respostaFalsa(200, {
            token: tokenFicticio(),
            usuario: PROFESSOR_FICTICIO,
            trocaSenhaObrigatoria: true,
          }),
      });
      renderizarApp('/login');

      await usuario.type(screen.getByLabelText('E-mail'), 'ana@sisto.exemplo');
      await usuario.type(screen.getByLabelText('Senha'), SENHA_TEMPORARIA);
      await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent(MSG_TROCA_PENDENTE);
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Alterar minha senha' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();

      const salvo = JSON.parse(sessaoGravada());
      expect(salvo.trocaSenhaObrigatoria).toBe(true);
      expect(sessaoGravada()).not.toContain(SENHA_TEMPORARIA);
    });

    it('login sem troca pendente segue para o início, com menu', async () => {
      mockarApi({
        'POST /auth/login': () =>
          respostaFalsa(200, {
            token: tokenFicticio(),
            usuario: PROFESSOR_FICTICIO,
            trocaSenhaObrigatoria: false,
          }),
      });
      renderizarApp('/login');

      await usuario.type(screen.getByLabelText('E-mail'), 'ana@sisto.exemplo');
      await usuario.type(screen.getByLabelText('Senha'), NOVA_SENHA);
      await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Olá, Ana Professora Fictícia' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeInTheDocument();
      expect(JSON.parse(sessaoGravada())).not.toHaveProperty('trocaSenhaObrigatoria');
    });

    it.each(['/', '/usuarios', '/uma-rota-qualquer'])(
      'com a troca pendente, abrir %s leva à tela de troca',
      (rota) => {
        gravarSessaoComTrocaPendente({ ...USUARIO_FICTICIO });
        renderizarApp(rota);

        expect(
          screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('com a troca pendente, continua podendo sair', async () => {
      gravarSessaoComTrocaPendente();
      renderizarApp('/conta/senha');

      await usuario.click(screen.getByRole('button', { name: 'Sair' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(sessaoGravada()).toBeNull();
    });

    it('trocar a senha pendente volta ao login; o novo login libera o sistema', async () => {
      gravarSessaoComTrocaPendente();
      mockarApi({
        'PUT /conta/senha': () => respostaFalsa(204),
        'POST /auth/login': () =>
          respostaFalsa(200, {
            token: tokenFicticio(),
            usuario: PROFESSOR_FICTICIO,
            trocaSenhaObrigatoria: false,
          }),
      });
      renderizarApp('/conta/senha');

      await preencherTroca({ atual: SENHA_TEMPORARIA });
      await usuario.click(screen.getByRole('button', { name: 'Alterar senha' }));

      expect(await screen.findByText(MSG_SENHA_ALTERADA)).toBeInTheDocument();
      expect(sessaoGravada()).toBeNull();

      await usuario.type(screen.getByLabelText('E-mail'), 'ana@sisto.exemplo');
      await usuario.type(screen.getByLabelText('Senha'), NOVA_SENHA);
      await usuario.click(screen.getByRole('button', { name: 'Entrar' }));

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Olá, Ana Professora Fictícia' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(MSG_SENHA_ALTERADA)).not.toBeInTheDocument();
    });

    it('o 403 de troca pendente em qualquer chamada leva à tela de troca', async () => {
      gravarSessaoFicticia();
      mockarApi({ 'GET /usuarios': () => respostaFalsa(403, { erro: MSG_TROCA_PENDENTE, codigo: 'TROCA_SENHA_OBRIGATORIA' }) });
      renderizarApp('/usuarios');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('note')).toHaveTextContent(MSG_TROCA_PENDENTE);
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(JSON.parse(sessaoGravada()).trocaSenhaObrigatoria).toBe(true);
    });

    it('o 403 com código TROCA_SENHA_OBRIGATORIA leva à troca mesmo com outro texto (#72)', async () => {
      gravarSessaoFicticia();
      mockarApi({
        'GET /usuarios': () =>
          respostaFalsa(403, { erro: 'Texto fictício diferente.', codigo: 'TROCA_SENHA_OBRIGATORIA' }),
      });
      renderizarApp('/usuarios');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(JSON.parse(sessaoGravada()).trocaSenhaObrigatoria).toBe(true);
    });

    it('o 403 sem código cai na reserva pelo texto e leva à tela de troca (#72)', async () => {
      gravarSessaoFicticia();
      mockarApi({ 'GET /usuarios': () => respostaFalsa(403, { erro: MSG_TROCA_PENDENTE }) });
      renderizarApp('/usuarios');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(JSON.parse(sessaoGravada()).trocaSenhaObrigatoria).toBe(true);
    });

    it('o 403 com o texto da troca mas outro código não leva à tela de troca (#72)', async () => {
      gravarSessaoFicticia();
      mockarApi({
        'GET /usuarios': () =>
          respostaFalsa(403, { erro: MSG_TROCA_PENDENTE, codigo: 'OUTRO_CODIGO_FICTICIO' }),
      });
      renderizarApp('/usuarios');

      expect(await screen.findByText('Acesso não permitido para o seu perfil.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Usuários' })).toBeInTheDocument();
      expect(JSON.parse(sessaoGravada())).not.toHaveProperty('trocaSenhaObrigatoria');
    });

    it('outro 403 (perfil sem permissão) não leva à tela de troca', async () => {
      gravarSessaoFicticia();
      mockarApi({
        'GET /usuarios': () =>
          respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
      });
      renderizarApp('/usuarios');

      expect(
        await screen.findByText('Acesso não permitido para o seu perfil.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Usuários' })).toBeInTheDocument();
      expect(JSON.parse(sessaoGravada())).not.toHaveProperty('trocaSenhaObrigatoria');
    });
  });

  describe('redefinição pela Gestão (tela de Usuários)', () => {
    function mockarUsuarios(aoRedefinir) {
      mockarApi({
        'GET /usuarios': () => respostaFalsa(200, USUARIOS_FICTICIOS),
        'PUT /usuarios/2/senha': (corpo) => aoRedefinir(2, corpo),
        'PUT /usuarios/3/senha': (corpo) => aoRedefinir(3, corpo),
        'PUT /usuarios/1/senha': (corpo) => aoRedefinir(1, corpo),
      });
    }

    async function abrirDialogo(nome) {
      renderizarApp('/usuarios');
      await screen.findByRole('table');
      await usuario.click(screen.getByRole('button', { name: `Redefinir senha de ${nome}` }));
      return screen.getByRole('dialog', { name: 'Redefinir senha' });
    }

    it('redefine com sucesso: explica a entrega pessoal e confirma sem mostrar a senha', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      const dialogo = await abrirDialogo('Bruno Ficcional');

      expect(dialogo).toHaveTextContent('Entregue a nova senha pessoalmente a Bruno Ficcional');
      expect(dialogo).toHaveTextContent('será obrigatório trocá-la');
      expect(dialogo).not.toHaveTextContent('continuará sem acesso');
      const campo = within(dialogo).getByLabelText('Nova senha temporária');
      expect(campo).toHaveAttribute('autocomplete', 'new-password');
      expect(campo).toHaveAttribute('type', 'password');
      expect(campo).toHaveFocus();

      await usuario.type(campo, SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Redefinir senha' }));

      expect(
        await screen.findByText(/Senha de Bruno Ficcional redefinida\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(SENHA_TEMPORARIA);
      expect(screen.queryByDisplayValue(SENHA_TEMPORARIA)).not.toBeInTheDocument();

      const [[, opcoes]] = chamadas('PUT', '/usuarios/2/senha');
      expect(JSON.parse(opcoes.body)).toEqual({ novaSenha: SENHA_TEMPORARIA });
      expect(sessaoGravada()).not.toContain(SENHA_TEMPORARIA);
      expect(localStorage.length).toBe(0);
      // O foco volta ao botão que abriu o diálogo.
      expect(
        screen.getByRole('button', { name: 'Redefinir senha de Bruno Ficcional' }),
      ).toHaveFocus();
    });

    it('usuário bloqueado: avisa que continua sem acesso até ser reativado', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      const dialogo = await abrirDialogo('Paulo Exemplo');

      expect(dialogo).toHaveTextContent(
        'Paulo Exemplo está bloqueado: mesmo com a nova senha, continuará sem acesso ao Sisto até ser reativado.',
      );
    });

    it('usuário desativado: avisa que continua sem acesso até ser reativado', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      const dialogo = await abrirDialogo('Rita Teste');

      expect(dialogo).toHaveTextContent('Rita Teste está desativado');
      expect(dialogo).toHaveTextContent('continuará sem acesso ao Sisto até ser reativado');
    });

    it('valida a senha temporária antes do envio (obrigatória e mínimo de 8)', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      const dialogo = await abrirDialogo('Bruno Ficcional');
      const campo = within(dialogo).getByLabelText('Nova senha temporária');
      const botao = within(dialogo).getByRole('button', { name: 'Redefinir senha' });

      await usuario.click(botao);
      expect(campo).toHaveAccessibleDescription(
        expect.stringContaining('Informe a nova senha temporária.'),
      );

      await usuario.type(campo, 'curta');
      await usuario.click(botao);
      expect(campo).toHaveAccessibleDescription(
        expect.stringContaining('A senha deve ter no mínimo 8 caracteres.'),
      );
      expect(chamadas('PUT', '/usuarios/2/senha')).toHaveLength(0);
    });

    it('400 da API aparece junto ao campo de senha', async () => {
      const msg = 'A senha deve ter no mínimo 8 caracteres.';
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(400, { erro: msg }));
      const dialogo = await abrirDialogo('Bruno Ficcional');
      const campo = within(dialogo).getByLabelText('Nova senha temporária');

      await usuario.type(campo, SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Redefinir senha' }));

      await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
      expect(campo).toHaveAccessibleDescription(expect.stringContaining(msg));
    });

    it('409 (própria senha) mostra a mensagem clara no diálogo', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(409, { erro: MSG_PROPRIA_SENHA, codigo: 'REDEFINIR_PROPRIA_SENHA' }));
      const dialogo = await abrirDialogo('Bruno Ficcional');

      await usuario.type(within(dialogo).getByLabelText('Nova senha temporária'), SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Redefinir senha' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_PROPRIA_SENHA);
      expect(screen.getByRole('dialog', { name: 'Redefinir senha' })).toBeInTheDocument();
    });

    it('404 mostra a mensagem e recarrega a lista em segundo plano', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(404, { erro: MSG_NAO_ENCONTRADO }));
      const dialogo = await abrirDialogo('Bruno Ficcional');

      await usuario.type(within(dialogo).getByLabelText('Nova senha temporária'), SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Redefinir senha' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADO);
      await waitFor(() => expect(chamadas('GET', '/usuarios')).toHaveLength(2));
    });

    it('403 mostra que o perfil não tem permissão', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() =>
        respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
      );
      const dialogo = await abrirDialogo('Bruno Ficcional');

      await usuario.type(within(dialogo).getByLabelText('Nova senha temporária'), SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Redefinir senha' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Acesso não permitido para o seu perfil.',
      );
    });

    it('cancelar fecha o diálogo sem chamar a API', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      const dialogo = await abrirDialogo('Bruno Ficcional');

      await usuario.type(within(dialogo).getByLabelText('Nova senha temporária'), SENHA_TEMPORARIA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chamadas('PUT', '/usuarios/2/senha')).toHaveLength(0);
    });

    it('não há "Redefinir senha" para o próprio usuário logado', async () => {
      gravarSessaoFicticia();
      mockarUsuarios(() => respostaFalsa(204));
      renderizarApp('/usuarios');
      await screen.findByRole('table');

      expect(
        screen.queryByRole('button', { name: 'Redefinir senha de Maria Fictícia' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Redefinir senha de Bruno Ficcional' }),
      ).toBeInTheDocument();
    });

    it('quem não é Gestão não vê a ação "Redefinir senha"', () => {
      gravarSessaoFicticia({ usuario: PROFESSOR_FICTICIO });
      renderizarApp('/usuarios');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Redefinir senha/ })).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
