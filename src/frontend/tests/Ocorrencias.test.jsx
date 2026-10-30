// Fluxos da Issue #48 — lista e detalhe de ocorrências, somente leitura
// (UC03, RF05, RN01, RN17, RN19, RN20, RNF01, RNF02): menu e rota para os 5
// perfis, cartões com data/hora em São Paulo e status com rótulo amigável,
// lista vazia, erros com "Tentar novamente", detalhe com todos os campos do
// RF05, encaminhamentos, comunicações e providências, código escolar só
// quando vier na resposta (Gestão), 404/400, erro de conexão e a faixa de
// sucesso vinda do registro (#46), que não reaparece.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../src/App.jsx';
import {
  formatarDataHora,
  mensagemErroDetalheOcorrencia,
  mensagemErroListaOcorrencias,
  rotuloStatusOcorrencia,
} from '../src/services/mensagensOcorrencias.js';
import {
  PERFIS_CONSULTA_OCORRENCIAS,
  podeConsultarOcorrencias,
} from '../src/services/perfis.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';

// Itens resumidos do GET /ocorrencias, já do mais recente para o mais antigo.
const LISTA_FICTICIA = [
  {
    id: 12,
    dataHora: '2026-10-30T12:39:00.000Z', // 30/10/2026 09:39 em São Paulo
    local: 'Pátio',
    status: 'ABERTO',
    turma: TURMA_6A,
    categoria: { id: 5, nome: 'Categoria Fictícia X' },
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    estudantes: [
      { id: 1, nomeCompleto: 'Estudante Fictício A' },
      { id: 2, nomeCompleto: 'Estudante Fictício B' },
    ],
  },
  {
    id: 11,
    dataHora: '2026-10-30T01:15:00.000Z', // virada de dia: 29/10/2026 22:15 em São Paulo
    local: 'Quadra',
    status: 'EM_ACOMPANHAMENTO',
    turma: TURMA_7B,
    categoria: { id: 6, nome: 'Categoria Fictícia Y' },
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    estudantes: [{ id: 3, nomeCompleto: 'Estudante Fictício C' }],
  },
  {
    id: 10,
    dataHora: '2026-01-01T02:00:00.000Z', // virada de ano: 31/12/2025 23:00 em São Paulo
    local: 'Sala 3',
    status: 'ENCERRADO',
    turma: TURMA_7B,
    categoria: { id: 6, nome: 'Categoria Fictícia Y' },
    profissionalResponsavel: { id: 31, nome: 'Técnica Fictícia' },
    estudantes: [{ id: 4, nomeCompleto: 'Estudante Fictício D' }],
  },
];

// Detalhe completo (como recebe quem não é Gestão: sem codigoEscolar).
const DETALHE_COMPLETO = Object.freeze({
  id: 12,
  dataHora: '2026-10-30T12:39:00.000Z',
  local: 'Pátio',
  turma: TURMA_6A,
  categoria: { id: 5, nome: 'Categoria Fictícia X' },
  descricao: 'Descrição fictícia do fato.\nSegunda linha fictícia.',
  demaisEnvolvidos: 'Envolvido fictício',
  testemunhas: 'Testemunha fictícia',
  providenciasImediatas: 'Conversa fictícia com os envolvidos.',
  observacoes: 'Observação fictícia.',
  status: 'ENCERRADO',
  dataEncerramento: '2026-10-31T13:05:00.000Z', // 31/10/2026 10:05 em São Paulo
  profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
  responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
  estudantes: [
    { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A },
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B },
  ],
  encaminhamentos: [
    {
      id: 100,
      destinatarioPerfil: 'TUTOR',
      destinatarioUsuario: { id: 13, nome: 'Tutora Fictícia C', perfil: 'TUTOR' },
      registradoPor: { id: 30, nome: 'Professor Fictício' },
      dataHora: '2026-10-30T12:40:00.000Z',
      observacao: 'Observação fictícia do encaminhamento.',
    },
    {
      id: 101,
      destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
      destinatarioUsuario: null,
      registradoPor: { id: 30, nome: 'Professor Fictício' },
      dataHora: '2026-10-30T12:40:00.000Z',
      observacao: null,
    },
    {
      id: 102,
      destinatarioPerfil: 'GESTAO',
      destinatarioUsuario: { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO' },
      registradoPor: { id: 20, nome: 'Pedagoga Fictícia' },
      dataHora: '2026-10-30T15:00:00.000Z',
      observacao: null,
    },
  ],
  comunicacoes: [
    {
      id: 200,
      destinatario: 'Família fictícia',
      meio: 'Telefone',
      descricao: 'Contato fictício com a família.',
      dataHora: '2026-10-30T18:30:00.000Z', // 30/10/2026 15:30
      registradoPor: { id: 20, nome: 'Pedagoga Fictícia' },
    },
  ],
  providencias: [
    {
      id: 300,
      descricao: 'Providência fictícia adotada.',
      dataHora: '2026-10-31T11:00:00.000Z', // 31/10/2026 08:00
      registradoPor: { id: 1, nome: 'Gestora Fictícia' },
    },
  ],
});

// Detalhe mínimo: opcionais vazios, sem acompanhamento, comunicações nem providências.
const DETALHE_MINIMO = Object.freeze({
  ...DETALHE_COMPLETO,
  id: 11,
  descricao: 'Descrição fictícia curta.',
  demaisEnvolvidos: null,
  testemunhas: null,
  providenciasImediatas: null,
  observacoes: null,
  status: 'ABERTO',
  dataEncerramento: null,
  responsavelAcompanhamento: null,
  estudantes: [{ id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B }],
  encaminhamentos: [DETALHE_COMPLETO.encaminhamentos[1]],
  comunicacoes: [],
  providencias: [],
});

// Como a Gestão recebe (RN20): com codigoEscolar (que pode ser null).
const DETALHE_GESTAO = Object.freeze({
  ...DETALHE_COMPLETO,
  estudantes: [
    { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, codigoEscolar: 'COD-FICT-001' },
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B, codigoEscolar: null },
  ],
});

/**
 * GET /ocorrencias chama `lista()`; GET /ocorrencias/{id} chama `detalhe(id)`
 * (id como texto, do jeito que veio na URL).
 */
function mockarApi({
  lista = () => respostaFalsa(200, LISTA_FICTICIA),
  detalhe = () => respostaFalsa(200, DETALHE_COMPLETO),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/ocorrencias`) return lista();
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (opcoes.method === 'GET' && get) return detalhe(decodeURIComponent(get[1]));
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

/** Valor (dd) do rótulo (dt) dentro de um contêiner. */
function valorDe(conteiner, rotulo) {
  const termo = within(conteiner).getByText(rotulo, { selector: 'dt' });
  return termo.nextElementSibling;
}

function cartoes() {
  const lista = screen.getByRole('list', { name: 'Ocorrências' });
  return within(lista).getAllByRole('article');
}

// Auxiliares só de teste: voltar no histórico e ver o state da navegação.
function Sondas() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        Voltar (teste)
      </button>
      <output data-testid="estado-navegacao">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function renderizarComSondas(entradas) {
  return render(
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      <App />
      <Sondas />
    </MemoryRouter>,
  );
}

describe('Lista e detalhe de ocorrências (#48)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar o fetch: um GET pendente da tela não pode
    // sair pelo fetch real (nem afetar a sessão do teste seguinte).
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('acesso pelos 5 perfis (RN01, UC03)', () => {
    it.each(PERFIS)(
      '%s vê "Ocorrências" no menu, antes de "Registrar ocorrência", e chega à lista',
      async (perfil) => {
        sessao(perfil);
        mockarApi();
        renderizarApp('/');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        const nomes = within(menu).getAllByRole('link').map((link) => link.textContent);
        expect(nomes.slice(0, 3)).toEqual(['Início', 'Ocorrências', 'Registrar ocorrência']);

        await usuario.click(within(menu).getByRole('link', { name: 'Ocorrências' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Ocorrências' })).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'Ocorrência nº 12' })).toBeInTheDocument();
      },
    );

    it.each(PERFIS)('%s abre o detalhe direto pela rota', async (perfil) => {
      sessao(perfil);
      mockarApi();
      renderizarApp('/ocorrencias/12');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' }),
      ).toBeInTheDocument();
    });

    it('o menu marca "Ocorrências" na lista e no detalhe, mas não no registro', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias/12');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Ocorrências' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });
    });

    it('no registro, só "Registrar ocorrência" fica marcado no menu', () => {
      sessao();
      fetch.mockImplementation(() => new Promise(() => {}));
      renderizarApp('/ocorrencias/nova');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Ocorrências' })).not.toHaveAttribute(
        'aria-current',
      );
      expect(
        within(menu).getByRole('link', { name: 'Registrar ocorrência' }),
      ).toHaveAttribute('aria-current', 'page');
    });

    it('perfis permitidos: os cinco', () => {
      expect([...PERFIS_CONSULTA_OCORRENCIAS].sort()).toEqual([...PERFIS].sort());
      for (const perfil of PERFIS) expect(podeConsultarOcorrencias(perfil)).toBe(true);
      expect(podeConsultarOcorrencias(undefined)).toBe(false);
      expect(podeConsultarOcorrencias('OUTRO')).toBe(false);
    });
  });

  describe('lista (GET /ocorrencias)', () => {
    it('mostra os cartões na ordem da API, com data em São Paulo, categoria, turma, estudantes e status', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizarApp('/ocorrencias');

      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
      const [primeiro, segundo, terceiro] = cartoes();
      expect(cartoes()).toHaveLength(3);

      expect(within(primeiro).getByRole('heading', { level: 2 })).toHaveTextContent('Ocorrência nº 12');
      expect(within(primeiro).getByText('Aberto')).toHaveClass('selo');
      expect(valorDe(primeiro, 'Data e hora')).toHaveTextContent('30/10/2026 às 09:39');
      expect(valorDe(primeiro, 'Categoria')).toHaveTextContent('Categoria Fictícia X');
      expect(valorDe(primeiro, 'Turma')).toHaveTextContent(ROTULO_6A);
      expect(valorDe(primeiro, 'Estudantes')).toHaveTextContent(
        'Estudante Fictício A, Estudante Fictício B',
      );

      // Virada de dia (UTC 30/10 01:15 -> São Paulo 29/10 22:15).
      expect(within(segundo).getByText('Em acompanhamento')).toBeInTheDocument();
      expect(valorDe(segundo, 'Data e hora')).toHaveTextContent('29/10/2026 às 22:15');
      expect(valorDe(segundo, 'Turma')).toHaveTextContent(ROTULO_7B);

      // Virada de ano (UTC 01/01/2026 02:00 -> São Paulo 31/12/2025 23:00).
      expect(within(terceiro).getByText('Encerrado')).toBeInTheDocument();
      expect(valorDe(terceiro, 'Data e hora')).toHaveTextContent('31/12/2025 às 23:00');

      // Nada técnico na tela.
      expect(screen.queryByText('EM_ACOMPANHAMENTO')).not.toBeInTheDocument();
      expect(screen.queryByText(/2026-10-30T/)).not.toBeInTheDocument();
    });

    it('chama GET /ocorrencias autenticado, sem filtros', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias');
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });

      const chamadas = fetch.mock.calls.filter(([url]) => url.startsWith(`${URL_API}/ocorrencias`));
      expect(chamadas).toHaveLength(1);
      const [url, opcoes] = chamadas[0];
      expect(url).toBe(`${URL_API}/ocorrencias`);
      expect(opcoes.method).toBe('GET');
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('cada cartão leva ao detalhe da ocorrência', async () => {
      sessao();
      mockarApi({ detalhe: () => respostaFalsa(200, DETALHE_MINIMO) });
      renderizarApp('/ocorrencias');

      const link = await screen.findByRole('link', { name: 'Ocorrência nº 11' });
      expect(link).toHaveAttribute('href', '/ocorrencias/11');
      await usuario.click(link);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 11' }),
      ).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(`${URL_API}/ocorrencias/11`, expect.anything());
    });

    it('tem atalho para registrar ocorrência', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias');
      const principal = screen.getByRole('main');
      expect(within(principal).getByRole('link', { name: 'Registrar ocorrência' })).toHaveAttribute(
        'href',
        '/ocorrencias/nova',
      );
      await screen.findByRole('link', { name: 'Ocorrência nº 12' });
    });

    it('lista vazia mostra mensagem clara', async () => {
      sessao('TECNICO_ADMINISTRATIVO');
      mockarApi({ lista: () => respostaFalsa(200, []) });
      renderizarApp('/ocorrencias');

      expect(await screen.findByText('Nenhuma ocorrência para mostrar.')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Ocorrências' })).not.toBeInTheDocument();
    });

    it('sem conexão: mensagem compreensível e "Tentar novamente" recarrega', async () => {
      sessao();
      let falhar = true;
      mockarApi({
        lista: () =>
          falhar ? Promise.reject(new TypeError('Failed to fetch')) : respostaFalsa(200, LISTA_FICTICIA),
      });
      renderizarApp('/ocorrencias');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      falhar = false;
      await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByRole('link', { name: 'Ocorrência nº 12' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('403 e 500 mostram mensagens sem detalhe técnico', async () => {
      sessao();
      mockarApi({ lista: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
      const { unmount } = renderizarApp('/ocorrencias');
      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
      unmount();

      mockarApi({ lista: () => respostaFalsa(500) });
      renderizarApp('/ocorrencias');
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível carregar as ocorrências agora.',
      );
    });

    it('401 volta ao login com aviso de sessão', async () => {
      sessao();
      mockarApi({ lista: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      renderizarApp('/ocorrencias');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    });
  });

  describe('detalhe (GET /ocorrencias/{id})', () => {
    it('mostra todos os campos do RF05, com datas em São Paulo e rótulos amigáveis', async () => {
      sessao('PEDAGOGICO');
      mockarApi();
      renderizarApp('/ocorrencias/12');

      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });
      const dados = screen.getByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Número da ocorrência')).toHaveTextContent('12');
      expect(valorDe(dados, 'Status')).toHaveTextContent('Encerrado');
      expect(valorDe(dados, 'Data e hora do fato')).toHaveTextContent('30/10/2026 às 09:39');
      expect(valorDe(dados, 'Local')).toHaveTextContent('Pátio');
      expect(valorDe(dados, 'Turma da ocorrência')).toHaveTextContent(ROTULO_6A);
      expect(valorDe(dados, 'Categoria')).toHaveTextContent('Categoria Fictícia X');
      expect(valorDe(dados, 'Profissional responsável')).toHaveTextContent('Professor Fictício');
      expect(valorDe(dados, 'Responsável pelo acompanhamento')).toHaveTextContent(
        'Pedagoga Fictícia',
      );
      expect(valorDe(dados, 'Data de encerramento')).toHaveTextContent('31/10/2026 às 10:05');

      const fato = screen.getByRole('region', { name: 'O que aconteceu' });
      // Quebras de linha preservadas (o texto é exibido como veio).
      expect(valorDe(fato, 'Descrição do fato').textContent).toBe(
        'Descrição fictícia do fato.\nSegunda linha fictícia.',
      );
      expect(valorDe(fato, 'Demais envolvidos')).toHaveTextContent('Envolvido fictício');
      expect(valorDe(fato, 'Testemunhas')).toHaveTextContent('Testemunha fictícia');
      expect(valorDe(fato, 'Providências imediatas')).toHaveTextContent(
        'Conversa fictícia com os envolvidos.',
      );
      expect(valorDe(fato, 'Observações')).toHaveTextContent('Observação fictícia.');

      const estudantes = within(
        screen.getByRole('region', { name: 'Estudantes envolvidos' }),
      ).getAllByRole('listitem');
      expect(estudantes).toHaveLength(2);
      expect(estudantes[0]).toHaveTextContent('Estudante Fictício A');
      expect(valorDe(estudantes[0], 'Turma')).toHaveTextContent(ROTULO_6A);
      expect(valorDe(estudantes[1], 'Turma')).toHaveTextContent(ROTULO_7B);

      expect(screen.getByRole('link', { name: 'Voltar para a lista' })).toHaveAttribute(
        'href',
        '/ocorrencias',
      );
      // Somente leitura: nenhuma ação nesta versão.
      expect(within(screen.getByRole('main')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('encaminhamentos: destinatário com rótulo amigável, pessoa ou "Toda a equipe", quem registrou e quando', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias/12');

      const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
      const [tutor, equipe, gestao] = within(secao).getAllByRole('listitem');
      expect(valorDe(tutor, 'Destinatário')).toHaveTextContent('Tutor — Tutora Fictícia C');
      expect(valorDe(tutor, 'Registrado por')).toHaveTextContent('Professor Fictício');
      expect(valorDe(tutor, 'Data e hora')).toHaveTextContent('30/10/2026 às 09:40');
      expect(valorDe(tutor, 'Observação')).toHaveTextContent('Observação fictícia do encaminhamento.');

      expect(valorDe(equipe, 'Destinatário')).toHaveTextContent('Equipe pedagógica — Toda a equipe');
      expect(valorDe(equipe, 'Observação')).toHaveTextContent('Não informado');

      expect(valorDe(gestao, 'Destinatário')).toHaveTextContent('Gestão — Gestora Fictícia');
      expect(valorDe(gestao, 'Registrado por')).toHaveTextContent('Pedagoga Fictícia');
      expect(valorDe(gestao, 'Data e hora')).toHaveTextContent('30/10/2026 às 12:00');
      expect(screen.queryByText(/EQUIPE_PEDAGOGICA/)).not.toBeInTheDocument();
    });

    it('comunicações e providências preenchidas', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias/12');

      const comunicacoes = await screen.findByRole('region', { name: 'Comunicações' });
      const [comunicacao] = within(comunicacoes).getAllByRole('listitem');
      expect(valorDe(comunicacao, 'Destinatário')).toHaveTextContent('Família fictícia');
      expect(valorDe(comunicacao, 'Meio')).toHaveTextContent('Telefone');
      expect(valorDe(comunicacao, 'Descrição')).toHaveTextContent('Contato fictício com a família.');
      expect(valorDe(comunicacao, 'Registrada por')).toHaveTextContent('Pedagoga Fictícia');
      expect(valorDe(comunicacao, 'Data e hora')).toHaveTextContent('30/10/2026 às 15:30');

      const providencias = screen.getByRole('region', { name: 'Providências adotadas' });
      const [providencia] = within(providencias).getAllByRole('listitem');
      expect(valorDe(providencia, 'Descrição')).toHaveTextContent('Providência fictícia adotada.');
      expect(valorDe(providencia, 'Registrada por')).toHaveTextContent('Gestora Fictícia');
      expect(valorDe(providencia, 'Data e hora')).toHaveTextContent('31/10/2026 às 08:00');
    });

    it('opcionais vazios aparecem como "Não informado"; sem acompanhamento, encerramento, comunicações nem providências', async () => {
      sessao('TUTOR');
      mockarApi({ detalhe: () => respostaFalsa(200, DETALHE_MINIMO) });
      renderizarApp('/ocorrencias/11');

      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 11' });
      const fato = screen.getByRole('region', { name: 'O que aconteceu' });
      for (const rotulo of ['Demais envolvidos', 'Testemunhas', 'Providências imediatas', 'Observações']) {
        expect(valorDe(fato, rotulo)).toHaveTextContent('Não informado');
      }
      const dados = screen.getByRole('region', { name: 'Dados da ocorrência' });
      expect(valorDe(dados, 'Status')).toHaveTextContent('Aberto');
      expect(within(dados).queryByText('Responsável pelo acompanhamento')).not.toBeInTheDocument();
      expect(within(dados).queryByText('Data de encerramento')).not.toBeInTheDocument();

      expect(
        within(screen.getByRole('region', { name: 'Comunicações' })).getByText(
          'Nenhuma comunicação registrada.',
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'Providências adotadas' })).getByText(
          'Nenhuma providência registrada.',
        ),
      ).toBeInTheDocument();
    });

    it('sem a chave codigoEscolar na resposta (quem não é Gestão), o código escolar não aparece', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizarApp('/ocorrencias/12');

      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });
      expect(screen.queryByText('Código escolar')).not.toBeInTheDocument();
    });

    it('com codigoEscolar na resposta (Gestão — RN20), mostra o código; vazio vira "Não informado"', async () => {
      sessao('GESTAO');
      mockarApi({ detalhe: () => respostaFalsa(200, DETALHE_GESTAO) });
      renderizarApp('/ocorrencias/12');

      const secao = await screen.findByRole('region', { name: 'Estudantes envolvidos' });
      const [a, c] = within(secao).getAllByRole('listitem');
      expect(valorDe(a, 'Código escolar')).toHaveTextContent('COD-FICT-001');
      expect(valorDe(c, 'Código escolar')).toHaveTextContent('Não informado');
    });

    it('textos longos sem espaço não estouram a largura (quebra de linha no CSS)', async () => {
      sessao();
      const palavraLonga = 'x'.repeat(400);
      mockarApi({
        detalhe: () => respostaFalsa(200, { ...DETALHE_MINIMO, descricao: palavraLonga }),
      });
      renderizarApp('/ocorrencias/11');

      const fato = await screen.findByRole('region', { name: 'O que aconteceu' });
      const dd = valorDe(fato, 'Descrição do fato');
      expect(dd).toHaveTextContent(palavraLonga);
      expect(dd).toHaveClass('texto-longo');
    });

    it('404: "Ocorrência não encontrada" e link para voltar à lista, sem "Tentar novamente"', async () => {
      sessao('PROFESSOR');
      mockarApi({ detalhe: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }) });
      renderizarApp('/ocorrencias/999');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Detalhe da ocorrência' })).toBeInTheDocument();

      await usuario.click(screen.getByRole('link', { name: 'Voltar para a lista' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrências' })).toBeInTheDocument();
    });

    it('id inválido na URL (400): mesma mensagem clara de não encontrada', async () => {
      sessao();
      mockarApi({
        detalhe: () => respostaFalsa(400, { erro: 'Informe o id da ocorrência como número inteiro positivo.' }),
      });
      renderizarApp('/ocorrencias/abc');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
      expect(screen.queryByText(/número inteiro positivo/)).not.toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(`${URL_API}/ocorrencias/abc`, expect.anything());
    });

    it('sem conexão: mensagem compreensível e "Tentar novamente" recarrega', async () => {
      sessao();
      let falhar = true;
      mockarApi({
        detalhe: () =>
          falhar ? Promise.reject(new TypeError('Failed to fetch')) : respostaFalsa(200, DETALHE_COMPLETO),
      });
      renderizarApp('/ocorrencias/12');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      falhar = false;
      await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' }),
      ).toBeInTheDocument();
    });

    it('403 mostra que o perfil não tem permissão', async () => {
      sessao();
      mockarApi({ detalhe: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
      renderizarApp('/ocorrencias/12');
      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('401 volta ao login com aviso de sessão', async () => {
      sessao();
      mockarApi({ detalhe: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      renderizarApp('/ocorrencias/12');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    });
  });

  describe('faixa de sucesso vinda do registro (#46)', () => {
    const FAIXA = 'Ocorrência nº 12 registrada com sucesso.';

    it('abrir o detalhe direto não mostra a faixa', async () => {
      sessao();
      mockarApi();
      renderizarApp('/ocorrencias/12');
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' });
      expect(screen.queryByText(FAIXA)).not.toBeInTheDocument();
    });

    it('vinda do registro, a faixa aparece com foco e o state da navegação é apagado', async () => {
      sessao();
      mockarApi();
      renderizarComSondas([{ pathname: '/ocorrencias/12', state: { ocorrenciaRegistrada: 12 } }]);

      const faixa = await screen.findByText(FAIXA);
      expect(faixa).toHaveFocus();
      expect(faixa.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
      // Sem state, recarregar a página não traz a faixa de volta.
      await waitFor(() => expect(screen.getByTestId('estado-navegacao')).toHaveTextContent('null'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toBeInTheDocument();
      expect(screen.getByText(FAIXA)).toBeInTheDocument();
    });

    it('sair do detalhe e voltar pelo histórico não mostra a faixa de novo', async () => {
      sessao();
      mockarApi();
      renderizarComSondas([
        '/ocorrencias/nova',
        { pathname: '/ocorrencias/12', state: { ocorrenciaRegistrada: 12 } },
      ]);
      await screen.findByText(FAIXA);
      await waitFor(() => expect(screen.getByTestId('estado-navegacao')).toHaveTextContent('null'));

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Ocorrências' }));
      await screen.findByRole('heading', { level: 1, name: 'Ocorrências' });
      expect(screen.queryByText(FAIXA)).not.toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Voltar (teste)' }));
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(FAIXA)).not.toBeInTheDocument();
    });
  });
});

describe('rótulos, datas e mensagens da consulta (unidade)', () => {
  it('formatarDataHora mostra o horário de São Paulo em formato brasileiro', () => {
    expect(formatarDataHora('2026-10-30T12:39:00.000Z')).toBe('30/10/2026 às 09:39');
    expect(formatarDataHora('2026-10-30T01:15:00.000Z')).toBe('29/10/2026 às 22:15');
    expect(formatarDataHora('2026-01-01T02:59:00.000Z')).toBe('31/12/2025 às 23:59');
    // Horário de verão de 2018 (UTC-02:00), calculado pelo Intl.
    expect(formatarDataHora('2018-12-01T12:15:00.000Z')).toBe('01/12/2018 às 10:15');
  });

  it('formatarDataHora devolve vazio para valor ausente ou inválido', () => {
    expect(formatarDataHora(null)).toBe('');
    expect(formatarDataHora(undefined)).toBe('');
    expect(formatarDataHora('')).toBe('');
    expect(formatarDataHora('data inválida')).toBe('');
  });

  it('rotuloStatusOcorrencia traduz os valores técnicos', () => {
    expect(rotuloStatusOcorrencia('ABERTO')).toBe('Aberto');
    expect(rotuloStatusOcorrencia('EM_ACOMPANHAMENTO')).toBe('Em acompanhamento');
    expect(rotuloStatusOcorrencia('ENCERRADO')).toBe('Encerrado');
    expect(rotuloStatusOcorrencia('OUTRO')).toBe('');
  });

  it('mensagens de erro da lista e do detalhe', () => {
    expect(mensagemErroListaOcorrencias({ status: 0 })).toBe(MSG_SEM_CONEXAO);
    expect(mensagemErroListaOcorrencias({ status: 403 })).toBe(MSG_SEM_PERMISSAO);
    expect(mensagemErroDetalheOcorrencia({ status: 404 })).toBe(MSG_NAO_ENCONTRADA);
    expect(mensagemErroDetalheOcorrencia({ status: 400 })).toBe(MSG_NAO_ENCONTRADA);
    expect(mensagemErroDetalheOcorrencia({ status: 0 })).toBe(MSG_SEM_CONEXAO);
    expect(mensagemErroDetalheOcorrencia({ status: 500 })).toBe(
      'Não foi possível carregar a ocorrência agora.',
    );
  });
});
