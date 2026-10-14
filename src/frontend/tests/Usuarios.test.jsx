// Fluxos da Issue #15 — gestão de usuários: listagem e cadastro (API mockada, sem rede).
// Somente dados fictícios (RN05 / LGPD).
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
const SENHA_TEMPORARIA = 'Temporaria#2026';

const USUARIOS_FICTICIOS = [
  { id: 1, nome: 'Maria Fictícia', email: 'maria@sisto.exemplo', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 2, nome: 'Paulo Exemplo', email: 'paulo@sisto.exemplo', perfil: 'TUTOR', status: 'BLOQUEADO' },
  {
    id: 3,
    nome: 'Rita Teste',
    email: 'rita@sisto.exemplo',
    perfil: 'TECNICO_ADMINISTRATIVO',
    status: 'DESATIVADO',
  },
];

const NOVO_USUARIO = {
  nome: 'Bruno Ficcional',
  email: 'bruno@sisto.exemplo',
  perfil: 'PROFESSOR',
};

/** Responde GET /usuarios com `lista` e POST /usuarios com `aoCadastrar`. */
function mockarApi({ lista = USUARIOS_FICTICIOS, aoCadastrar } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/usuarios` && opcoes.method === 'GET') {
      return typeof lista === 'function' ? lista() : respostaFalsa(200, lista);
    }
    if (url === `${URL_API}/usuarios` && opcoes.method === 'POST') {
      if (aoCadastrar) return aoCadastrar(JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadasPost() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'POST');
}

function campos() {
  return {
    nome: screen.getByLabelText('Nome completo'),
    email: screen.getByLabelText('E-mail'),
    perfil: screen.getByLabelText('Perfil'),
    senha: screen.getByLabelText('Senha temporária'),
    cadastrar: screen.getByRole('button', { name: 'Cadastrar usuário' }),
  };
}

async function abrirPaginaComLista() {
  renderizarApp('/usuarios');
  await screen.findByRole('table');
}

async function preencher(usuario, dados = {}) {
  const valores = { ...NOVO_USUARIO, senha: SENHA_TEMPORARIA, ...dados };
  const c = campos();
  if (valores.nome) {
    await usuario.click(c.nome);
    await usuario.paste(valores.nome);
  }
  if (valores.email) await usuario.type(c.email, valores.email);
  if (valores.perfil) await usuario.selectOptions(c.perfil, valores.perfil);
  if (valores.senha) {
    await usuario.click(c.senha);
    await usuario.paste(valores.senha);
  }
  return c;
}

describe('Gestão de usuários — listagem e cadastro (#15)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('acesso por perfil (RN01)', () => {
    it('Gestão vê os itens "Início" e "Usuários" no menu e chega à página', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/');
      await usuario.click(within(menu).getByRole('link', { name: 'Usuários' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Usuários' })).toBeInTheDocument();
      expect(await screen.findByText('paulo@sisto.exemplo')).toBeInTheDocument();
    });

    it('quem não é Gestão não vê o item de menu nem a página, e a API não é chamada', () => {
      gravarSessaoFicticia({
        usuario: { id: 9, nome: 'Ana Professora Fictícia', perfil: 'PROFESSOR' },
      });
      renderizarApp('/usuarios');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Início' })).toBeInTheDocument();
      expect(within(menu).queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Usuários' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Senha temporária')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voltar para o início' })).toHaveAttribute('href', '/');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sem sessão, /usuarios leva ao login', () => {
      renderizarApp('/usuarios');

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('listagem', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('exibe nome, e-mail, perfil e status com rótulos amigáveis', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const tabela = screen.getByRole('table');
      const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
      expect(cabecalhos).toEqual(['Nome', 'E-mail', 'Perfil', 'Status', 'Ações']);

      const linhas = within(tabela).getAllByRole('row').slice(1);
      expect(linhas).toHaveLength(3);
      const celulas = linhas.map((linha) =>
        within(linha)
          .getAllByRole('cell')
          .slice(0, 4)
          .map((td) => td.textContent),
      );
      expect(celulas).toEqual([
        ['Maria Fictícia', 'maria@sisto.exemplo', 'Gestão', 'Ativo'],
        ['Paulo Exemplo', 'paulo@sisto.exemplo', 'Tutor', 'Bloqueado'],
        ['Rita Teste', 'rita@sisto.exemplo', 'Técnico-administrativo', 'Desativado'],
      ]);
      // Nenhum valor técnico aparece na tela.
      expect(tabela.textContent).not.toMatch(/GESTAO|TECNICO_ADMINISTRATIVO|BLOQUEADO|DESATIVADO/);
      expect(within(linhas[1]).getByText('Bloqueado')).toHaveClass('selo', 'selo--bloqueado');

      const [url, opcoes] = fetch.mock.calls[0];
      expect(url).toBe(`${URL_API}/usuarios`);
      expect(opcoes.method).toBe('GET');
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('mostra "Carregando usuários..." enquanto a lista não chega', async () => {
      let responder;
      mockarApi({ lista: () => new Promise((resolve) => (responder = resolve)) });
      renderizarApp('/usuarios');

      expect(screen.getByText('Carregando usuários...')).toBeInTheDocument();

      responder(respostaFalsa(200, USUARIOS_FICTICIOS));
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByText('Carregando usuários...')).not.toBeInTheDocument();
    });

    it('mostra aviso de lista vazia', async () => {
      mockarApi({ lista: [] });
      renderizarApp('/usuarios');

      expect(
        await screen.findByText('Nenhum usuário cadastrado até o momento.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('em erro, mostra mensagem amigável e "Tentar novamente" recarrega a lista', async () => {
      let tentativa = 0;
      mockarApi({
        lista: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(500, { erro: 'Erro interno do servidor.' })
            : respostaFalsa(200, USUARIOS_FICTICIOS);
        },
      });
      renderizarApp('/usuarios');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar a lista de usuários agora.');
      expect(alerta.textContent).not.toMatch(/500|interno/i);

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(tentativa).toBe(2);
    });

    it('sem conexão, mostra mensagem fixa amigável', async () => {
      fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      renderizarApp('/usuarios');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.',
      );
      expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    });

    it('403 na listagem mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({
        lista: () => respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
      });
      renderizarApp('/usuarios');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Acesso não permitido para o seu perfil.',
      );
    });

    it('401 na listagem volta ao login com aviso (fluxo central de sessão)', async () => {
      mockarApi({
        lista: () => respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }),
      });
      renderizarApp('/usuarios');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    });
  });

  describe('formulário de cadastro', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('tem rótulos em todos os campos, e-mail do tipo email e senha mascarada', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = campos();
      expect(c.nome).toHaveAttribute('type', 'text');
      expect(c.email).toHaveAttribute('type', 'email');
      expect(c.senha).toHaveAttribute('type', 'password');
      expect(c.senha).toHaveAttribute('autocomplete', 'off');
      expect(c.cadastrar).toBeEnabled();
    });

    it('o seletor oferece exatamente os 5 perfis do SSD, com rótulos e valores técnicos', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const opcoes = within(campos().perfil)
        .getAllByRole('option')
        .filter((opcao) => opcao.value !== '');
      expect(opcoes.map((o) => [o.value, o.textContent])).toEqual([
        ['PROFESSOR', 'Professor'],
        ['TUTOR', 'Tutor'],
        ['GESTAO', 'Gestão'],
        ['PEDAGOGICO', 'Pedagógico'],
        ['TECNICO_ADMINISTRATIVO', 'Técnico-administrativo'],
      ]);
    });

    it('permite mostrar e ocultar a senha temporária', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const { senha } = campos();
      const mostrar = screen.getByRole('button', { name: 'Mostrar senha' });
      expect(mostrar).toHaveAttribute('type', 'button');
      expect(mostrar).toHaveAttribute('aria-controls', 'usuario-senha');
      expect(mostrar).not.toHaveAttribute('aria-pressed');
      expect(mostrar).toHaveAttribute('title', 'Mostrar senha');
      await usuario.click(mostrar);
      expect(senha).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute(
        'title',
        'Ocultar senha',
      );
      await usuario.click(screen.getByRole('button', { name: 'Ocultar senha' }));
      expect(senha).toHaveAttribute('type', 'password');
    });

    it('campos vazios: mostra os obrigatórios, foca o primeiro e não chama a API', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = campos();
      await usuario.click(c.cadastrar);

      expect(screen.getByText('Informe o nome.')).toBeInTheDocument();
      expect(screen.getByText('Informe o e-mail.')).toBeInTheDocument();
      expect(screen.getByText('Selecione o perfil.')).toBeInTheDocument();
      expect(screen.getByText('Informe a senha temporária.')).toBeInTheDocument();
      for (const campo of [c.nome, c.email, c.perfil, c.senha]) {
        expect(campo).toHaveAttribute('aria-invalid', 'true');
      }
      expect(c.nome).toHaveAccessibleDescription('Informe o nome.');
      expect(c.nome).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('e-mail em formato inválido não é enviado e recebe o foco', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = await preencher(usuario, { email: 'bruno-sem-arroba' });
      await usuario.click(c.cadastrar);

      expect(
        screen.getByText('Informe um e-mail em formato válido (ex.: nome@escola.com).'),
      ).toBeInTheDocument();
      expect(c.email).toHaveAttribute('aria-invalid', 'true');
      expect(c.email).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it.each([
      ['pontos seguidos no domínio', 'a@b..com'],
      ['domínio sem extensão', 'bruno@sisto'],
      ['domínio terminado em ponto', 'bruno@sisto.'],
      ['espaço no meio', 'bruno silva@sisto.exemplo'],
    ])('e-mail com %s (%s) é recusado na tela, como no back-end', async (_caso, email) => {
      mockarApi();
      await abrirPaginaComLista();

      const c = await preencher(usuario, { email });
      await usuario.click(c.cadastrar);

      expect(c.email).toHaveAccessibleDescription(
        'Informe um e-mail em formato válido (ex.: nome@escola.com).',
      );
      expect(chamadasPost()).toHaveLength(0);
    });

    it('e-mail com mais de 254 caracteres é recusado na tela', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = await preencher(usuario, { email: null });
      await usuario.click(c.email);
      await usuario.paste(`${'b'.repeat(64)}@${'d'.repeat(186)}.exemplo`);
      await usuario.click(c.cadastrar);

      expect(c.email).toHaveAccessibleDescription('O e-mail deve ter no máximo 254 caracteres.');
      expect(chamadasPost()).toHaveLength(0);
    });

    it('senha com menos de 8 caracteres é recusada na tela (RN10)', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = await preencher(usuario, { senha: 'abc1234' });
      await usuario.click(c.cadastrar);

      expect(c.senha).toHaveAccessibleDescription(
        expect.stringContaining('A senha deve ter no mínimo 8 caracteres.'),
      );
      expect(c.senha).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('senha acima de 72 bytes é recusada na tela', async () => {
      mockarApi();
      await abrirPaginaComLista();

      // 40 caracteres acentuados = 80 bytes em UTF-8.
      const c = await preencher(usuario, { senha: 'é'.repeat(40) });
      await usuario.click(c.cadastrar);

      expect(screen.getByText(/a senha está muito longa/i)).toBeInTheDocument();
      expect(c.senha).toHaveAttribute('aria-invalid', 'true');
      expect(chamadasPost()).toHaveLength(0);
    });

    it('nome com mais de 150 caracteres é recusado na tela', async () => {
      mockarApi();
      await abrirPaginaComLista();

      const c = await preencher(usuario, { nome: 'N'.repeat(151) });
      await usuario.click(c.cadastrar);

      expect(screen.getByText('O nome deve ter no máximo 150 caracteres.')).toBeInTheDocument();
      expect(c.nome).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('cadastro com sucesso: confirma, limpa o formulário e mostra o novo usuário como Ativo', async () => {
      mockarApi({
        aoCadastrar: (corpo) =>
          respostaFalsa(201, {
            id: 4,
            nome: corpo.nome,
            email: corpo.email,
            perfil: corpo.perfil,
            status: 'ATIVO',
          }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario, { nome: `  ${NOVO_USUARIO.nome}  ` });
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByText('Usuário Bruno Ficcional cadastrado com sucesso.'),
      ).toBeInTheDocument();

      // Corpo enviado: só os campos do contrato, com nome/e-mail sem espaços extras.
      const [[url, opcoes]] = chamadasPost();
      expect(url).toBe(`${URL_API}/usuarios`);
      expect(JSON.parse(opcoes.body)).toEqual({ ...NOVO_USUARIO, senha: SENHA_TEMPORARIA });
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);

      // Formulário limpo (inclusive a senha).
      expect(c.nome).toHaveValue('');
      expect(c.email).toHaveValue('');
      expect(c.perfil).toHaveValue('');
      expect(c.senha).toHaveValue('');
      expect(c.senha).toHaveAttribute('type', 'password');

      // Lista atualizada, em ordem por nome, com status Ativo.
      const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(linhas.map((l) => within(l).getAllByRole('cell')[0].textContent)).toEqual([
        'Bruno Ficcional',
        'Maria Fictícia',
        'Paulo Exemplo',
        'Rita Teste',
      ]);
      expect(
        within(linhas[0])
          .getAllByRole('cell')
          .slice(0, 4)
          .map((td) => td.textContent),
      ).toEqual([
        'Bruno Ficcional',
        'bruno@sisto.exemplo',
        'Professor',
        'Ativo',
      ]);
    });

    it('a senha nunca aparece fora do campo (tela, mensagens e armazenamento)', async () => {
      mockarApi({
        aoCadastrar: (corpo) =>
          respostaFalsa(201, { id: 4, ...NOVO_USUARIO, status: 'ATIVO', senhaEco: corpo.senha }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);
      await screen.findByText('Usuário Bruno Ficcional cadastrado com sucesso.');

      expect(document.body.textContent).not.toContain(SENHA_TEMPORARIA);
      expect(JSON.stringify({ ...sessionStorage })).not.toContain(SENHA_TEMPORARIA);
      expect(JSON.stringify({ ...localStorage })).not.toContain(SENHA_TEMPORARIA);
    });

    it('botão fica desabilitado com "Cadastrando..." durante o envio', async () => {
      let responder;
      mockarApi({ aoCadastrar: () => new Promise((resolve) => (responder = resolve)) });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      const botao = screen.getByRole('button', { name: 'Cadastrando...' });
      expect(botao).toBeDisabled();
      await usuario.click(botao);
      expect(chamadasPost()).toHaveLength(1);

      responder(respostaFalsa(201, { id: 4, ...NOVO_USUARIO, status: 'ATIVO' }));
      expect(await screen.findByRole('button', { name: 'Cadastrar usuário' })).toBeEnabled();
    });

    it('e-mail duplicado (409) mostra mensagem clara junto ao e-mail', async () => {
      mockarApi({
        aoCadastrar: () =>
          respostaFalsa(409, { erro: 'Já existe um usuário cadastrado com este e-mail.' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario, { email: 'maria@sisto.exemplo' });
      await usuario.click(c.cadastrar);

      await waitFor(() =>
        expect(c.email).toHaveAccessibleDescription(
          'Já existe um usuário cadastrado com este e-mail.',
        ),
      );
      expect(c.email).toHaveAttribute('aria-invalid', 'true');
      expect(c.email).toHaveFocus();
      expect(screen.queryByText(/cadastrado com sucesso/)).not.toBeInTheDocument();
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
      expect(document.body.textContent).not.toContain(SENHA_TEMPORARIA);
    });

    it('após o 409, os demais campos continuam preenchidos para correção', async () => {
      mockarApi({
        aoCadastrar: () =>
          respostaFalsa(409, { erro: 'Já existe um usuário cadastrado com este e-mail.' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario, { email: 'maria@sisto.exemplo' });
      await usuario.click(c.cadastrar);
      await waitFor(() => expect(c.email).toHaveAttribute('aria-invalid', 'true'));

      expect(c.nome).toHaveValue(NOVO_USUARIO.nome);
      expect(c.email).toHaveValue('maria@sisto.exemplo');
      expect(c.perfil).toHaveValue(NOVO_USUARIO.perfil);
      expect(c.senha).toHaveValue(SENHA_TEMPORARIA);
      expect(c.senha).toHaveAttribute('type', 'password');
    });

    it('erro de validação do back-end (400) mostra a mensagem recebida', async () => {
      mockarApi({
        aoCadastrar: () => respostaFalsa(400, { erro: 'Informe um e-mail em formato válido.' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Informe um e-mail em formato válido.',
      );
      expect(c.cadastrar).toBeEnabled();
    });

    it('400 sem mensagem do back-end mostra mensagem genérica, sem detalhe técnico', async () => {
      mockarApi({ aoCadastrar: () => respostaFalsa(400) });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível cadastrar o usuário agora. Tente novamente em instantes.',
      );
      expect(alerta.textContent).not.toMatch(/400/);
    });

    it('erro interno (500) no cadastro mostra mensagem genérica, sem detalhe técnico', async () => {
      mockarApi({
        aoCadastrar: () => respostaFalsa(500, { erro: 'PrismaClientKnownRequestError P2002' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível cadastrar o usuário agora. Tente novamente em instantes.',
      );
      expect(alerta.textContent).not.toMatch(/prisma|500/i);
      expect(c.cadastrar).toBeEnabled();
    });

    it('403 no cadastro mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({
        aoCadastrar: () => respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Acesso não permitido para o seu perfil.',
      );
    });

    it('falha de rede no cadastro mostra mensagem amigável, sem detalhe técnico', async () => {
      mockarApi({
        aoCadastrar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.',
      );
      expect(alerta.textContent).not.toMatch(/failed to fetch|typeerror/i);
      expect(document.body.textContent).not.toContain(SENHA_TEMPORARIA);
    });

    it('401 no cadastro volta ao login com aviso (fluxo central de sessão)', async () => {
      mockarApi({
        aoCadastrar: () => respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }),
      });
      await abrirPaginaComLista();

      const c = await preencher(usuario);
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    });
  });
});
