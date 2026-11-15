// Fluxos da Issue #87 — filtros e paginação na tela de Ocorrências (RF11, UC03,
// RN19, RN20, RNF01, RNF02): cada filtro vai para o GET /ocorrencias com o
// nome e o formato da #86 (vazios omitidos), "Filtrar" volta à página 1,
// "Limpar filtros", estudante por turma e depois por nome, profissional só
// para a Gestão, "Página X de Y" e total, filtros na URL preservados ao voltar
// do detalhe, mensagem de vazio com filtros, validação do período antes do
// envio, falha de uma lista de apoio sem remover os outros filtros e filtros
// recolhíveis.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../src/App.jsx';
import {
  contarFiltrosAtivos,
  dataValida,
  filtrosParaApi,
  lerBuscaOcorrencias,
  montarBuscaOcorrencias,
  periodoInvalido,
  textoTotalOcorrencias,
  totalDePaginas,
} from '../src/services/filtrosOcorrencias.js';
import { mensagemErroListaOcorrencias } from '../src/services/mensagensOcorrencias.js';
import { montarQueryListaOcorrencias } from '../src/services/ocorrencias.js';
import { podeFiltrarPorProfissional } from '../src/services/perfis.js';
import { gravarSessaoFicticia, paginaOcorrencias, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_VAZIO_FILTRO = 'Nenhuma ocorrência encontrada com esses filtros.';
const MSG_VAZIO = 'Nenhuma ocorrência para mostrar.';
const MSG_PERIODO = 'A data "De" não pode ser depois da data "Até". Corrija o período.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMAS = [
  { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 },
  { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 },
];
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const CATEGORIAS = [
  { id: 5, nome: 'Categoria Fictícia X', descricao: null },
  { id: 6, nome: 'Categoria Fictícia Y', descricao: null },
];
// Dados reduzidos (como recebe quem não é Gestão — RN20), fora de ordem de nome.
const ESTUDANTES_7B = [
  { id: 8, nomeCompleto: 'Estudante Fictício Zeta', turma: TURMAS[1] },
  { id: 7, nomeCompleto: 'Estudante Fictício Alfa', turma: TURMAS[1] },
];
const USUARIOS = [
  { id: 30, nome: 'Professor Fictício', email: 'prof@exemplo.test', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 31, nome: 'Técnica Fictícia', email: 'tec@exemplo.test', perfil: 'TECNICO_ADMINISTRATIVO', status: 'DESATIVADO' },
];

function item(id, extra = {}) {
  return {
    id,
    dataHora: '2026-10-30T12:39:00.000Z',
    local: `Local fictício ${id}`,
    status: 'ABERTO',
    turma: TURMAS[0],
    categoria: { id: 5, nome: 'Categoria Fictícia X' },
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    estudantes: [{ id: 7, nomeCompleto: 'Estudante Fictício Alfa' }],
    ...extra,
  };
}

function detalhe(id) {
  return {
    ...item(id),
    descricao: 'Descrição fictícia.',
    demaisEnvolvidos: null,
    testemunhas: null,
    providenciasImediatas: null,
    observacoes: null,
    dataEncerramento: null,
    responsavelAcompanhamento: null,
    estudantes: [{ id: 7, nomeCompleto: 'Estudante Fictício Alfa', turma: TURMAS[0] }],
    encaminhamentos: [],
    comunicacoes: [],
    providencias: [],
  };
}

/**
 * GET /ocorrencias[?...] chama `lista(params)` (URLSearchParams da query);
 * as listas de apoio respondem com os dados fictícios ou com a falha pedida.
 */
function mockarApi({
  lista = () => respostaFalsa(200, paginaOcorrencias([item(12), item(11)])),
  turmas = () => respostaFalsa(200, TURMAS),
  categorias = () => respostaFalsa(200, CATEGORIAS),
  usuarios = () => respostaFalsa(200, USUARIOS),
  estudantes = (turmaId) => respostaFalsa(200, turmaId === '2' ? ESTUDANTES_7B : []),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method !== 'GET') throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
    const endereco = new URL(url);
    const caminho = endereco.pathname;
    if (caminho === '/ocorrencias') return lista(endereco.searchParams);
    if (caminho === '/turmas') return turmas();
    if (caminho === '/categorias') return categorias();
    if (caminho === '/usuarios') return usuarios();
    if (caminho === '/estudantes') return estudantes(endereco.searchParams.get('turmaId'));
    const get = caminho.match(/^\/ocorrencias\/(\d+)$/);
    if (get) return respostaFalsa(200, detalhe(Number(get[1])));
    throw new Error(`Chamada inesperada: GET ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

/** Chamadas ao GET /ocorrencias (lista), como URLSearchParams. */
function chamadasLista() {
  return fetch.mock.calls
    .map(([url]) => new URL(url))
    .filter((u) => u.pathname === '/ocorrencias')
    .map((u) => u.searchParams);
}

function ultimaChamadaLista() {
  const chamadas = chamadasLista();
  return Object.fromEntries(chamadas[chamadas.length - 1]);
}

// Sondas só de teste: a URL atual e o "voltar" do navegador.
function Sondas() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Voltar (teste)
      </button>
    </>
  );
}

function renderizar(rota = '/ocorrencias') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
      <Sondas />
    </MemoryRouter>,
  );
}

const urlAtual = () => screen.getByTestId('url').textContent;

describe('Filtros e paginação da lista de ocorrências (#87)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Abre o painel (no jsdom começa recolhido, como no celular) e espera as listas de apoio. */
  async function abrirFiltros({ esperarTurmas = true } = {}) {
    await usuario.click(await screen.findByRole('button', { name: /^Mostrar filtros/ }));
    const form = screen.getByRole('form', { name: 'Filtrar ocorrências' });
    if (esperarTurmas) {
      await within(within(form).getByLabelText('Turma da ocorrência')).findByRole('option', {
        name: ROTULO_6A,
      });
    }
    return form;
  }

  describe('regras puras (services)', () => {
    it('a query da API omite filtros vazios e a página 1', () => {
      expect(montarQueryListaOcorrencias({})).toBe('');
      expect(montarQueryListaOcorrencias({ turmaId: '', status: null, pagina: 1 })).toBe('');
      expect(
        montarQueryListaOcorrencias({
          turmaId: '1',
          categoriaId: 5,
          status: 'EM_ACOMPANHAMENTO',
          estudanteId: '7',
          dataInicio: '2026-10-01',
          dataFim: '2026-10-31',
          profissionalResponsavelId: '30',
          pagina: 3,
        }),
      ).toBe(
        '?turmaId=1&categoriaId=5&status=EM_ACOMPANHAMENTO&estudanteId=7&dataInicio=2026-10-01' +
          '&dataFim=2026-10-31&profissionalResponsavelId=30&pagina=3',
      );
    });

    it('a URL da tela descarta valores inválidos e o profissional para quem não é Gestão', () => {
      const params = new URLSearchParams(
        'turmaId=01&categoriaId=5&status=aberto&estudanteId=7&dataInicio=2026-02-30' +
          '&dataFim=2026-10-31&profissionalResponsavelId=30&pagina=0',
      );
      const { filtros, pagina } = lerBuscaOcorrencias(params);
      expect(filtros).toMatchObject({
        turmaId: '',
        categoriaId: '5',
        status: '',
        estudanteId: '7',
        dataInicio: '',
        dataFim: '2026-10-31',
        profissionalResponsavelId: '',
      });
      expect(pagina).toBe(1);
      expect(
        lerBuscaOcorrencias(params, { permitirProfissional: true }).filtros.profissionalResponsavelId,
      ).toBe('30');
      // Período invertido na URL: descartado (a API recusaria com 400).
      const invertido = lerBuscaOcorrencias(new URLSearchParams('dataInicio=2026-10-31&dataFim=2026-10-01'));
      expect(invertido.filtros.dataInicio).toBe('');
      expect(invertido.filtros.dataFim).toBe('');
      expect(lerBuscaOcorrencias(new URLSearchParams('pagina=4')).pagina).toBe(4);
    });

    it('a turma do estudante fica na URL da tela, mas não vai para a API nem conta como filtro', () => {
      const filtros = { turmaEstudanteId: '2', estudanteId: '7', status: '' };
      expect(montarBuscaOcorrencias(filtros, 2).toString()).toBe('turmaEstudanteId=2&estudanteId=7&pagina=2');
      expect(filtrosParaApi(filtros)).toEqual({ estudanteId: '7' });
      expect(contarFiltrosAtivos(filtros)).toBe(1);
      expect(contarFiltrosAtivos({ turmaEstudanteId: '2' })).toBe(0);
    });

    it('datas, período, páginas e textos', () => {
      expect(dataValida('2028-02-29')).toBe(true);
      expect(dataValida('2026-02-29')).toBe(false);
      expect(dataValida('2026-13-01')).toBe(false);
      expect(dataValida('30/10/2026')).toBe(false);
      expect(periodoInvalido({ dataInicio: '2026-10-02', dataFim: '2026-10-01' })).toBe(true);
      expect(periodoInvalido({ dataInicio: '2026-10-01', dataFim: '2026-10-01' })).toBe(false);
      expect(periodoInvalido({ dataInicio: '2026-10-01', dataFim: '' })).toBe(false);
      expect(totalDePaginas(0, 20)).toBe(1);
      expect(totalDePaginas(20, 20)).toBe(1);
      expect(totalDePaginas(45, 20)).toBe(3);
      expect(textoTotalOcorrencias(1)).toBe('1 ocorrência encontrada');
      expect(textoTotalOcorrencias(45)).toBe('45 ocorrências encontradas');
      expect(podeFiltrarPorProfissional('GESTAO')).toBe(true);
      for (const perfil of ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO', undefined]) {
        expect(podeFiltrarPorProfissional(perfil)).toBe(false);
      }
      expect(mensagemErroListaOcorrencias({ status: 400 })).toBe(
        'Não foi possível aplicar os filtros. Confira os valores escolhidos e tente novamente.',
      );
    });
  });

  describe('filtros recolhíveis (RNF01)', () => {
    it('começam recolhidos no celular; o botão mostra e oculta, com aria-expanded', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const alternar = await screen.findByRole('button', { name: 'Mostrar filtros' });
      expect(alternar).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('form', { name: 'Filtrar ocorrências' })).not.toBeInTheDocument();

      await usuario.click(alternar);
      expect(screen.getByRole('button', { name: 'Ocultar filtros' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('form', { name: 'Filtrar ocorrências' })).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Ocultar filtros' }));
      expect(screen.queryByRole('form', { name: 'Filtrar ocorrências' })).not.toBeInTheDocument();
    });

    it('em tela larga começam abertos', async () => {
      vi.stubGlobal('matchMedia', (consulta) => ({ matches: true, media: consulta }));
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      expect(await screen.findByRole('form', { name: 'Filtrar ocorrências' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ocultar filtros' })).toBeInTheDocument();
    });

    it('com filtros na URL, o botão recolhido mostra quantos estão aplicados', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar('/ocorrencias?status=ABERTO&categoriaId=5');
      expect(await screen.findByRole('button', { name: 'Mostrar filtros (2 aplicados)' })).toBeInTheDocument();
    });
  });

  describe('cada filtro vai para a API', () => {
    it('todos os campos com rótulo; status com rótulo amigável e valor técnico', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      for (const rotulo of ['Turma da ocorrência', 'Categoria', 'Status', 'Turma do estudante', 'Nome do estudante', 'De', 'Até']) {
        expect(within(form).getByLabelText(rotulo)).toBeInTheDocument();
      }
      const status = within(form).getByLabelText('Status');
      expect(within(status).getAllByRole('option').map((o) => [o.textContent, o.value])).toEqual([
        ['Todos os status', ''],
        ['Aberto', 'ABERTO'],
        ['Em acompanhamento', 'EM_ACOMPANHAMENTO'],
        ['Encerrado', 'ENCERRADO'],
      ]);
      expect(within(form).getByLabelText('De')).toHaveAttribute('type', 'date');
    });

    it('turma, categoria, status e período: query com os nomes da #86, ids inteiros e datas AAAA-MM-DD', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();

      await usuario.selectOptions(within(form).getByLabelText('Turma da ocorrência'), ROTULO_7B);
      await usuario.selectOptions(within(form).getByLabelText('Categoria'), 'Categoria Fictícia Y');
      await usuario.selectOptions(within(form).getByLabelText('Status'), 'Em acompanhamento');
      await usuario.type(within(form).getByLabelText('De'), '2026-10-01');
      await usuario.type(within(form).getByLabelText('Até'), '2026-10-31');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));

      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({
        turmaId: '2',
        categoriaId: '6',
        status: 'EM_ACOMPANHAMENTO',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      expect(urlAtual()).toBe(
        '/ocorrencias?turmaId=2&categoriaId=6&status=EM_ACOMPANHAMENTO&dataInicio=2026-10-01&dataFim=2026-10-31',
      );
    });

    it('só uma ponta do período: a outra fica fora da query (vazio seria 400)', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      await usuario.type(within(form).getByLabelText('Até'), '2026-10-31');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ dataFim: '2026-10-31' });
    });

    it('a lista mostra o que a API devolveu para o filtro', async () => {
      sessao('PROFESSOR');
      mockarApi({
        lista: (params) =>
          respostaFalsa(
            200,
            params.get('status') === 'ENCERRADO'
              ? paginaOcorrencias([item(3, { status: 'ENCERRADO' })])
              : paginaOcorrencias([item(12), item(11)]),
          ),
      });
      renderizar();
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      const form = await abrirFiltros();
      await usuario.selectOptions(within(form).getByLabelText('Status'), 'Encerrado');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));

      expect(await screen.findByRole('link', { name: 'Ocorrência nº 3' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Ocorrência nº 12' })).not.toBeInTheDocument();
      expect(screen.getByText('1 ocorrência encontrada')).toBeInTheDocument();
    });

    it('"Limpar filtros" volta à lista completa, sem parâmetros', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar('/ocorrencias?status=ABERTO&turmaId=1&pagina=2');
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      expect(Object.fromEntries(chamadasLista()[0])).toEqual({ turmaId: '1', status: 'ABERTO', pagina: '2' });

      const form = await abrirFiltros();
      expect(within(form).getByLabelText('Status')).toHaveValue('ABERTO');
      await usuario.click(within(form).getByRole('button', { name: 'Limpar filtros' }));

      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({});
      expect(urlAtual()).toBe('/ocorrencias');
      expect(within(form).getByLabelText('Status')).toHaveValue('');
      expect(within(form).getByLabelText('Turma da ocorrência')).toHaveValue('');
    });

    it('400 da API (filtro recusado): mensagem simples, sem o texto técnico', async () => {
      sessao('PROFESSOR');
      mockarApi({
        lista: () => respostaFalsa(400, { erro: 'O filtro turmaId deve ser um número inteiro positivo.' }),
      });
      renderizar();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível aplicar os filtros. Confira os valores escolhidos e tente novamente.',
      );
      expect(screen.queryByText(/turmaId/)).not.toBeInTheDocument();
    });
  });

  describe('estudante: por turma e depois por nome', () => {
    it('o nome só fica disponível depois da turma; lista da turma em ordem de nome; envia estudanteId', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      const nome = within(form).getByLabelText('Nome do estudante');
      expect(nome).toBeDisabled();
      expect(within(form).getByText('Escolha primeiro a turma do estudante.')).toBeInTheDocument();

      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
      await within(form).findByRole('option', { name: 'Estudante Fictício Alfa' });
      expect(nome).toBeEnabled();
      expect(within(nome).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Todos os estudantes',
        'Estudante Fictício Alfa',
        'Estudante Fictício Zeta',
      ]);
      expect(fetch).toHaveBeenCalledWith(`${URL_API}/estudantes?turmaId=2`, expect.anything());

      await usuario.selectOptions(nome, 'Estudante Fictício Zeta');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      // A turma do estudante é só auxiliar: não vira filtro de turma da ocorrência.
      expect(ultimaChamadaLista()).toEqual({ estudanteId: '8' });
      expect(urlAtual()).toBe('/ocorrencias?turmaEstudanteId=2&estudanteId=8');
    });

    it('a turma do estudante é independente da turma da ocorrência', async () => {
      sessao('TUTOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      await usuario.selectOptions(within(form).getByLabelText('Turma da ocorrência'), ROTULO_6A);
      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
      await within(form).findByRole('option', { name: 'Estudante Fictício Alfa' });
      await usuario.selectOptions(within(form).getByLabelText('Nome do estudante'), 'Estudante Fictício Alfa');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ turmaId: '1', estudanteId: '7' });
    });

    it('trocar a turma do estudante desfaz a escolha do estudante', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
      await within(form).findByRole('option', { name: 'Estudante Fictício Alfa' });
      await usuario.selectOptions(within(form).getByLabelText('Nome do estudante'), 'Estudante Fictício Alfa');
      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_6A);
      expect(within(form).getByLabelText('Nome do estudante')).toHaveValue('');
      expect(await within(form).findByText('Nenhum estudante nesta turma.')).toBeInTheDocument();
    });

    it('falha ao carregar os estudantes: aviso no campo, os outros filtros continuam', async () => {
      sessao('PROFESSOR');
      mockarApi({ estudantes: () => respostaFalsa(500) });
      renderizar();
      const form = await abrirFiltros();
      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
      expect(
        await within(form).findByText(/Não foi possível carregar os estudantes desta turma/),
      ).toBeInTheDocument();
      await usuario.selectOptions(within(form).getByLabelText('Status'), 'Aberto');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ status: 'ABERTO' });
    });
  });

  describe('profissional responsável só para a Gestão', () => {
    it('Gestão vê o filtro com a lista de GET /usuarios e o envia como profissionalResponsavelId', async () => {
      sessao('GESTAO');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      const campo = within(form).getByLabelText('Profissional responsável (quem registrou)');
      await within(campo).findByRole('option', { name: 'Técnica Fictícia (Técnico-administrativo)' });
      expect(within(campo).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Todos os profissionais',
        'Professor Fictício (Professor)',
        'Técnica Fictícia (Técnico-administrativo)',
      ]);
      await usuario.selectOptions(campo, 'Professor Fictício (Professor)');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ profissionalResponsavelId: '30' });
    });

    for (const perfil of ['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO']) {
      it(`${perfil}: o filtro não aparece e GET /usuarios não é chamado`, async () => {
        sessao(perfil);
        mockarApi();
        renderizar();
        const form = await abrirFiltros();
        expect(within(form).queryByLabelText(/Profissional responsável/)).not.toBeInTheDocument();
        await screen.findByRole('link', { name: 'Ocorrência nº 12' });
        expect(fetch.mock.calls.some(([url]) => new URL(url).pathname === '/usuarios')).toBe(false);
      });
    }

    it('profissional na URL de quem não é Gestão é descartado (não vai para a API)', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar('/ocorrencias?profissionalResponsavelId=30&status=ABERTO');
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      expect(Object.fromEntries(chamadasLista()[0])).toEqual({ status: 'ABERTO' });
    });
  });

  describe('paginação', () => {
    const vinte = (inicio) => Array.from({ length: 20 }, (_, i) => item(inicio - i));

    it('"Página X de Y", total, "Anterior"/"Próxima" e os filtros mantidos na troca de página', async () => {
      sessao('PROFESSOR');
      mockarApi({
        lista: (params) => {
          const pagina = Number(params.get('pagina') ?? 1);
          const itens = pagina === 3 ? [item(5), item(4), item(3), item(2), item(1)] : vinte(100 - (pagina - 1) * 20);
          return respostaFalsa(200, paginaOcorrencias(itens, { total: 45, pagina }));
        },
      });
      renderizar('/ocorrencias?status=ABERTO');

      await screen.findByRole('link', { name: 'Ocorrência nº 100' });
      const nav = screen.getByRole('navigation', { name: 'Páginas da lista de ocorrências' });
      expect(within(nav).getByText('Página 1 de 3')).toBeInTheDocument();
      expect(screen.getByText('45 ocorrências encontradas')).toBeInTheDocument();
      expect(within(nav).getByRole('button', { name: 'Anterior' })).toBeDisabled();

      await usuario.click(within(nav).getByRole('button', { name: 'Próxima' }));
      expect(await screen.findByRole('link', { name: 'Ocorrência nº 80' })).toBeInTheDocument();
      expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
      expect(ultimaChamadaLista()).toEqual({ status: 'ABERTO', pagina: '2' });
      expect(urlAtual()).toBe('/ocorrencias?status=ABERTO&pagina=2');
      // Foco no resumo do resultado depois de trocar de página.
      expect(screen.getByText('45 ocorrências encontradas')).toHaveFocus();

      await usuario.click(screen.getByRole('button', { name: 'Próxima' }));
      expect(await screen.findByRole('link', { name: 'Ocorrência nº 5' })).toBeInTheDocument();
      expect(screen.getByText('Página 3 de 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();

      await usuario.click(screen.getByRole('button', { name: 'Anterior' }));
      expect(await screen.findByRole('link', { name: 'Ocorrência nº 80' })).toBeInTheDocument();
      expect(ultimaChamadaLista()).toEqual({ status: 'ABERTO', pagina: '2' });
    });

    it('"Filtrar" volta para a página 1', async () => {
      sessao('PROFESSOR');
      mockarApi({
        lista: (params) =>
          respostaFalsa(200, paginaOcorrencias(vinte(100), { total: 45, pagina: Number(params.get('pagina') ?? 1) })),
      });
      renderizar('/ocorrencias?status=ABERTO&pagina=3');
      await screen.findByText('Página 3 de 3');

      const form = await abrirFiltros();
      await usuario.selectOptions(within(form).getByLabelText('Categoria'), 'Categoria Fictícia X');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(ultimaChamadaLista()).toEqual({ categoriaId: '5', status: 'ABERTO' }));
      expect(urlAtual()).toBe('/ocorrencias?categoriaId=5&status=ABERTO');
      expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument();
    });

    it('uma página só: "Página 1 de 1" com os dois botões desativados', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
      expect(screen.getByText('2 ocorrências encontradas')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    });
  });

  describe('filtros preservados ao voltar do detalhe', () => {
    it('"Voltar para a lista" leva de volta à mesma busca e página', async () => {
      sessao('PROFESSOR');
      mockarApi({
        lista: (params) =>
          respostaFalsa(200, paginaOcorrencias([item(12)], { total: 25, pagina: Number(params.get('pagina') ?? 1) })),
      });
      renderizar('/ocorrencias?status=ABERTO&pagina=2');
      await usuario.click(await screen.findByRole('link', { name: 'Ocorrência nº 12' }));
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });

      const voltar = screen.getByRole('link', { name: 'Voltar para a lista' });
      expect(voltar).toHaveAttribute('href', '/ocorrencias?status=ABERTO&pagina=2');
      await usuario.click(voltar);
      expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
      expect(urlAtual()).toBe('/ocorrencias?status=ABERTO&pagina=2');
      expect(ultimaChamadaLista()).toEqual({ status: 'ABERTO', pagina: '2' });
      await usuario.click(screen.getByRole('button', { name: /^Mostrar filtros/ }));
      expect(screen.getByLabelText('Status')).toHaveValue('ABERTO');
    });

    it('o "voltar" do navegador também preserva a busca', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar('/ocorrencias?categoriaId=5');
      await usuario.click(await screen.findByRole('link', { name: 'Ocorrência nº 11' }));
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 11' });
      await usuario.click(screen.getByRole('button', { name: 'Voltar (teste)' }));
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      expect(urlAtual()).toBe('/ocorrencias?categoriaId=5');
      expect(ultimaChamadaLista()).toEqual({ categoriaId: '5' });
    });

    it('detalhe aberto direto (sem busca) volta para /ocorrencias', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar('/ocorrencias/12');
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });
      expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toHaveAttribute('href', '/ocorrencias');
    });
  });

  describe('resultado vazio e validação do período', () => {
    it('com filtros e nada encontrado: mensagem própria; sem filtros, a mensagem de sempre', async () => {
      sessao('PROFESSOR');
      mockarApi({ lista: () => respostaFalsa(200, paginaOcorrencias([])) });
      const { unmount } = renderizar('/ocorrencias?status=ENCERRADO');
      expect(await screen.findByText(MSG_VAZIO_FILTRO)).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Páginas da lista de ocorrências' })).not.toBeInTheDocument();
      unmount();

      renderizar('/ocorrencias');
      expect(await screen.findByText(MSG_VAZIO)).toBeInTheDocument();
      expect(screen.queryByText(MSG_VAZIO_FILTRO)).not.toBeInTheDocument();
    });

    it('"De" depois de "Até" é recusado antes do envio, com aviso nos campos', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      const de = within(form).getByLabelText('De');
      const ate = within(form).getByLabelText('Até');
      await usuario.type(de, '2026-10-31');
      await usuario.type(ate, '2026-10-01');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));

      expect(within(form).getByRole('alert')).toHaveTextContent(MSG_PERIODO);
      expect(de).toHaveAttribute('aria-invalid', 'true');
      expect(ate).toHaveAttribute('aria-invalid', 'true');
      expect(de).toHaveAccessibleDescription(MSG_PERIODO);
      expect(de).toHaveFocus();
      expect(chamadasLista()).toHaveLength(1);
      expect(urlAtual()).toBe('/ocorrencias');

      // Corrigido o período, o aviso some e a busca sai.
      await usuario.clear(ate);
      await usuario.type(ate, '2026-11-05');
      expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ dataInicio: '2026-10-31', dataFim: '2026-11-05' });
    });

    it('mesma data em "De" e "Até" é aceita', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizar();
      const form = await abrirFiltros();
      await usuario.type(within(form).getByLabelText('De'), '2026-10-15');
      await usuario.type(within(form).getByLabelText('Até'), '2026-10-15');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('falha de uma lista de apoio (Promise.allSettled)', () => {
    it('turmas falham: aviso nos campos de turma; categoria, status, período e profissional continuam', async () => {
      sessao('GESTAO');
      mockarApi({ turmas: () => respostaFalsa(500) });
      renderizar();
      const form = await abrirFiltros({ esperarTurmas: false });
      const turma = within(form).getByLabelText('Turma da ocorrência');
      await waitFor(() =>
        expect(turma).toHaveAccessibleDescription(
          'Não foi possível carregar as turmas. Os outros filtros continuam disponíveis.',
        ),
      );
      await within(form).findByRole('option', { name: 'Categoria Fictícia Y' });
      await within(form).findByRole('option', { name: 'Professor Fictício (Professor)' });
      expect(within(form).getByLabelText('Status')).toBeInTheDocument();
      expect(within(form).getByLabelText('De')).toBeInTheDocument();

      await usuario.selectOptions(within(form).getByLabelText('Categoria'), 'Categoria Fictícia Y');
      await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
      await waitFor(() => expect(chamadasLista()).toHaveLength(2));
      expect(ultimaChamadaLista()).toEqual({ categoriaId: '6' });
    });

    it('categorias e usuários falham (sem conexão): turmas, estudantes e status continuam', async () => {
      sessao('GESTAO');
      mockarApi({
        categorias: () => Promise.reject(new TypeError('Failed to fetch')),
        usuarios: () => respostaFalsa(500),
      });
      renderizar();
      const form = await abrirFiltros();
      expect(
        await within(form).findByText(/Não foi possível carregar as categorias/),
      ).toBeInTheDocument();
      expect(within(form).getByText(/Não foi possível carregar os profissionais/)).toBeInTheDocument();
      // O filtro de profissional continua na tela da Gestão, só sem opções.
      expect(within(form).getByLabelText('Profissional responsável (quem registrou)')).toBeInTheDocument();
      await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
      await within(form).findByRole('option', { name: 'Estudante Fictício Alfa' });
      // A lista de ocorrências carrega normalmente.
      expect(await screen.findByRole('link', { name: 'Ocorrência nº 12' })).toBeInTheDocument();
    });

    it('filtro da URL cuja lista não carregou continua indicado no campo', async () => {
      sessao('PROFESSOR');
      mockarApi({ categorias: () => respostaFalsa(500) });
      renderizar('/ocorrencias?categoriaId=6');
      const form = await abrirFiltros();
      await within(form).findByText(/Não foi possível carregar as categorias/);
      const categoria = within(form).getByLabelText('Categoria');
      expect(categoria).toHaveValue('6');
      expect(within(categoria).getByRole('option', { selected: true })).toHaveTextContent('Categoria escolhida');
    });
  });
});
