// Fluxos da Issue #16 — edição, bloqueio, desativação e reativação de usuários
// (API mockada, sem rede). Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHAVE_SESSAO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
const MSG_ULTIMA_GESTAO =
  'O sistema precisa manter ao menos um usuário da Gestão ativo. Ative ou cadastre outro usuário da Gestão antes desta alteração.';
const MSG_PROPRIO_USUARIO =
  'Você não pode bloquear, desativar ou alterar o perfil do seu próprio usuário.';
const MSG_EMAIL_DUPLICADO = 'Já existe um usuário cadastrado com este e-mail.';
const MSG_CONCORRENCIA = 'O usuário foi alterado por outra operação ao mesmo tempo. Tente novamente.';

// A sessão fictícia (utilitarios.jsx) é a de Maria Fictícia, id 1, Gestão.
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

/**
 * GET /usuarios devolve `lista` (array ou função chamada a cada GET);
 * PUT /usuarios/{id} chama `aoAtualizar(id, corpo)`.
 */
function mockarApi({ aoAtualizar, lista = USUARIOS_FICTICIOS } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/usuarios` && opcoes.method === 'GET') {
      return respostaFalsa(200, typeof lista === 'function' ? lista() : lista);
    }
    const put = url.match(/\/usuarios\/(\d+)$/);
    if (put && opcoes.method === 'PUT' && aoAtualizar) {
      return aoAtualizar(Number(put[1]), JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

/** PUT bem-sucedido: devolve o usuário com as alterações aplicadas (como o back-end). */
function putComSucesso(id, corpo) {
  const atual = USUARIOS_FICTICIOS.find((u) => u.id === id);
  return respostaFalsa(200, { ...atual, ...corpo });
}

function chamadasGet() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'GET');
}

function chamadasPut() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'PUT');
}

async function abrirPagina() {
  renderizarApp('/usuarios');
  await screen.findByRole('table');
}

function linhaDe(nome) {
  const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  const linha = linhas.find((l) => within(l).getAllByRole('cell')[0].textContent === nome);
  if (!linha) throw new Error(`Linha não encontrada: ${nome}`);
  return linha;
}

function celulas(nome) {
  return within(linhaDe(nome))
    .getAllByRole('cell')
    .slice(0, 4)
    .map((td) => td.textContent);
}

function botoesDaLinha(nome) {
  return within(linhaDe(nome))
    .getAllByRole('button')
    .map((b) => b.textContent);
}

describe('Gestão de usuários — edição, bloqueio, desativação e reativação (#16)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
    gravarSessaoFicticia();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('ações na lista', () => {
    it('mostra só as ações aplicáveis ao status atual, com o nome no rótulo acessível', async () => {
      mockarApi();
      await abrirPagina();

      const cabecalhos = within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((th) => th.textContent);
      expect(cabecalhos).toEqual(['Nome', 'E-mail', 'Perfil', 'Status', 'Ações']);

      // Ativo → Bloquear e Desativar.
      expect(botoesDaLinha('Bruno Ficcional')).toEqual([
        'Editar',
        'Bloquear',
        'Desativar',
        'Redefinir senha',
      ]);
      // Bloqueado → Reativar (ou Desativar).
      expect(botoesDaLinha('Paulo Exemplo')).toEqual([
        'Editar',
        'Reativar',
        'Desativar',
        'Redefinir senha',
      ]);
      // Desativado → Reativar (ou Bloquear).
      expect(botoesDaLinha('Rita Teste')).toEqual([
        'Editar',
        'Reativar',
        'Bloquear',
        'Redefinir senha',
      ]);

      expect(screen.getByRole('button', { name: 'Editar Bruno Ficcional' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Desativar Bruno Ficcional' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reativar Paulo Exemplo' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reativar Rita Teste' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Reativar Bruno Ficcional' }),
      ).not.toBeInTheDocument();
    });

    it('não existe ação de excluir usuário e a tela explica que ninguém é excluído', async () => {
      mockarApi();
      await abrirPagina();

      expect(screen.queryByRole('button', { name: /excluir|remover|apagar|deletar/i })).toBeNull();
      expect(screen.getByText(/Usuários não são excluídos/)).toHaveTextContent(
        /o histórico dos registros é mantido/,
      );
    });

    it('próprio usuário (RN11): sem bloquear/desativar, com aviso de "você"', async () => {
      mockarApi();
      await abrirPagina();

      expect(botoesDaLinha('Maria Fictícia')).toEqual(['Editar']);
      expect(
        screen.queryByRole('button', { name: 'Bloquear Maria Fictícia' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Desativar Maria Fictícia' }),
      ).not.toBeInTheDocument();
      expect(within(linhaDe('Maria Fictícia')).getByText(/Este é você/)).toHaveTextContent(
        'Não é possível bloquear, desativar nem alterar o perfil do seu próprio usuário.',
      );
    });
  });

  describe('edição', () => {
    it('abre o diálogo pré-preenchido, salva só o que mudou e atualiza a lista', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      const botaoEditar = screen.getByRole('button', { name: 'Editar Bruno Ficcional' });
      await usuario.click(botaoEditar);

      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      const nome = within(dialogo).getByLabelText('Nome completo');
      const email = within(dialogo).getByLabelText('E-mail');
      const perfil = within(dialogo).getByLabelText('Perfil');
      expect(nome).toHaveFocus();
      expect(nome).toHaveValue('Bruno Ficcional');
      expect(email).toHaveValue('bruno@sisto.exemplo');
      expect(perfil).toHaveValue('PROFESSOR');
      expect(perfil).toBeEnabled();
      // Sem campo de senha na edição.
      expect(within(dialogo).queryByLabelText(/senha/i)).not.toBeInTheDocument();

      await usuario.clear(nome);
      await usuario.type(nome, 'Bruno Ficcional Silva');
      await usuario.selectOptions(perfil, 'TUTOR');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await screen.findByText('Dados de Bruno Ficcional Silva atualizados.')).toBeInTheDocument();
      expect(screen.getByText('Dados de Bruno Ficcional Silva atualizados.').closest('[role="status"]'))
        .not.toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Corpo do PUT: só os campos alterados, na rota do usuário certo, autenticado.
      const [[url, opcoes]] = chamadasPut();
      expect(url).toBe(`${URL_API}/usuarios/2`);
      expect(JSON.parse(opcoes.body)).toEqual({ nome: 'Bruno Ficcional Silva', perfil: 'TUTOR' });
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);

      expect(celulas('Bruno Ficcional Silva')).toEqual([
        'Bruno Ficcional Silva',
        'bruno@sisto.exemplo',
        'Tutor',
        'Ativo',
      ]);
      // O foco volta ao botão que abriu o diálogo.
      expect(screen.getByRole('button', { name: 'Editar Bruno Ficcional Silva' })).toHaveFocus();
    });

    it('valida os dados como no cadastro, sem chamar a API', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const nome = within(dialogo).getByLabelText('Nome completo');
      const email = within(dialogo).getByLabelText('E-mail');

      await usuario.clear(nome);
      await usuario.clear(email);
      await usuario.type(email, 'bruno@exemplo');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(within(dialogo).getByText('Informe o nome.')).toBeInTheDocument();
      expect(
        within(dialogo).getByText('Informe um e-mail em formato válido (ex.: nome@escola.com).'),
      ).toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveAttribute('aria-invalid', 'true');
      expect(nome).toHaveFocus();

      await usuario.click(nome);
      await usuario.paste('B'.repeat(151));
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));
      expect(
        within(dialogo).getByText('O nome deve ter no máximo 150 caracteres.'),
      ).toBeInTheDocument();

      expect(chamadasPut()).toHaveLength(0);
    });

    it('sem nenhuma alteração, avisa e não chama a API', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });

      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(within(dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadasPut()).toHaveLength(0);
    });

    it('"Cancelar" descarta as alterações e devolve o foco ao botão "Editar"', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      const botaoEditar = screen.getByRole('button', { name: 'Editar Bruno Ficcional' });
      await usuario.click(botaoEditar);
      let dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      await usuario.clear(within(dialogo).getByLabelText('Nome completo'));
      await usuario.type(within(dialogo).getByLabelText('Nome completo'), 'Outro Nome');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(botaoEditar).toHaveFocus();
      expect(celulas('Bruno Ficcional')[0]).toBe('Bruno Ficcional');
      expect(chamadasPut()).toHaveLength(0);

      // Reabrindo, os dados originais voltam.
      await usuario.click(botaoEditar);
      dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      expect(within(dialogo).getByLabelText('Nome completo')).toHaveValue('Bruno Ficcional');
    });

    it('Esc fecha a edição sem salvar', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      const botaoEditar = screen.getByRole('button', { name: 'Editar Rita Teste' });
      await usuario.click(botaoEditar);
      expect(screen.getByRole('dialog', { name: 'Editar usuário' })).toBeInTheDocument();

      await usuario.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(botaoEditar).toHaveFocus();
      expect(chamadasPut()).toHaveLength(0);
    });

    it('próprio usuário (RN11): perfil travado com explicação; envia só o nome', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Maria Fictícia' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const perfil = within(dialogo).getByLabelText('Perfil');

      expect(perfil).toBeDisabled();
      expect(perfil).toHaveAccessibleDescription(
        'Você não pode alterar o seu próprio perfil. Peça a outro usuário da Gestão, se necessário.',
      );

      const nome = within(dialogo).getByLabelText('Nome completo');
      await usuario.clear(nome);
      await usuario.type(nome, 'Maria Fictícia Souza');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await screen.findByText('Dados de Maria Fictícia Souza atualizados.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ nome: 'Maria Fictícia Souza' });
    });

    it('409 de e-mail já cadastrado aparece junto ao campo E-mail', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_EMAIL_DUPLICADO }) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const email = within(dialogo).getByLabelText('E-mail');

      await usuario.clear(email);
      await usuario.type(email, 'paulo@sisto.exemplo');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
      expect(email).toHaveAccessibleDescription(MSG_EMAIL_DUPLICADO);
      expect(email).toHaveFocus();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ email: 'paulo@sisto.exemplo' });
      // O diálogo continua aberto e a lista não muda.
      expect(screen.getByRole('dialog', { name: 'Editar usuário' })).toBeInTheDocument();
      expect(celulas('Bruno Ficcional')[1]).toBe('bruno@sisto.exemplo');
    });

    it('409 da RN11 (última Gestão ativa) mostra a mensagem do back-end', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_ULTIMA_GESTAO }) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Perfil'), 'GESTAO');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_ULTIMA_GESTAO);
      expect(within(dialogo).getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'false');
    });

    it('400 mostra a mensagem do back-end', async () => {
      mockarApi({
        aoAtualizar: () => respostaFalsa(400, { erro: 'Informe um nome com até 150 caracteres.' }),
      });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      await usuario.type(within(dialogo).getByLabelText('Nome completo'), ' Jr');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Informe um nome com até 150 caracteres.',
      );
    });
  });

  describe('bloquear, desativar e reativar', () => {
    it('bloquear pede confirmação clara; "Cancelar" não chama a API e devolve o foco', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      const botaoBloquear = screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' });

      await usuario.click(botaoBloquear);

      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      expect(dialogo).toHaveAccessibleDescription(/Bloquear o acesso de Bruno Ficcional\?/);
      expect(dialogo).toHaveTextContent('O acesso será cortado imediatamente');
      expect(dialogo).toHaveTextContent('O usuário não será excluído');
      expect(dialogo).toHaveTextContent('o histórico dos registros dele continuam guardados');
      expect(within(dialogo).queryByRole('button', { name: /excluir/i })).toBeNull();
      // Foco começa na opção menos destrutiva.
      expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();

      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(botaoBloquear).toHaveFocus();
      expect(chamadasPut()).toHaveLength(0);
      expect(celulas('Bruno Ficcional')[3]).toBe('Ativo');
    });

    it('confirmar o bloqueio envia status BLOQUEADO e atualiza o selo', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));

      expect(await screen.findByText('Usuário Bruno Ficcional bloqueado.')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

      const [[url, opcoes]] = chamadasPut();
      expect(url).toBe(`${URL_API}/usuarios/2`);
      expect(JSON.parse(opcoes.body)).toEqual({ status: 'BLOQUEADO' });

      expect(within(linhaDe('Bruno Ficcional')).getByText('Bloqueado')).toHaveClass(
        'selo',
        'selo--bloqueado',
      );
      expect(botoesDaLinha('Bruno Ficcional')).toEqual([
        'Editar',
        'Reativar',
        'Desativar',
        'Redefinir senha',
      ]);
      // O botão "Bloquear" sumiu: o foco vai para "Editar" da mesma linha.
      expect(screen.getByRole('button', { name: 'Editar Bruno Ficcional' })).toHaveFocus();
    });

    it('desativar pede confirmação (Esc cancela) e, confirmado, envia DESATIVADO', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      const botaoDesativar = screen.getByRole('button', { name: 'Desativar Bruno Ficcional' });

      await usuario.click(botaoDesativar);
      let dialogo = screen.getByRole('alertdialog', { name: 'Desativar usuário' });
      expect(dialogo).toHaveTextContent('Desativar o usuário Bruno Ficcional?');
      expect(dialogo).toHaveTextContent('O usuário não será excluído');

      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(botaoDesativar).toHaveFocus();
      expect(chamadasPut()).toHaveLength(0);

      await usuario.click(botaoDesativar);
      dialogo = screen.getByRole('alertdialog', { name: 'Desativar usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));

      expect(await screen.findByText('Usuário Bruno Ficcional desativado.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ status: 'DESATIVADO' });
      expect(celulas('Bruno Ficcional')[3]).toBe('Desativado');
      expect(botoesDaLinha('Bruno Ficcional')).toEqual([
        'Editar',
        'Reativar',
        'Bloquear',
        'Redefinir senha',
      ]);
    });

    it('reativar um usuário bloqueado envia ATIVO e o status volta para Ativo', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Reativar Paulo Exemplo' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Reativar usuário' });
      expect(dialogo).toHaveTextContent('Reativar o acesso de Paulo Exemplo?');
      expect(dialogo).toHaveTextContent('com o perfil Tutor');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Reativar acesso' }));

      expect(await screen.findByText('Usuário Paulo Exemplo reativado.')).toBeInTheDocument();
      const [[url, opcoes]] = chamadasPut();
      expect(url).toBe(`${URL_API}/usuarios/3`);
      expect(JSON.parse(opcoes.body)).toEqual({ status: 'ATIVO' });
      expect(within(linhaDe('Paulo Exemplo')).getByText('Ativo')).toHaveClass('selo--ativo');
      expect(botoesDaLinha('Paulo Exemplo')).toEqual([
        'Editar',
        'Bloquear',
        'Desativar',
        'Redefinir senha',
      ]);
    });

    it('reativar um usuário desativado envia ATIVO', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Reativar Rita Teste' }));
      await usuario.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reativar acesso' }),
      );

      expect(await screen.findByText('Usuário Rita Teste reativado.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ status: 'ATIVO' });
      expect(celulas('Rita Teste')[3]).toBe('Ativo');
    });

    it('o foco fica preso no diálogo com Tab e Shift+Tab', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      const cancelar = within(dialogo).getByRole('button', { name: 'Cancelar' });
      const confirmar = within(dialogo).getByRole('button', { name: 'Bloquear acesso' });

      expect(cancelar).toHaveFocus();
      await usuario.tab();
      expect(confirmar).toHaveFocus();
      await usuario.tab({ shift: true });
      expect(cancelar).toHaveFocus();
      await usuario.tab({ shift: true });
      expect(confirmar).toHaveFocus();
    });

    it('409 da RN11 mostra a mensagem do back-end e mantém o status', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_PROPRIO_USUARIO }) });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Desativar Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Desativar usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_PROPRIO_USUARIO);
      expect(celulas('Bruno Ficcional')[3]).toBe('Ativo');
      // Pode fechar o diálogo normalmente depois do erro.
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('409 de última Gestão ativa e de alteração simultânea mostram a mensagem do back-end', async () => {
      const respostas = [MSG_ULTIMA_GESTAO, MSG_CONCORRENCIA];
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: respostas.shift() }) });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_ULTIMA_GESTAO);

      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));
      await waitFor(() =>
        expect(within(dialogo).getByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA),
      );
      expect(celulas('Bruno Ficcional')[3]).toBe('Ativo');
    });

    it('404 mostra "Usuário não encontrado."', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(404, { erro: 'Usuário não encontrado.' }) });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Reativar Rita Teste' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Reativar usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Reativar acesso' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Usuário não encontrado.');
    });

    it('403 mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Acesso não permitido para o seu perfil.',
      );
    });

    it('falha de conexão mostra mensagem fixa, sem nada técnico', async () => {
      mockarApi({
        aoAtualizar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));

      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.',
      );
      expect(alerta).not.toHaveTextContent(/Failed to fetch|TypeError/);
    });

    it('401 (sessão encerrada) volta ao login com aviso', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      await usuario.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Bloquear acesso' }),
      );

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('ajustes da revisão', () => {
    it('troca Bloqueado → Desativado: não fala em cortar o acesso agora e mantém o aviso de não exclusão', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Desativar Paulo Exemplo' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Desativar usuário' });
      expect(dialogo).toHaveTextContent(
        'Mudar a situação de Paulo Exemplo de Bloqueado para Desativado?',
      );
      expect(dialogo).toHaveTextContent(
        'A pessoa continua sem acesso ao Sisto; só muda a situação registrada.',
      );
      expect(dialogo).not.toHaveTextContent(/cortado imediatamente/);
      expect(dialogo).toHaveTextContent('O usuário não será excluído');
      expect(dialogo).toHaveTextContent('o histórico dos registros dele continuam guardados');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Marcar como desativado' }));

      expect(await screen.findByText('Usuário Paulo Exemplo desativado.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ status: 'DESATIVADO' });
      expect(celulas('Paulo Exemplo')[3]).toBe('Desativado');
    });

    it('troca Desativado → Bloqueado usa o mesmo texto de situação registrada', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Rita Teste' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      expect(dialogo).toHaveTextContent(
        'Mudar a situação de Rita Teste de Desativado para Bloqueado?',
      );
      expect(dialogo).not.toHaveTextContent(/cortado imediatamente/);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Marcar como bloqueado' }));

      expect(await screen.findByText('Usuário Rita Teste bloqueado.')).toBeInTheDocument();
      expect(JSON.parse(chamadasPut()[0][1].body)).toEqual({ status: 'BLOQUEADO' });
    });

    it('com o diálogo aberto a página fica inerte e clicar no fundo não tira o foco do diálogo', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      const { container } = renderizarApp('/usuarios');
      await screen.findByRole('table');
      expect(container).not.toHaveAttribute('inert');

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      expect(container).toHaveAttribute('inert');
      expect(container.contains(dialogo)).toBe(false);

      // Clique no fundo escurecido: o foco continua dentro do diálogo.
      await usuario.click(dialogo.parentElement);
      expect(dialogo.contains(document.activeElement)).toBe(true);
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(container).not.toHaveAttribute('inert');
      expect(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' })).toHaveFocus();
    });

    it('409 com outra mensagem que cita e-mail não vai para o campo E-mail', async () => {
      const outra = 'Não foi possível alterar o e-mail agora.';
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: outra }) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const email = within(dialogo).getByLabelText('E-mail');
      await usuario.clear(email);
      await usuario.type(email, 'bruno.novo@sisto.exemplo');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(outra);
      expect(email).toHaveAttribute('aria-invalid', 'false');
    });

    it('duplo clique em salvar envia um único PUT e os campos ficam travados durante o envio', async () => {
      let liberar;
      mockarApi({
        aoAtualizar: (id, corpo) =>
          new Promise((resolver) => {
            liberar = () => resolver(putComSucesso(id, corpo));
          }),
      });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const nome = within(dialogo).getByLabelText('Nome completo');
      await usuario.type(nome, ' Jr');
      await usuario.dblClick(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(chamadasPut()).toHaveLength(1);
      expect(within(dialogo).getByRole('button', { name: 'Salvando...' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(nome).toHaveAttribute('readonly');
      await usuario.type(nome, 'X');
      expect(nome).toHaveValue('Bruno Ficcional Jr');

      liberar();
      expect(await screen.findByText('Dados de Bruno Ficcional Jr atualizados.')).toBeInTheDocument();
      expect(chamadasPut()).toHaveLength(1);
    });

    it('duplo clique em confirmar status envia um único PUT', async () => {
      let liberar;
      mockarApi({
        aoAtualizar: (id, corpo) =>
          new Promise((resolver) => {
            liberar = () => resolver(putComSucesso(id, corpo));
          }),
      });
      await abrirPagina();

      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.dblClick(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));
      expect(chamadasPut()).toHaveLength(1);

      liberar();
      expect(await screen.findByText('Usuário Bruno Ficcional bloqueado.')).toBeInTheDocument();
      expect(chamadasPut()).toHaveLength(1);
    });

    it('após 409 de alteração simultânea ou 404, recarrega a lista em segundo plano', async () => {
      let versao = 0;
      const respostas = [
        respostaFalsa(409, { erro: MSG_CONCORRENCIA }),
        respostaFalsa(404, { erro: 'Usuário não encontrado.' }),
      ];
      mockarApi({
        lista: () => {
          versao += 1;
          return versao === 1
            ? USUARIOS_FICTICIOS
            : USUARIOS_FICTICIOS.map((u) => (u.id === 2 ? { ...u, status: 'BLOQUEADO' } : u));
        },
        aoAtualizar: () => respostas.shift(),
      });
      await abrirPagina();
      expect(chamadasGet()).toHaveLength(1);

      await usuario.click(screen.getByRole('button', { name: 'Desativar Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Desativar usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA);
      await waitFor(() => expect(chamadasGet()).toHaveLength(2));
      // A lista é atualizada sem sumir da tela (não volta para "Carregando...").
      await waitFor(() => expect(celulas('Bruno Ficcional')[3]).toBe('Bloqueado'));
      expect(screen.queryByText('Carregando usuários...')).not.toBeInTheDocument();

      await usuario.click(within(dialogo).getByRole('button', { name: 'Desativar usuário' }));
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        'Usuário não encontrado.',
      );
      await waitFor(() => expect(chamadasGet()).toHaveLength(3));
    });

    it('409 de regra (RN11) não recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_ULTIMA_GESTAO }) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Bloquear Bruno Ficcional' }));
      const dialogo = screen.getByRole('alertdialog', { name: 'Bloquear usuário' });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Bloquear acesso' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_ULTIMA_GESTAO);
      expect(chamadasGet()).toHaveLength(1);
    });

    it('ao editar o próprio nome, o cabeçalho e a sessão são atualizados na hora', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      const cabecalho = screen.getByRole('banner');
      expect(within(cabecalho).getByText('Maria Fictícia')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Editar Maria Fictícia' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      const nome = within(dialogo).getByLabelText('Nome completo');
      await usuario.clear(nome);
      await usuario.type(nome, 'Maria Fictícia Souza');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(cabecalho).findByText('Maria Fictícia Souza')).toBeInTheDocument();
      const sessao = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO));
      expect(sessao.usuario).toEqual({ id: 1, nome: 'Maria Fictícia Souza', perfil: 'GESTAO' });
      expect(typeof sessao.token).toBe('string');
    });

    it('ao editar outro usuário, o nome do cabeçalho não muda', async () => {
      mockarApi({ aoAtualizar: putComSucesso });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Bruno Ficcional' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar usuário' });
      await usuario.type(within(dialogo).getByLabelText('Nome completo'), ' Jr');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      await screen.findByText('Dados de Bruno Ficcional Jr atualizados.');
      expect(within(screen.getByRole('banner')).getByText('Maria Fictícia')).toBeInTheDocument();
      expect(JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)).usuario.nome).toBe('Maria Fictícia');
    });
  });
});
