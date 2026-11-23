// Testes complementares do QA para a Issue #39 — tela de categorias.
// Cobrem: permissão por perfil (RN01/RF14), limites aprovados na #38,
// mensagens de erro (RNF02) na edição e no cadastro, duplo envio e RN21.
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';
import { PERFIS_GESTAO_CATEGORIAS, podeGerenciarCategorias } from '../src/services/perfis.js';
import {
  ehConflitoDeNome,
  listaPodeEstarDesatualizada,
  mensagemErroCategoria,
  mensagemNomeDuplicado,
  validarCategoria,
} from '../src/services/mensagensCategorias.js';

const URL_API = 'http://api.exemplo.test';
const MSG_DUPLICADA = 'Já existe uma categoria cadastrada com este nome.';
const MSG_CONCORRENCIA =
  'A categoria foi alterada por outra operação ao mesmo tempo. Tente novamente.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

const CATEGORIAS_FICTICIAS = [
  { id: 2, nome: 'Conflitos', descricao: 'Desentendimentos entre estudantes.' },
  { id: 1, nome: 'Indisciplina', descricao: null },
];

describe('services/perfis — acesso a categorias (RN01, matriz da Seção 4)', () => {
  it.each([
    ['GESTAO', true],
    ['PEDAGOGICO', true],
    ['PROFESSOR', false],
    ['TUTOR', false],
    ['TECNICO_ADMINISTRATIVO', false],
    [undefined, false],
    ['gestao', false],
  ])('perfil %s → %s', (perfil, esperado) => {
    expect(podeGerenciarCategorias(perfil)).toBe(esperado);
  });

  it('a lista de perfis é imutável', () => {
    expect(Object.isFrozen(PERFIS_GESTAO_CATEGORIAS)).toBe(true);
  });
});

describe('services/mensagensCategorias — validação (limites aprovados na #38)', () => {
  it('nome obrigatório (vazio ou só espaços)', () => {
    expect(validarCategoria({ nome: '', descricao: '' }).nome).toBe('Informe o nome da categoria.');
    expect(validarCategoria({ nome: '   ', descricao: '' }).nome).toBe(
      'Informe o nome da categoria.',
    );
  });

  it('nome com 150 caracteres é aceito; 151 é recusado; espaços nas pontas não contam', () => {
    expect(validarCategoria({ nome: 'a'.repeat(150), descricao: '' })).toEqual({});
    expect(validarCategoria({ nome: `  ${'a'.repeat(150)}  `, descricao: '' })).toEqual({});
    expect(validarCategoria({ nome: 'a'.repeat(151), descricao: '' }).nome).toBe(
      'O nome deve ter no máximo 150 caracteres.',
    );
  });

  it('descrição opcional com até 1000 caracteres; 1001 é recusado', () => {
    expect(validarCategoria({ nome: 'Evasão', descricao: '' })).toEqual({});
    expect(validarCategoria({ nome: 'Evasão', descricao: 'd'.repeat(1000) })).toEqual({});
    expect(validarCategoria({ nome: 'Evasão', descricao: 'd'.repeat(1001) }).descricao).toBe(
      'A descrição deve ter no máximo 1000 caracteres.',
    );
  });
});

describe('services/mensagensCategorias — mensagens por status (RNF02)', () => {
  const doServidor = (status, message) => ({ status, message, doServidor: true });

  it('403 e sem conexão usam textos fixos, mesmo com texto do servidor', () => {
    expect(mensagemErroCategoria(doServidor(403, 'qualquer'), 'criar')).toBe(MSG_SEM_PERMISSAO);
    expect(mensagemErroCategoria({ status: 0, message: 'x' }, 'editar')).toBe(MSG_SEM_CONEXAO);
  });

  it('400/404/409 usam o texto do servidor quando existe', () => {
    expect(mensagemErroCategoria(doServidor(400, 'Informe nome (texto não vazio).'), 'criar')).toBe(
      'Informe nome (texto não vazio).',
    );
    expect(mensagemErroCategoria(doServidor(404, 'Categoria não encontrada.'), 'editar')).toBe(
      'Categoria não encontrada.',
    );
  });

  it('404 sem texto do servidor e 500 usam mensagens amigáveis, sem detalhes técnicos', () => {
    expect(mensagemErroCategoria({ status: 404 }, 'editar')).toBe(
      'Categoria não encontrada. Atualize a página e tente novamente.',
    );
    expect(mensagemErroCategoria(doServidor(500, 'Erro interno'), 'criar')).toBe(
      'Não foi possível cadastrar a categoria agora. Tente novamente em instantes.',
    );
    expect(mensagemErroCategoria({ status: 500 }, 'editar')).toBe(
      'Não foi possível salvar a alteração agora. Tente novamente em instantes.',
    );
  });

  it('distingue 409 de nome repetido do 409 de alteração simultânea', () => {
    expect(ehConflitoDeNome(doServidor(409, MSG_DUPLICADA))).toBe(true);
    expect(ehConflitoDeNome(doServidor(409, MSG_CONCORRENCIA))).toBe(false);
    expect(ehConflitoDeNome(doServidor(400, MSG_DUPLICADA))).toBe(false);
    expect(listaPodeEstarDesatualizada(doServidor(409, MSG_CONCORRENCIA))).toBe(true);
    expect(listaPodeEstarDesatualizada(doServidor(409, MSG_DUPLICADA))).toBe(false);
    expect(listaPodeEstarDesatualizada({ status: 404 })).toBe(true);
  });

  it('409 de nome repetido sem texto do servidor usa o texto fixo', () => {
    expect(mensagemNomeDuplicado({ status: 409 })).toBe(MSG_DUPLICADA);
  });
});

describe('Tela de categorias — casos complementares (#39)', () => {
  let usuario;

  function mockarApi({ lista = () => respostaFalsa(200, CATEGORIAS_FICTICIAS), aoCriar, aoAtualizar } = {}) {
    fetch.mockImplementation(async (url, opcoes = {}) => {
      if (url === `${URL_API}/categorias` && opcoes.method === 'GET') return lista();
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

  const chamadas = (metodo) => fetch.mock.calls.filter(([, o]) => o?.method === metodo);

  async function abrirEdicao(nome) {
    renderizarApp('/categorias');
    await screen.findByRole('table');
    await usuario.click(screen.getByRole('button', { name: `Editar a categoria ${nome}` }));
    return screen.getByRole('dialog', { name: 'Editar categoria' });
  }

  function formularioCadastro() {
    const secao = screen.getByRole('region', { name: 'Cadastrar categoria' });
    return {
      nome: within(secao).getByLabelText('Nome'),
      cadastrar: within(secao).getByRole('button', { name: 'Cadastrar categoria' }),
    };
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
    gravarSessaoFicticia();
  });

  afterEach(() => {
    // Desmonta antes de restaurar fetch/env: nenhuma chamada pendente vaza.
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('Gestão vê no menu "Usuários" e "Categorias"', () => {
    mockarApi();
    renderizarApp('/');
    const menu = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(menu).getByRole('link', { name: 'Usuários' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Categorias' })).toHaveAttribute(
      'href',
      '/categorias',
    );
  });

  it('403 na listagem mostra "Acesso não permitido para o seu perfil."', async () => {
    mockarApi({ lista: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
    renderizarApp('/categorias');
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
  });

  it('500 no cadastro mostra mensagem genérica, sem detalhes técnicos', async () => {
    mockarApi({ aoCriar: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }) });
    renderizarApp('/categorias');
    await screen.findByRole('table');

    const c = formularioCadastro();
    await usuario.type(c.nome, 'Agressões');
    await usuario.click(c.cadastrar);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(
      'Não foi possível cadastrar a categoria agora. Tente novamente em instantes.',
    );
    expect(alerta.textContent).not.toMatch(/500|interno/i);
  });

  it('duplo clique em "Cadastrar categoria" envia só um POST', async () => {
    let liberar;
    mockarApi({
      aoCriar: (corpo) =>
        new Promise((resolve) => {
          liberar = () => resolve(respostaFalsa(201, { id: 3, nome: corpo.nome, descricao: null }));
        }),
    });
    renderizarApp('/categorias');
    await screen.findByRole('table');

    const c = formularioCadastro();
    await usuario.type(c.nome, 'Evasão');
    await usuario.click(c.cadastrar);
    await usuario.click(screen.getByRole('button', { name: 'Cadastrando...' }));
    expect(chamadas('POST')).toHaveLength(1);

    liberar();
    expect(await screen.findByText('Categoria Evasão cadastrada com sucesso.')).toBeInTheDocument();
    expect(chamadas('POST')).toHaveLength(1);
  });

  it('o diálogo de edição não oferece exclusão (RN21)', async () => {
    mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
    const dialogo = await abrirEdicao('Conflitos');
    expect(
      within(dialogo).queryByRole('button', { name: /excluir|remover|apagar|inativar/i }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
  });

  it('nome só com espaços extras nas pontas conta como "sem alteração"', async () => {
    mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
    const dialogo = await abrirEdicao('Conflitos');

    await usuario.type(within(dialogo).getByLabelText('Nome'), '   ');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(within(dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
    expect(chamadas('PUT')).toHaveLength(0);
  });

  it('nome vazio na edição mostra erro no campo e não chama a API', async () => {
    mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
    const dialogo = await abrirEdicao('Conflitos');

    const nome = within(dialogo).getByLabelText('Nome');
    await usuario.clear(nome);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(within(dialogo).getByText('Informe o nome da categoria.')).toBeInTheDocument();
    expect(nome).toHaveAttribute('aria-invalid', 'true');
    expect(chamadas('PUT')).toHaveLength(0);
  });

  it('400 na edição mostra o texto do servidor e mantém o diálogo', async () => {
    mockarApi({
      aoAtualizar: () => respostaFalsa(400, { erro: 'A descrição deve ser um texto.' }),
    });
    const dialogo = await abrirEdicao('Indisciplina');

    await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'A descrição deve ser um texto.',
    );
    expect(screen.getByRole('dialog', { name: 'Editar categoria' })).toBeInTheDocument();
  });

  it('404 na edição mostra o aviso e recarrega a lista em segundo plano', async () => {
    mockarApi({ aoAtualizar: () => respostaFalsa(404, { erro: 'Categoria não encontrada.' }) });
    const dialogo = await abrirEdicao('Indisciplina');

    await usuario.type(within(dialogo).getByLabelText('Nome'), ' escolar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'Categoria não encontrada.',
    );
    await waitFor(() => expect(chamadas('GET')).toHaveLength(2));
  });

  it('sem conexão na edição mostra mensagem amigável e mantém o que foi digitado', async () => {
    mockarApi({
      aoAtualizar: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const dialogo = await abrirEdicao('Indisciplina');

    const nome = within(dialogo).getByLabelText('Nome');
    await usuario.type(nome, ' escolar');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
    expect(nome).toHaveValue('Indisciplina escolar');
    expect(chamadas('GET')).toHaveLength(1);
  });

  it('editar só a descrição envia o nome atual e a nova descrição (contrato { nome, descricao? })', async () => {
    mockarApi({
      aoAtualizar: (id, corpo) => respostaFalsa(200, { id, nome: corpo.nome, descricao: corpo.descricao }),
    });
    const dialogo = await abrirEdicao('Indisciplina');

    await usuario.type(
      within(dialogo).getByLabelText('Descrição (opcional)'),
      '  Descumprimento de regras.  ',
    );
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

    expect(await screen.findByText('Categoria Indisciplina atualizada com sucesso.')).toBeInTheDocument();
    const [[url, opcoes]] = chamadas('PUT');
    expect(url).toBe(`${URL_API}/categorias/1`);
    expect(JSON.parse(opcoes.body)).toEqual({
      nome: 'Indisciplina',
      descricao: 'Descumprimento de regras.',
    });
  });
});
