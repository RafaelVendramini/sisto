// Fluxos da Issue #39 — tela de categorias de ocorrência: listagem, cadastro,
// edição e acesso por perfil (API mockada, sem rede).
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
// Textos do contrato do back-end (Issue #38).
const MSG_DUPLICADA = 'Já existe uma categoria cadastrada com este nome.';
const MSG_CONCORRENCIA =
  'A categoria foi alterada por outra operação ao mesmo tempo. Tente novamente.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

const PEDAGOGICO = { id: 5, nome: 'Clara Pedagoga Fictícia', perfil: 'PEDAGOGICO' };

const CATEGORIAS_FICTICIAS = [
  { id: 2, nome: 'Conflitos', descricao: 'Desentendimentos entre estudantes.' },
  { id: 1, nome: 'Indisciplina', descricao: null },
];

/**
 * GET /categorias devolve `lista` (array ou função chamada a cada GET);
 * POST /categorias chama `aoCriar(corpo)`; PUT /categorias/{id} chama `aoAtualizar(id, corpo)`.
 */
function mockarApi({ lista = CATEGORIAS_FICTICIAS, aoCriar, aoAtualizar } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/categorias` && opcoes.method === 'GET') {
      return typeof lista === 'function' ? lista() : respostaFalsa(200, lista);
    }
    if (url === `${URL_API}/categorias` && opcoes.method === 'POST' && aoCriar) {
      return aoCriar(JSON.parse(opcoes.body));
    }
    const put = url.match(/\/categorias\/(\d+)$/);
    if (put && opcoes.method === 'PUT' && aoAtualizar) {
      return aoAtualizar(Number(put[1]), JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadas(metodo) {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === metodo);
}

function nomesNaTabela() {
  const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return linhas.map((linha) => within(linha).getAllByRole('cell')[0].textContent);
}

function linhaDe(nome) {
  const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  const linha = linhas.find((l) => within(l).getAllByRole('cell')[0].textContent === nome);
  if (!linha) throw new Error(`Linha não encontrada: ${nome}`);
  return linha;
}

async function abrirPagina() {
  renderizarApp('/categorias');
  await screen.findByRole('table');
}

function formularioCadastro() {
  const secao = screen.getByRole('region', { name: 'Cadastrar categoria' });
  return {
    nome: within(secao).getByLabelText('Nome'),
    descricao: within(secao).getByLabelText('Descrição (opcional)'),
    cadastrar: within(secao).getByRole('button', { name: 'Cadastrar categoria' }),
  };
}

describe('Tela de categorias de ocorrência (#39)', () => {
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

  describe('acesso por perfil (RN01, matriz da Seção 4)', () => {
    it('Gestão vê o item "Categorias" no menu e chega à página', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Categorias' }));

      expect(
        screen.getByRole('heading', { level: 1, name: 'Categorias de ocorrência' }),
      ).toBeInTheDocument();
      expect(await screen.findByText('Conflitos')).toBeInTheDocument();
    });

    it('Pedagógico vê o item "Categorias" (sem "Usuários") e acessa a página', async () => {
      gravarSessaoFicticia({ usuario: PEDAGOGICO });
      mockarApi();
      renderizarApp('/categorias');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Categorias' })).toHaveAttribute(
        'href',
        '/categorias',
      );
      expect(within(menu).queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
      expect(await screen.findByText('Indisciplina')).toBeInTheDocument();
    });

    it.each(['PROFESSOR', 'TUTOR', 'TECNICO_ADMINISTRATIVO'])(
      '%s não vê o item de menu nem a página, e a API não é chamada',
      (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        renderizarApp('/categorias');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        expect(within(menu).queryByRole('link', { name: 'Categorias' })).not.toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Voltar para o início' })).toHaveAttribute(
          'href',
          '/',
        );
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('sem sessão, /categorias leva ao login', () => {
      renderizarApp('/categorias');

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('listagem', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('exibe nome, descrição e "Editar", sem botão de excluir (RN21)', async () => {
      mockarApi();
      await abrirPagina();

      const tabela = screen.getByRole('table');
      const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
      expect(cabecalhos).toEqual(['Nome', 'Descrição', 'Ações']);
      expect(nomesNaTabela()).toEqual(['Conflitos', 'Indisciplina']);
      expect(within(linhaDe('Conflitos')).getByText('Desentendimentos entre estudantes.')).toBeInTheDocument();
      expect(within(linhaDe('Indisciplina')).getByText('Sem descrição')).toBeInTheDocument();
      expect(
        within(tabela).getByRole('button', { name: 'Editar a categoria Conflitos' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /excluir|remover|apagar/i })).not.toBeInTheDocument();

      const [url, opcoes] = fetch.mock.calls[0];
      expect(url).toBe(`${URL_API}/categorias`);
      expect(opcoes.method).toBe('GET');
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('mostra aviso de lista vazia', async () => {
      mockarApi({ lista: [] });
      renderizarApp('/categorias');

      expect(
        await screen.findByText('Nenhuma categoria cadastrada até o momento.'),
      ).toBeInTheDocument();
    });

    it('em erro, mostra mensagem amigável e "Tentar novamente" recarrega a lista', async () => {
      let tentativa = 0;
      mockarApi({
        lista: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(500, { erro: 'Erro interno do servidor.' })
            : respostaFalsa(200, CATEGORIAS_FICTICIAS);
        },
      });
      renderizarApp('/categorias');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar a lista de categorias agora.');
      expect(alerta.textContent).not.toMatch(/500|interno/i);

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(tentativa).toBe(2);
    });

    it('sem conexão, mostra mensagem fixa amigável', async () => {
      fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      renderizarApp('/categorias');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
    });

    it('401 na listagem volta ao login com aviso (fluxo central de sessão)', async () => {
      mockarApi({
        lista: () => respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }),
      });
      renderizarApp('/categorias');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    });
  });

  describe('cadastro', () => {
    beforeEach(() => {
      gravarSessaoFicticia({ usuario: PEDAGOGICO });
    });

    it('cria a categoria, atualiza a lista em ordem e confirma, sem novo GET', async () => {
      mockarApi({
        aoCriar: (corpo) => respostaFalsa(201, { id: 3, nome: corpo.nome, descricao: corpo.descricao ?? null }),
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '  Bullying  ');
      await usuario.type(c.descricao, 'Intimidação repetida.');
      await usuario.click(c.cadastrar);

      expect(await screen.findByText('Categoria Bullying cadastrada com sucesso.')).toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Bullying', 'Conflitos', 'Indisciplina']);
      expect(within(linhaDe('Bullying')).getByText('Intimidação repetida.')).toBeInTheDocument();

      const [[, opcoes]] = chamadas('POST');
      expect(JSON.parse(opcoes.body)).toEqual({ nome: 'Bullying', descricao: 'Intimidação repetida.' });
      expect(chamadas('GET')).toHaveLength(1);
      // Formulário limpo para o próximo cadastro.
      expect(c.nome).toHaveValue('');
      expect(c.descricao).toHaveValue('');
    });

    it('descrição em branco não é enviada', async () => {
      mockarApi({
        aoCriar: (corpo) => respostaFalsa(201, { id: 3, nome: corpo.nome, descricao: null }),
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Evasão');
      await usuario.type(c.descricao, '   ');
      await usuario.click(c.cadastrar);

      expect(await screen.findByText('Categoria Evasão cadastrada com sucesso.')).toBeInTheDocument();
      const [[, opcoes]] = chamadas('POST');
      expect(JSON.parse(opcoes.body)).toEqual({ nome: 'Evasão' });
    });

    it('nome vazio mostra erro no campo e não chama a API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '   ');
      await usuario.click(c.cadastrar);

      expect(screen.getByText('Informe o nome da categoria.')).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');
      expect(c.nome).toHaveFocus();
      expect(chamadas('POST')).toHaveLength(0);
    });

    it('limita nome e descrição aos tamanhos aceitos pela API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      expect(c.nome).toHaveAttribute('maxLength', '150');
      expect(c.descricao).toHaveAttribute('maxLength', '1000');
      expect(screen.getAllByText(/Até 150 caracteres/)[0]).toBeInTheDocument();
    });

    it('409 de nome repetido mostra mensagem clara junto ao campo Nome', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'CATEGORIA_DUPLICADA' }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'conflitos');
      await usuario.click(c.cadastrar);

      expect(await screen.findByText(MSG_DUPLICADA)).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');
      expect(c.nome).toHaveFocus();
      expect(c.nome).toHaveValue('conflitos');
      expect(nomesNaTabela()).toEqual(['Conflitos', 'Indisciplina']);
    });

    it('400 mostra a mensagem do servidor', async () => {
      mockarApi({
        aoCriar: () => respostaFalsa(400, { erro: 'Informe nome (texto não vazio).' }),
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Agressões');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent('Informe nome (texto não vazio).');
    });

    it('403 mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Agressões');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão ao cadastrar mostra mensagem amigável e mantém o que foi digitado', async () => {
      mockarApi({
        aoCriar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Agressões');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(c.nome).toHaveValue('Agressões');
    });
  });

  describe('erro do campo some ao corrigir (cadastro)', () => {
    beforeEach(() => {
      gravarSessaoFicticia({ usuario: PEDAGOGICO });
    });

    it('"Informe o nome" some assim que o usuário digita no campo Nome', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.click(c.cadastrar);
      expect(screen.getByText('Informe o nome da categoria.')).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');

      await usuario.type(c.nome, 'B');

      expect(screen.queryByText('Informe o nome da categoria.')).not.toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'false');
      expect(c.nome.getAttribute('aria-describedby')).toBe('categoria-nome-ajuda');
    });

    it('409 de nome repetido some ao alterar o Nome; alterar a Descrição não apaga', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'CATEGORIA_DUPLICADA' }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Conflitos');
      await usuario.click(c.cadastrar);
      expect(await screen.findByText(MSG_DUPLICADA)).toBeInTheDocument();

      await usuario.type(c.descricao, 'x');
      expect(screen.getByText(MSG_DUPLICADA)).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');

      await usuario.type(c.nome, ' novos');
      expect(screen.queryByText(MSG_DUPLICADA)).not.toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('edição', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    async function abrirEdicao(nome) {
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: `Editar a categoria ${nome}` }));
      return screen.getByRole('dialog', { name: 'Editar categoria' });
    }

    it('abre o diálogo pré-preenchido, salva, atualiza a lista e confirma', async () => {
      mockarApi({
        aoAtualizar: (id, corpo) => respostaFalsa(200, { id, nome: corpo.nome, descricao: corpo.descricao || null }),
      });
      const dialogo = await abrirEdicao('Indisciplina');

      const nome = within(dialogo).getByLabelText('Nome');
      const descricao = within(dialogo).getByLabelText('Descrição (opcional)');
      expect(nome).toHaveValue('Indisciplina');
      expect(descricao).toHaveValue('');
      expect(nome).toHaveFocus();

      await usuario.clear(nome);
      await usuario.type(nome, 'Atos de indisciplina');
      await usuario.type(descricao, 'Descumprimento das regras da escola.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(
        await screen.findByText('Categoria Atos de indisciplina atualizada com sucesso.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Atos de indisciplina', 'Conflitos']);
      expect(
        within(linhaDe('Atos de indisciplina')).getByText('Descumprimento das regras da escola.'),
      ).toBeInTheDocument();

      const [[url, opcoes]] = chamadas('PUT');
      expect(url).toBe(`${URL_API}/categorias/1`);
      expect(JSON.parse(opcoes.body)).toEqual({
        nome: 'Atos de indisciplina',
        descricao: 'Descumprimento das regras da escola.',
      });
      expect(chamadas('GET')).toHaveLength(1);
    });

    it('apagar a descrição envia descrição vazia (a API grava sem descrição)', async () => {
      mockarApi({
        aoAtualizar: (id, corpo) => respostaFalsa(200, { id, nome: corpo.nome, descricao: corpo.descricao || null }),
      });
      const dialogo = await abrirEdicao('Conflitos');

      await usuario.clear(within(dialogo).getByLabelText('Descrição (opcional)'));
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await screen.findByText('Categoria Conflitos atualizada com sucesso.')).toBeInTheDocument();
      const [[, opcoes]] = chamadas('PUT');
      expect(JSON.parse(opcoes.body)).toEqual({ nome: 'Conflitos', descricao: '' });
      expect(within(linhaDe('Conflitos')).getByText('Sem descrição')).toBeInTheDocument();
    });

    it('sem alterações, avisa e não chama a API', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const dialogo = await abrirEdicao('Conflitos');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(within(dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('409 de nome repetido mostra mensagem clara no campo e mantém o diálogo aberto', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'CATEGORIA_DUPLICADA' }) });
      const dialogo = await abrirEdicao('Indisciplina');

      const nome = within(dialogo).getByLabelText('Nome');
      await usuario.clear(nome);
      await usuario.type(nome, 'CONFLITOS');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByText(MSG_DUPLICADA)).toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'true');
      expect(nome).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'Editar categoria' })).toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Conflitos', 'Indisciplina']);
    });

    it('erro do campo Nome some assim que o usuário altera o campo', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'CATEGORIA_DUPLICADA' }) });
      const dialogo = await abrirEdicao('Indisciplina');

      const nome = within(dialogo).getByLabelText('Nome');
      await usuario.clear(nome);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));
      expect(within(dialogo).getByText('Informe o nome da categoria.')).toBeInTheDocument();

      await usuario.type(nome, 'Conflitos');
      expect(within(dialogo).queryByText('Informe o nome da categoria.')).not.toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'false');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));
      expect(await within(dialogo).findByText(MSG_DUPLICADA)).toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'true');

      await usuario.type(nome, ' graves');
      expect(within(dialogo).queryByText(MSG_DUPLICADA)).not.toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'false');
    });

    it('409 de alteração simultânea mostra aviso geral e recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_CONCORRENCIA, codigo: 'CONFLITO_CONCORRENTE' }) });
      const dialogo = await abrirEdicao('Indisciplina');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA);
      expect(within(dialogo).getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
      await waitFor(() => expect(chamadas('GET')).toHaveLength(2));
    });

    it('o tipo do 409 vem do código: texto de nome repetido com CONFLITO_CONCORRENTE é aviso geral e recarrega (#72)', async () => {
      mockarApi({
        aoAtualizar: () =>
          respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'CONFLITO_CONCORRENTE' }),
      });
      const dialogo = await abrirEdicao('Indisciplina');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_DUPLICADA);
      expect(within(dialogo).getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
      await waitFor(() => expect(chamadas('GET')).toHaveLength(2));
    });

    it('o tipo do 409 vem do código: texto de alteração simultânea com CATEGORIA_DUPLICADA vai para o campo Nome (#72)', async () => {
      mockarApi({
        aoAtualizar: () =>
          respostaFalsa(409, { erro: MSG_CONCORRENCIA, codigo: 'CATEGORIA_DUPLICADA' }),
      });
      const dialogo = await abrirEdicao('Indisciplina');

      const nome = within(dialogo).getByLabelText('Nome');
      await usuario.type(nome, ' escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByText(MSG_CONCORRENCIA)).toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'true');
      expect(nome).toHaveFocus();
      expect(chamadas('GET')).toHaveLength(1);
    });

    it('409 sem código cai na reserva pelo texto: alteração simultânea recarrega a lista (#72)', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_CONCORRENCIA }) });
      const dialogo = await abrirEdicao('Indisciplina');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA);
      expect(within(dialogo).getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
      await waitFor(() => expect(chamadas('GET')).toHaveLength(2));
    });

    it('403 na edição mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      const dialogo = await abrirEdicao('Indisciplina');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('"Cancelar" fecha sem salvar e devolve o foco ao botão "Editar"', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const dialogo = await abrirEdicao('Conflitos');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' alterado');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chamadas('PUT')).toHaveLength(0);
      expect(nomesNaTabela()).toEqual(['Conflitos', 'Indisciplina']);
      expect(screen.getByRole('button', { name: 'Editar a categoria Conflitos' })).toHaveFocus();
    });
  });
});
