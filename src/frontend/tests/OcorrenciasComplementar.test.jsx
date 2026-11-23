// Testes complementares da Issue #48 (QA) — lista e detalhe de ocorrências,
// somente leitura (UC03, RF05, RN17, RN19, RN20, RNF01, RNF02): status em
// acompanhamento/encerrado, vários encaminhamentos, estudante de outra turma,
// ordem da API, troca de detalhe sem misturar dados nem a faixa, corrida de
// respostas, ida e volta lista/detalhe, links acessíveis, quebras de linha,
// textos com HTML exibidos como texto, ids estranhos na URL (400), menu,
// StrictMode (como no main.jsx) e o registro (#46) ponta a ponta até o detalhe.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../src/App.jsx';
import { gravarSessaoFicticia, paginaOcorrencias, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_8C = { id: 3, nome: '8º C', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_8C = '8º C — Ensino Fundamental - Anos Finais (2026)';

function itemLista(id, extra = {}) {
  return {
    id,
    dataHora: '2026-10-20T13:00:00.000Z',
    local: 'Pátio',
    status: 'ABERTO',
    turma: TURMA_6A,
    categoria: { id: 5, nome: 'Categoria Fictícia X' },
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A' }],
    ...extra,
  };
}

function detalhe(id, extra = {}) {
  return {
    id,
    dataHora: '2026-10-20T13:00:00.000Z',
    local: `Local fictício ${id}`,
    turma: TURMA_6A,
    categoria: { id: 5, nome: 'Categoria Fictícia X' },
    descricao: `Descrição fictícia da ocorrência ${id}.`,
    demaisEnvolvidos: null,
    testemunhas: null,
    providenciasImediatas: null,
    observacoes: null,
    status: 'ABERTO',
    dataEncerramento: null,
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    responsavelAcompanhamento: null,
    estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
    encaminhamentos: [],
    comunicacoes: [],
    providencias: [],
    ...extra,
  };
}

/** GET /ocorrencias chama `lista()`; GET /ocorrencias/{id} chama `obter(id)` (id como veio na URL). */
function mockarApi({
  lista = () => respostaFalsa(200, paginaOcorrencias([itemLista(12), itemLista(11)])),
  obter = (id) => respostaFalsa(200, detalhe(Number(id))),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/ocorrencias`) return lista();
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (opcoes.method === 'GET' && get) return obter(decodeURIComponent(get[1]));
    // #85: o detalhe também busca o histórico (lista vazia aqui).
    if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return respostaFalsa(200, []);
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

function valorDe(conteiner, rotulo) {
  return within(conteiner).getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

function chamadasGet(caminho) {
  return fetch.mock.calls.filter(([url]) => url === `${URL_API}${caminho}`);
}

/** Promessa controlada pelo teste. */
function adiada() {
  let resolver;
  const promessa = new Promise((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

// Sondas só de teste: navegar para outra rota (com ou sem state) e ver o state.
function Sondas() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate('/ocorrencias/11')}>
        Ir para 11 (teste)
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Voltar (teste)
      </button>
      <output data-testid="estado-navegacao">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function renderizarComSondas(entradas, { estrito = false } = {}) {
  const arvore = (
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      <App />
      <Sondas />
    </MemoryRouter>
  );
  return render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
}

describe('Lista e detalhe de ocorrências — complementar (#48)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar o fetch (nenhum GET pendente sai pela rede real).
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('status, acompanhamento e encerramento (RF05, RN17)', () => {
    it('EM_ACOMPANHAMENTO: "Em acompanhamento" com o responsável, sem data de encerramento', async () => {
      sessao('PEDAGOGICO');
      mockarApi({
        obter: (id) =>
          respostaFalsa(
            200,
            detalhe(Number(id), {
              status: 'EM_ACOMPANHAMENTO',
              responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
            }),
          ),
      });
      renderizarApp('/ocorrencias/12');

      const dados = await screen.findByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Status')).toHaveTextContent('Em acompanhamento');
      expect(valorDe(dados, 'Responsável pelo acompanhamento')).toHaveTextContent(
        'Pedagoga Fictícia',
      );
      expect(within(dados).queryByText('Data de encerramento')).not.toBeInTheDocument();
      expect(screen.queryByText('EM_ACOMPANHAMENTO')).not.toBeInTheDocument();
    });

    it('ENCERRADO: data de encerramento em São Paulo, inclusive na virada do dia', async () => {
      sessao('TUTOR');
      mockarApi({
        obter: (id) =>
          respostaFalsa(
            200,
            detalhe(Number(id), {
              status: 'ENCERRADO',
              responsavelAcompanhamento: { id: 1, nome: 'Gestora Fictícia' },
              // 01/11/2026 02:30 UTC -> 31/10/2026 23:30 em São Paulo.
              dataEncerramento: '2026-11-01T02:30:00.000Z',
            }),
          ),
      });
      renderizarApp('/ocorrencias/12');

      const dados = await screen.findByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Status')).toHaveTextContent('Encerrado');
      expect(valorDe(dados, 'Responsável pelo acompanhamento')).toHaveTextContent(
        'Gestora Fictícia',
      );
      expect(valorDe(dados, 'Data de encerramento')).toHaveTextContent('31/10/2026 às 23:30');
      expect(screen.queryByText(/2026-11-01T/)).not.toBeInTheDocument();
    });

    it('status fora do previsto não vaza o valor técnico: aparece "Não informado"', async () => {
      sessao();
      mockarApi({ obter: (id) => respostaFalsa(200, detalhe(Number(id), { status: 'XYZ' })) });
      renderizarApp('/ocorrencias/12');

      const dados = await screen.findByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Status')).toHaveTextContent('Não informado');
      expect(screen.queryByText('XYZ')).not.toBeInTheDocument();
    });
  });

  describe('estudantes e encaminhamentos', () => {
    it('vários encaminhamentos de tipos diferentes, com rótulos amigáveis, na ordem da API', async () => {
      sessao('PROFESSOR');
      const encaminhamentos = [
        {
          id: 503,
          destinatarioPerfil: 'GESTAO',
          destinatarioUsuario: null,
          registradoPor: { id: 30, nome: 'Professor Fictício' },
          dataHora: '2026-10-20T13:01:00.000Z',
          observacao: null,
        },
        {
          id: 501,
          destinatarioPerfil: 'TUTOR',
          destinatarioUsuario: { id: 13, nome: 'Tutora Fictícia C', perfil: 'TUTOR' },
          registradoPor: { id: 30, nome: 'Professor Fictício' },
          dataHora: '2026-10-20T13:01:00.000Z',
          observacao: 'Observação fictícia 1.',
        },
        {
          id: 502,
          destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
          destinatarioUsuario: { id: 20, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO' },
          registradoPor: { id: 1, nome: 'Gestora Fictícia' },
          dataHora: '2026-10-21T00:10:00.000Z', // 20/10/2026 21:10 em São Paulo
          observacao: '',
        },
        {
          id: 504,
          destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
          destinatarioUsuario: null,
          registradoPor: { id: 1, nome: 'Gestora Fictícia' },
          dataHora: '2026-10-22T12:00:00.000Z',
          observacao: null,
        },
      ];
      mockarApi({ obter: (id) => respostaFalsa(200, detalhe(Number(id), { encaminhamentos })) });
      renderizarApp('/ocorrencias/12');

      const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
      const itens = within(secao).getAllByRole('listitem');
      expect(itens.map((i) => valorDe(i, 'Destinatário').textContent)).toEqual([
        'Gestão — Toda a equipe',
        'Tutor — Tutora Fictícia C',
        'Equipe pedagógica — Pedagoga Fictícia',
        'Equipe pedagógica — Toda a equipe',
      ]);
      expect(valorDe(itens[1], 'Observação')).toHaveTextContent('Observação fictícia 1.');
      expect(valorDe(itens[2], 'Observação')).toHaveTextContent('Não informado');
      expect(valorDe(itens[2], 'Registrado por')).toHaveTextContent('Gestora Fictícia');
      expect(valorDe(itens[2], 'Data e hora')).toHaveTextContent('20/10/2026 às 21:10');
      for (const tecnico of ['EQUIPE_PEDAGOGICA', 'GESTAO', 'TUTOR']) {
        expect(within(secao).queryByText(tecnico)).not.toBeInTheDocument();
      }
    });

    it('estudante de turma diferente da ocorrência mostra a turma dele; ordem da API preservada', async () => {
      sessao();
      mockarApi({
        obter: (id) =>
          respostaFalsa(
            200,
            detalhe(Number(id), {
              turma: TURMA_6A,
              estudantes: [
                { id: 9, nomeCompleto: 'Estudante Fictício Z', turma: TURMA_8C },
                { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A },
                { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B },
              ],
            }),
          ),
      });
      renderizarApp('/ocorrencias/12');

      const dados = await screen.findByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Turma da ocorrência')).toHaveTextContent(ROTULO_6A);
      const itens = within(screen.getByRole('region', { name: 'Estudantes envolvidos' })).getAllByRole(
        'listitem',
      );
      expect(itens.map((i) => i.querySelector('.detalhe-ocorrencia__nome').textContent)).toEqual([
        'Estudante Fictício Z',
        'Estudante Fictício A',
        'Estudante Fictício C',
      ]);
      expect(valorDe(itens[0], 'Turma')).toHaveTextContent(ROTULO_8C);
      expect(valorDe(itens[2], 'Turma')).toHaveTextContent(ROTULO_7B);
    });

    it('comunicações e providências seguem a ordem da API', async () => {
      sessao();
      const comunicacoes = [
        { id: 2, destinatario: 'Família fictícia 2', meio: 'E-mail', descricao: 'C2', dataHora: '2026-10-21T12:00:00.000Z', registradoPor: { id: 1, nome: 'Gestora Fictícia' } },
        { id: 1, destinatario: 'Família fictícia 1', meio: 'Telefone', descricao: 'C1', dataHora: '2026-10-22T12:00:00.000Z', registradoPor: { id: 1, nome: 'Gestora Fictícia' } },
      ];
      const providencias = [
        { id: 8, descricao: 'P8', dataHora: '2026-10-21T12:00:00.000Z', registradoPor: { id: 1, nome: 'Gestora Fictícia' } },
        { id: 7, descricao: 'P7', dataHora: '2026-10-22T12:00:00.000Z', registradoPor: { id: 1, nome: 'Gestora Fictícia' } },
      ];
      mockarApi({
        obter: (id) => respostaFalsa(200, detalhe(Number(id), { comunicacoes, providencias })),
      });
      renderizarApp('/ocorrencias/12');

      const com = await screen.findByRole('region', { name: 'Comunicações' });
      expect(
        within(com).getAllByRole('listitem').map((i) => valorDe(i, 'Destinatário').textContent),
      ).toEqual(['Família fictícia 2', 'Família fictícia 1']);
      const prov = screen.getByRole('region', { name: 'Providências adotadas' });
      expect(
        within(prov).getAllByRole('listitem').map((i) => valorDe(i, 'Descrição').textContent),
      ).toEqual(['P8', 'P7']);
    });
  });

  describe('lista', () => {
    it('mantém a ordem exatamente como veio da API (sem reordenar no cliente)', async () => {
      sessao('TECNICO_ADMINISTRATIVO');
      mockarApi({
        lista: () =>
          respostaFalsa(
            200,
            paginaOcorrencias([
              itemLista(5, { dataHora: '2026-10-01T12:00:00.000Z' }),
              itemLista(9, { dataHora: '2026-10-25T12:00:00.000Z' }),
              itemLista(7, { dataHora: '2026-10-10T12:00:00.000Z' }),
            ]),
          ),
      });
      renderizarApp('/ocorrencias');

      await screen.findByRole('link', { name: 'Ocorrência nº 5' });
      const lista = screen.getByRole('list', { name: 'Ocorrências' });
      expect(within(lista).getAllByRole('link').map((l) => l.textContent)).toEqual([
        'Ocorrência nº 5',
        'Ocorrência nº 9',
        'Ocorrência nº 7',
      ]);
    });

    it('cartão sem estudantes, categoria ou turma mostra "Não informado" (sem quebrar a tela)', async () => {
      sessao();
      mockarApi({
        lista: () =>
          respostaFalsa(200, paginaOcorrencias([itemLista(3, { estudantes: [], categoria: null, turma: null, status: null })])),
      });
      renderizarApp('/ocorrencias');

      const link = await screen.findByRole('link', { name: 'Ocorrência nº 3' });
      const cartao = link.closest('article');
      expect(valorDe(cartao, 'Estudantes')).toHaveTextContent('Não informado');
      expect(valorDe(cartao, 'Categoria')).toHaveTextContent('Não informado');
      expect(valorDe(cartao, 'Turma')).toHaveTextContent('Não informado');
    });

    it('lista -> detalhe -> "Voltar para a lista" -> outro detalhe, recarregando a lista', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizarApp('/ocorrencias');

      await usuario.click(await screen.findByRole('link', { name: 'Ocorrência nº 11' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 11' })).toBeInTheDocument();
      expect(screen.getByText('Local fictício 11')).toBeInTheDocument();

      await usuario.click(screen.getByRole('link', { name: 'Voltar para a lista' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Ocorrências' })).toBeInTheDocument();
      await usuario.click(await screen.findByRole('link', { name: 'Ocorrência nº 12' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toBeInTheDocument();
      expect(screen.queryByText('Local fictício 11')).not.toBeInTheDocument();

      expect(chamadasGet('/ocorrencias')).toHaveLength(2);
      expect(chamadasGet('/ocorrencias/11')).toHaveLength(1);
      expect(chamadasGet('/ocorrencias/12')).toHaveLength(1);
    });
  });

  describe('acessibilidade dos links (RNF02)', () => {
    it('o link do cartão tem nome acessível, aponta ao detalhe e abre pelo teclado (Enter)', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias');

      const link = await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      expect(link).toHaveAttribute('href', '/ocorrencias/12');
      // O cartão (article) é rotulado pelo título que contém o link.
      expect(screen.getByRole('article', { name: 'Ocorrência nº 12' })).toContainElement(link);

      link.focus();
      expect(link).toHaveFocus();
      await usuario.keyboard('{Enter}');
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toBeInTheDocument();
    });

    it('a navegação por Tab alcança os links dos cartões, na ordem da lista', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias');
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });

      const focados = [];
      for (let i = 0; i < 20; i += 1) {
        await usuario.tab();
        focados.push(document.activeElement?.textContent);
      }
      const i12 = focados.indexOf('Ocorrência nº 12');
      const i11 = focados.indexOf('Ocorrência nº 11');
      expect(i12).toBeGreaterThanOrEqual(0);
      expect(i11).toBeGreaterThan(i12);
    });
  });

  describe('textos vindos da API', () => {
    it('quebras de linha preservadas nos campos longos (classe com pre-wrap)', async () => {
      sessao();
      mockarApi({
        obter: (id) =>
          respostaFalsa(
            200,
            detalhe(Number(id), {
              descricao: 'Linha fictícia 1\nLinha fictícia 2\n\nLinha fictícia 4',
              testemunhas: 'Testemunha fictícia 1\nTestemunha fictícia 2',
              comunicacoes: [
                { id: 1, destinatario: 'Família fictícia', meio: 'Telefone', descricao: 'Contato\nem duas linhas', dataHora: '2026-10-21T12:00:00.000Z', registradoPor: { id: 1, nome: 'Gestora Fictícia' } },
              ],
            }),
          ),
      });
      renderizarApp('/ocorrencias/12');

      const fato = await screen.findByRole('region', { name: 'O que aconteceu' });
      const descricao = valorDe(fato, 'Descrição do fato');
      expect(descricao.textContent).toBe('Linha fictícia 1\nLinha fictícia 2\n\nLinha fictícia 4');
      expect(descricao).toHaveClass('texto-longo');
      expect(valorDe(fato, 'Testemunhas').textContent).toBe('Testemunha fictícia 1\nTestemunha fictícia 2');
      const com = screen.getByRole('region', { name: 'Comunicações' });
      const desc = valorDe(within(com).getByRole('listitem'), 'Descrição');
      expect(desc.textContent).toBe('Contato\nem duas linhas');
      expect(desc).toHaveClass('texto-longo');
    });

    it('texto com <script>/HTML aparece como texto, sem virar elemento (XSS)', async () => {
      sessao();
      const script = '<script>window.__xss = 1</script>';
      const img = '<img src=x onerror="window.__xss=2">';
      mockarApi({
        lista: () =>
          respostaFalsa(
            200,
            paginaOcorrencias([
              itemLista(12, {
                categoria: { id: 5, nome: '<b>Categoria fictícia</b>' },
                estudantes: [{ id: 1, nomeCompleto: img }],
              }),
            ]),
          ),
        obter: (id) =>
          respostaFalsa(
            200,
            detalhe(Number(id), {
              descricao: script,
              local: '<a href="javascript:alert(1)">Pátio</a>',
              estudantes: [{ id: 1, nomeCompleto: img, turma: TURMA_6A }],
            }),
          ),
      });
      renderizarApp('/ocorrencias');

      const cartao = (await screen.findByRole('link', { name: 'Ocorrência nº 12' })).closest('article');
      expect(valorDe(cartao, 'Categoria').textContent).toBe('<b>Categoria fictícia</b>');
      expect(valorDe(cartao, 'Estudantes').textContent).toBe(img);
      expect(cartao.querySelector('b, img')).toBeNull();

      await usuario.click(screen.getByRole('link', { name: 'Ocorrência nº 12' }));
      const fato = await screen.findByRole('region', { name: 'O que aconteceu' });
      expect(valorDe(fato, 'Descrição do fato').textContent).toBe(script);
      const main = screen.getByRole('main');
      expect(main.querySelector('script, img')).toBeNull();
      expect(within(main).queryByRole('link', { name: 'Pátio' })).not.toBeInTheDocument();
      expect(window.__xss).toBeUndefined();
    });
  });

  describe('ids estranhos na URL', () => {
    it.each([
      ['0', '0'],
      ['abc', 'abc'],
      ['1.5', '1.5'],
      ['-1', '-1'],
      ['12abc', '12abc'],
      ['99999999999', '99999999999'],
      ['a%20b', 'a%20b'],
      ['%3Cscript%3E', '%3Cscript%3E'],
    ])('/ocorrencias/%s chama a API (codificado) e trata o 400 como "não encontrada"', async (naUrl, esperado) => {
      sessao();
      mockarApi({
        obter: () => respostaFalsa(400, { erro: 'Identificador de ocorrência inválido.' }),
      });
      renderizarApp(`/ocorrencias/${naUrl}`);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_NAO_ENCONTRADA);
      // Mensagem técnica da API não aparece; não oferece "Tentar novamente".
      expect(screen.queryByText('Identificador de ocorrência inválido.')).not.toBeInTheDocument();
      expect(within(alerta).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Detalhe da ocorrência' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(`${URL_API}/ocorrencias/${esperado}`, expect.anything());
    });

    it('404 (fora da visibilidade — RN19) para cada perfil mostra a mesma mensagem clara', async () => {
      for (const perfil of ['PROFESSOR', 'TUTOR', 'TECNICO_ADMINISTRATIVO']) {
        sessao(perfil);
        mockarApi({ obter: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }) });
        const { unmount } = renderizarApp('/ocorrencias/77');
        expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
        expect(screen.queryByRole('region', { name: 'Dados da ocorrência' })).not.toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('troca de detalhe e faixa de sucesso', () => {
    it('ir do detalhe 12 (com faixa) para o 11 não mistura dados nem leva a faixa', async () => {
      sessao();
      mockarApi();
      renderizarComSondas([{ pathname: '/ocorrencias/12', state: { ocorrenciaRegistrada: 12 } }]);

      expect(await screen.findByText('Ocorrência nº 12 registrada com sucesso.')).toBeInTheDocument();
      expect(await screen.findByText('Local fictício 12')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Ir para 11 (teste)' }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 11' })).toBeInTheDocument();
      expect(screen.getByText('Local fictício 11')).toBeInTheDocument();
      expect(screen.queryByText('Local fictício 12')).not.toBeInTheDocument();
      expect(screen.queryByText(/registrada com sucesso/)).not.toBeInTheDocument();
    });

    it('resposta atrasada do detalhe anterior não sobrescreve o detalhe atual (corrida)', async () => {
      sessao();
      const lenta = adiada();
      mockarApi({
        obter: (id) => (id === '12' ? lenta.promessa : respostaFalsa(200, detalhe(Number(id)))),
      });
      renderizarComSondas(['/ocorrencias/12']);
      expect(screen.getByText('Carregando a ocorrência...')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Ir para 11 (teste)' }));
      expect(await screen.findByText('Local fictício 11')).toBeInTheDocument();

      lenta.resolver(respostaFalsa(200, detalhe(12)));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 11' })).toBeInTheDocument();
      expect(screen.queryByText('Local fictício 12')).not.toBeInTheDocument();
    });

    it('em StrictMode (como no main.jsx) a faixa aparece com foco e o state é apagado', async () => {
      sessao();
      mockarApi();
      renderizarComSondas([{ pathname: '/ocorrencias/12', state: { ocorrenciaRegistrada: 12 } }], {
        estrito: true,
      });

      const faixa = await screen.findByText('Ocorrência nº 12 registrada com sucesso.');
      // O foco vem de um efeito que roda depois do texto aparecer.
      await waitFor(() => expect(faixa).toHaveFocus());
      expect(screen.getAllByText('Ocorrência nº 12 registrada com sucesso.')).toHaveLength(1);
      await waitFor(() => expect(screen.getByTestId('estado-navegacao')).toHaveTextContent('null'));
      expect(await screen.findByText('Local fictício 12')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('menu', () => {
    it('na lista, "Ocorrências" fica marcado e "Início"/"Registrar ocorrência" não', async () => {
      sessao('TUTOR');
      mockarApi();
      renderizarApp('/ocorrencias');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Ocorrências' })).toHaveAttribute('aria-current', 'page');
      expect(within(menu).getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
      expect(within(menu).getByRole('link', { name: 'Registrar ocorrência' })).not.toHaveAttribute(
        'aria-current',
      );
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    });

    it('no detalhe de id inválido, "Ocorrências" continua marcado', async () => {
      sessao();
      mockarApi({ obter: () => respostaFalsa(400, { erro: 'x' }) });
      renderizarApp('/ocorrencias/abc');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Ocorrências' })).toHaveAttribute('aria-current', 'page');
      await screen.findByRole('alert');
    });
  });
});

// ---------------------------------------------------------------------------
// Registro (#46) ponta a ponta até o detalhe e a lista (#48)
// ---------------------------------------------------------------------------

const CATEGORIAS = [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }];
const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', email: 'g@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 20, nome: 'Pedagoga Fictícia', email: 'p@exemplo.test', perfil: 'PEDAGOGICO', status: 'ATIVO' },
];
const ESTUDANTES = [
  { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: null },
];

describe('Registro -> detalhe -> lista, ponta a ponta (#46 + #48)', () => {
  let usuario;

  beforeEach(() => {
    // Relógio fixo em 2026 (Issue #134): a turma fictícia é de 2026 e, com o
    // filtro padrão por ano letivo, sumiria da lista a partir de 2027; a data
    // do fato (20/10/2026) também precisa continuar no passado. Só o Date é
    // simulado; os temporizadores continuam reais.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T13:00:00.000Z'));
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registra, cai no detalhe com os dados enviados, volta à lista e reabre sem a faixa', async () => {
    gravarSessaoFicticia({ usuario: { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO' } });
    const registradas = [];
    fetch.mockImplementation(async (url, opcoes = {}) => {
      const m = opcoes.method;
      if (m === 'GET' && url === `${URL_API}/turmas`) return respostaFalsa(200, [TURMA_6A]);
      if (m === 'GET' && url === `${URL_API}/categorias`) return respostaFalsa(200, CATEGORIAS);
      if (m === 'GET' && url === `${URL_API}/usuarios`) return respostaFalsa(200, USUARIOS);
      if (m === 'GET' && /\/estudantes\?turmaId=1$/.test(url)) return respostaFalsa(200, ESTUDANTES);
      if (m === 'POST' && url === `${URL_API}/ocorrencias`) {
        const corpo = JSON.parse(opcoes.body);
        const criada = detalhe(77, {
          dataHora: '2026-10-20T10:00:00.000Z',
          local: corpo.local,
          descricao: corpo.descricao,
          estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
          profissionalResponsavel: { id: 1, nome: 'Gestora Fictícia' },
          encaminhamentos: [
            {
              id: 900,
              destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
              destinatarioUsuario: null,
              registradoPor: { id: 1, nome: 'Gestora Fictícia' },
              dataHora: '2026-10-20T10:01:00.000Z',
              observacao: null,
            },
          ],
        });
        registradas.push(criada);
        return respostaFalsa(201, criada);
      }
      if (m === 'GET' && url === `${URL_API}/ocorrencias`) {
        return respostaFalsa(200, paginaOcorrencias(registradas.map((o) => itemLista(o.id, { local: o.local }))));
      }
      const get = url.match(/\/ocorrencias\/(\d+)$/);
      if (m === 'GET' && get) {
        const o = registradas.find((r) => r.id === Number(get[1]));
        return o ? respostaFalsa(200, o) : respostaFalsa(404, { erro: 'Ocorrência não encontrada.' });
      }
      // #85: o detalhe também busca o histórico (lista vazia aqui).
      if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
        return respostaFalsa(200, []);
      }
      throw new Error(`Chamada inesperada: ${m} ${url}`);
    });

    renderizarApp('/ocorrencias/nova');
    await screen.findByRole('button', { name: 'Registrar ocorrência' });
    await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
    await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
    await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
    await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia ponta a ponta.');
    fireEvent.change(screen.getByLabelText('Data e hora do fato'), {
      target: { value: '2026-10-20T07:00' },
    });
    await usuario.type(screen.getByLabelText('Local'), 'Quadra fictícia');
    const grupo = screen.getByRole('group', { name: 'Destinatário 1' });
    await usuario.selectOptions(within(grupo).getByLabelText('Encaminhar para'), 'Equipe pedagógica');
    await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

    const faixa = await screen.findByText('Ocorrência nº 77 registrada com sucesso.');
    // O foco vem de um efeito que roda depois do texto aparecer.
    await waitFor(() => expect(faixa).toHaveFocus());
    expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 77' })).toBeInTheDocument();
    const dados = screen.getByRole('region', { name: 'Dados da ocorrência' });
    expect(valorDe(dados, 'Local')).toHaveTextContent('Quadra fictícia');
    expect(valorDe(dados, 'Profissional responsável')).toHaveTextContent('Gestora Fictícia');
    expect(screen.getByText('Descrição fictícia ponta a ponta.')).toBeInTheDocument();
    const enc = screen.getByRole('region', { name: 'Encaminhamentos' });
    expect(within(enc).getByText('Equipe pedagógica — Toda a equipe')).toBeInTheDocument();

    await usuario.click(screen.getByRole('link', { name: 'Voltar para a lista' }));
    await usuario.click(await screen.findByRole('link', { name: 'Ocorrência nº 77' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 77' })).toBeInTheDocument();
    expect(screen.queryByText(/registrada com sucesso/)).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(1);
  });
});
