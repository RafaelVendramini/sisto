// Testes complementares do QA para a Issue #87 (filtros e paginação na tela de
// Ocorrências). Cobrem lacunas dos testes do dev: estudante restaurado da URL
// (voltar do detalhe), respostas fora de ordem (lista e estudantes), erro da
// lista com filtros e "Tentar novamente", "Filtrar"/"Limpar" sem mudança de
// URL, edição não aplicada na troca de página, página além da última e
// profissional aplicado pela URL para a Gestão.
// API mockada no formato exato da #86 ({ itens, total, pagina, tamanhoPagina }).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../src/App.jsx';
import { gravarSessaoFicticia, paginaOcorrencias, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_VAZIO = 'Nenhuma ocorrência para mostrar.';
const MSG_GENERICA = 'Não foi possível carregar as ocorrências agora.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMAS = [
  { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 },
  { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 },
];
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const CATEGORIAS = [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }];
const ESTUDANTES = {
  1: [{ id: 20, nomeCompleto: 'Estudante Fictício Beta', turma: TURMAS[0] }],
  2: [
    { id: 8, nomeCompleto: 'Estudante Fictício Zeta', turma: TURMAS[1] },
    { id: 7, nomeCompleto: 'Estudante Fictício Alfa', turma: TURMAS[1] },
  ],
};
const USUARIOS = [
  { id: 30, nome: 'Professor Fictício', email: 'prof@exemplo.test', perfil: 'PROFESSOR', status: 'ATIVO' },
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

function adiado() {
  let resolver;
  const promessa = new Promise((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

function mockarApi({
  lista = () => respostaFalsa(200, paginaOcorrencias([item(12), item(11)])),
  estudantes = (turmaId) => respostaFalsa(200, ESTUDANTES[turmaId] ?? []),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method !== 'GET') throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
    const endereco = new URL(url);
    const caminho = endereco.pathname;
    if (caminho === '/ocorrencias') return lista(endereco.searchParams);
    if (caminho === '/turmas') return respostaFalsa(200, TURMAS);
    if (caminho === '/categorias') return respostaFalsa(200, CATEGORIAS);
    if (caminho === '/usuarios') return respostaFalsa(200, USUARIOS);
    if (caminho === '/estudantes') return estudantes(endereco.searchParams.get('turmaId'));
    throw new Error(`Chamada inesperada: GET ${url}`);
  });
}

function sessao(perfil) {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

function chamadasLista() {
  return fetch.mock.calls
    .map(([url]) => new URL(url))
    .filter((u) => u.pathname === '/ocorrencias')
    .map((u) => Object.fromEntries(u.searchParams));
}

function ultimaChamadaLista() {
  const chamadas = chamadasLista();
  return chamadas[chamadas.length - 1];
}

function SondaUrl() {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

function renderizar(rota = '/ocorrencias') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
      <SondaUrl />
    </MemoryRouter>,
  );
}

const urlAtual = () => screen.getByTestId('url').textContent;

describe('Filtros e paginação de ocorrências — complementar QA (#87)', () => {
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

  async function abrirFiltros() {
    await usuario.click(await screen.findByRole('button', { name: /^Mostrar filtros/ }));
    const form = screen.getByRole('form', { name: 'Filtrar ocorrências' });
    await within(within(form).getByLabelText('Turma da ocorrência')).findByRole('option', {
      name: ROTULO_6A,
    });
    return form;
  }

  it('estudante vindo da URL (voltar do detalhe): turma e nome restaurados, só estudanteId vai para a API', async () => {
    sessao('PROFESSOR');
    mockarApi();
    renderizar('/ocorrencias?turmaEstudanteId=2&estudanteId=8');
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    expect(chamadasLista()[0]).toEqual({ estudanteId: '8' });
    // Um filtro aplicado (a turma auxiliar não conta).
    expect(screen.getByRole('button', { name: 'Mostrar filtros (1 aplicado)' })).toBeInTheDocument();

    const form = await abrirFiltros();
    expect(within(form).getByLabelText('Turma do estudante')).toHaveValue('2');
    const nome = within(form).getByLabelText('Nome do estudante');
    await within(nome).findByRole('option', { name: 'Estudante Fictício Zeta' });
    expect(nome).toBeEnabled();
    expect(nome).toHaveValue('8');
    expect(within(nome).getByRole('option', { selected: true })).toHaveTextContent(
      'Estudante Fictício Zeta',
    );
  });

  it('estudante na URL sem a turma auxiliar: continua aplicado e indicado no campo', async () => {
    sessao('PROFESSOR');
    mockarApi();
    renderizar('/ocorrencias?estudanteId=7');
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    expect(chamadasLista()[0]).toEqual({ estudanteId: '7' });
    const form = await abrirFiltros();
    const nome = within(form).getByLabelText('Nome do estudante');
    expect(nome).toBeEnabled();
    expect(nome).toHaveValue('7');
    expect(within(nome).getByRole('option', { selected: true })).toHaveTextContent('Estudante escolhido');
  });

  it('só a turma do estudante escolhida (sem nome): nenhum filtro vai para a API e o vazio é o padrão', async () => {
    sessao('PROFESSOR');
    mockarApi({
      lista: (params) =>
        respostaFalsa(200, paginaOcorrencias(params.toString() ? [item(1)] : [])),
    });
    renderizar();
    const form = await abrirFiltros();
    await screen.findByText(MSG_VAZIO);
    await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
    await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => expect(chamadasLista()).toHaveLength(2));
    expect(ultimaChamadaLista()).toEqual({});
    expect(urlAtual()).toBe('/ocorrencias?turmaEstudanteId=2');
    expect(await screen.findByText(MSG_VAZIO)).toBeInTheDocument();
  });

  it('resposta antiga da lista que chega depois da nova é descartada', async () => {
    sessao('PROFESSOR');
    const lenta = adiado();
    mockarApi({
      lista: (params) =>
        params.get('status') === 'ABERTO'
          ? lenta.promessa
          : respostaFalsa(200, paginaOcorrencias([item(12), item(11)])),
    });
    renderizar('/ocorrencias?status=ABERTO');
    const form = await abrirFiltros();
    await usuario.click(within(form).getByRole('button', { name: 'Limpar filtros' }));
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });

    lenta.resolver(respostaFalsa(200, paginaOcorrencias([item(99)], { total: 1 })));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Ocorrência nº 99' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ocorrência nº 12' })).toBeInTheDocument();
    expect(screen.getByText('2 ocorrências encontradas')).toBeInTheDocument();
  });

  it('troca rápida da turma do estudante: a lista que chega atrasada não substitui a atual', async () => {
    sessao('PROFESSOR');
    const lenta = adiado();
    mockarApi({
      estudantes: (turmaId) =>
        turmaId === '2' ? lenta.promessa : respostaFalsa(200, ESTUDANTES[turmaId] ?? []),
    });
    renderizar();
    const form = await abrirFiltros();
    await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_7B);
    await usuario.selectOptions(within(form).getByLabelText('Turma do estudante'), ROTULO_6A);
    await within(form).findByRole('option', { name: 'Estudante Fictício Beta' });

    lenta.resolver(respostaFalsa(200, ESTUDANTES[2]));
    await new Promise((r) => setTimeout(r, 50));
    const nome = within(form).getByLabelText('Nome do estudante');
    expect(within(nome).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Todos os estudantes',
      'Estudante Fictício Beta',
    ]);
  });

  it('erro 500 da lista com filtros: mensagem genérica, sem paginação/total; "Tentar novamente" repete a mesma busca', async () => {
    sessao('PROFESSOR');
    let falhar = true;
    mockarApi({
      lista: () =>
        falhar
          ? respostaFalsa(500, { erro: 'Erro interno.' })
          : respostaFalsa(200, paginaOcorrencias([item(12)], { total: 25 })),
    });
    renderizar('/ocorrencias?status=ABERTO&categoriaId=5');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(MSG_GENERICA);
    expect(screen.queryByRole('navigation', { name: 'Páginas da lista de ocorrências' })).not.toBeInTheDocument();
    expect(screen.queryByText(/ocorrências? encontradas?/)).not.toBeInTheDocument();
    // Os filtros continuam na tela.
    expect(screen.getByRole('button', { name: 'Mostrar filtros (2 aplicados)' })).toBeInTheDocument();

    falhar = false;
    await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(ultimaChamadaLista()).toEqual({ categoriaId: '5', status: 'ABERTO' });
    expect(screen.getByText('25 ocorrências encontradas')).toBeInTheDocument();
  });

  it('erro 403 da lista: mensagem de acesso não permitido', async () => {
    sessao('TUTOR');
    mockarApi({ lista: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
    renderizar('/ocorrencias?status=ABERTO');
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
  });

  it('"Filtrar" sem mudar nada e "Limpar filtros" sem filtros consultam a API de novo', async () => {
    sessao('PROFESSOR');
    mockarApi();
    renderizar();
    const form = await abrirFiltros();
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    expect(chamadasLista()).toHaveLength(1);

    await usuario.click(within(form).getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => expect(chamadasLista()).toHaveLength(2));
    await usuario.click(within(form).getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(chamadasLista()).toHaveLength(3));
    expect(chamadasLista().every((c) => Object.keys(c).length === 0)).toBe(true);
    expect(urlAtual()).toBe('/ocorrencias');
  });

  it('campo alterado sem "Filtrar" não vale na troca de página e o formulário volta ao aplicado', async () => {
    sessao('PROFESSOR');
    mockarApi({
      lista: (params) => {
        const pagina = Number(params.get('pagina') ?? 1);
        const itens = Array.from({ length: 20 }, (_, i) => item(100 - (pagina - 1) * 20 - i));
        return respostaFalsa(200, paginaOcorrencias(itens, { total: 40, pagina }));
      },
    });
    renderizar('/ocorrencias?status=ABERTO');
    const form = await abrirFiltros();
    await screen.findByText('Página 1 de 2');
    await usuario.selectOptions(within(form).getByLabelText('Status'), 'Encerrado');
    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));

    await screen.findByText('Página 2 de 2');
    expect(ultimaChamadaLista()).toEqual({ status: 'ABERTO', pagina: '2' });
    expect(urlAtual()).toBe('/ocorrencias?status=ABERTO&pagina=2');
    expect(within(form).getByLabelText('Status')).toHaveValue('ABERTO');
  });

  it('total exatamente 20 dá uma página; 21 dá duas', async () => {
    sessao('PROFESSOR');
    let total = 20;
    mockarApi({
      lista: () =>
        respostaFalsa(200, paginaOcorrencias(Array.from({ length: 20 }, (_, i) => item(50 - i)), { total })),
    });
    const { unmount } = renderizar();
    expect(await screen.findByText('Página 1 de 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    unmount();

    total = 21;
    renderizar();
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled();
  });

  it('página além da última (URL editada): API devolve itens vazios e "Anterior" leva à última página', async () => {
    sessao('PROFESSOR');
    mockarApi({
      lista: (params) => {
        const pagina = Number(params.get('pagina') ?? 1);
        const itens = pagina <= 3 ? [item(pagina)] : [];
        return respostaFalsa(200, paginaOcorrencias(itens, { total: 45, pagina }));
      },
    });
    renderizar('/ocorrencias?pagina=5');
    const nav = await screen.findByRole('navigation', { name: 'Páginas da lista de ocorrências' });
    expect(chamadasLista()[0]).toEqual({ pagina: '5' });
    expect(within(nav).getByRole('button', { name: 'Próxima' })).toBeDisabled();
    await usuario.click(within(nav).getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('link', { name: 'Ocorrência nº 3' })).toBeInTheDocument();
    expect(ultimaChamadaLista()).toEqual({ pagina: '3' });
    expect(screen.getByText('Página 3 de 3')).toBeInTheDocument();
  });

  it('Gestão: profissional na URL é aplicado, aparece selecionado e "Limpar filtros" o remove', async () => {
    sessao('GESTAO');
    mockarApi();
    renderizar('/ocorrencias?profissionalResponsavelId=30');
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    expect(chamadasLista()[0]).toEqual({ profissionalResponsavelId: '30' });
    const form = await abrirFiltros();
    const campo = within(form).getByLabelText('Profissional responsável (quem registrou)');
    await within(campo).findByRole('option', { name: 'Professor Fictício (Professor)' });
    expect(campo).toHaveValue('30');

    await usuario.click(within(form).getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(chamadasLista()).toHaveLength(2));
    expect(ultimaChamadaLista()).toEqual({});
    expect(campo).toHaveValue('');
  });

  it('Pedagógico com profissional na URL: o campo não aparece e o filtro é descartado (RN19 é do back-end)', async () => {
    sessao('PEDAGOGICO');
    mockarApi();
    renderizar('/ocorrencias?profissionalResponsavelId=30');
    await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    expect(chamadasLista()[0]).toEqual({});
    expect(screen.getByRole('button', { name: 'Mostrar filtros' })).toBeInTheDocument();
    const form = await abrirFiltros();
    expect(within(form).queryByLabelText(/Profissional responsável/)).not.toBeInTheDocument();
  });
});
