// Fluxos da Issue #85 — seção "Histórico" no detalhe da ocorrência (RF12,
// UC03 passo 3, RN08, RN17, RN19, RNF01, RNF02): lista do mais antigo para o
// mais novo nos 5 perfis, data/hora em São Paulo, ação, descrição quando houver
// e nome de quem fez; recarga depois de encaminhar, comunicar, registrar
// providência e encerrar (sem recarregar a página); erro da seção sem derrubar
// o detalhe, com "Tentar novamente"; 404 igual ao detalhe; 401 pelo fluxo
// central. API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MENSAGEM_SEM_HISTORICO,
  historicoNaoEncontrado,
  mensagemErroHistorico,
  rotuloAcaoHistorico,
} from '../src/services/mensagensOcorrencias.js';
import { listarHistoricoOcorrencia } from '../src/services/ocorrencias.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_ERRO_HISTORICO = 'Não foi possível carregar o histórico agora.';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ID_USUARIO = 9;
const ID_RESPONSAVEL = 20;
const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };

const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 11, nome: 'Tutor Fictício A', perfil: 'TUTOR', status: 'ATIVO' },
  { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO', status: 'ATIVO' },
];

const PROVIDENCIA = Object.freeze({
  id: 400,
  descricao: 'Conversa fictícia com o estudante.',
  dataHora: '2026-10-31T12:00:00.000Z',
  registradoPor: { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia' },
});

const DETALHE = Object.freeze({
  id: 12,
  dataHora: '2026-10-30T12:39:00.000Z',
  local: 'Pátio fictício',
  turma: TURMA_6A,
  categoria: { id: 5, nome: 'Categoria Fictícia X' },
  descricao: 'Descrição fictícia do fato.',
  demaisEnvolvidos: null,
  testemunhas: null,
  providenciasImediatas: null,
  observacoes: null,
  status: 'EM_ACOMPANHAMENTO',
  dataEncerramento: null,
  profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
  responsavelAcompanhamento: { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia' },
  estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [PROVIDENCIA],
});

const DETALHE_ENCERRADO = Object.freeze({
  ...DETALHE,
  status: 'ENCERRADO',
  dataEncerramento: '2026-10-31T13:05:00.000Z',
});

// Do mais antigo para o mais novo (ordem da API). Horários em UTC: 12:39 UTC
// = 09:39 em São Paulo; 02:10 UTC do dia 31 = 23:10 do dia 30 em São Paulo.
const HISTORICO_INICIAL = Object.freeze([
  {
    id: 1,
    acao: 'ocorrência registrada',
    descricao: null,
    dataHora: '2026-10-30T12:39:00.000Z',
    usuario: { id: 30, nome: 'Professor Fictício' },
  },
  {
    id: 2,
    acao: 'encaminhamento registrado',
    descricao: 'Destinatário: equipe pedagógica',
    dataHora: '2026-10-30T12:40:00.000Z',
    usuario: { id: 30, nome: 'Professor Fictício' },
  },
  {
    id: 3,
    acao: 'status alterado',
    descricao: 'De aberto para em acompanhamento',
    dataHora: '2026-10-31T02:10:00.000Z',
    usuario: { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia' },
  },
]);

function comNovo(acao, descricao = null) {
  return [
    ...HISTORICO_INICIAL,
    {
      id: 10,
      acao,
      descricao,
      dataHora: '2026-10-31T13:30:00.000Z',
      usuario: { id: ID_USUARIO, nome: 'Pessoa Fictícia' },
    },
  ];
}

/**
 * Roteia o fetch mockado. `historico` recebe o número da chamada (0, 1, ...)
 * para simular a lista antes e depois de uma ação.
 */
function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE),
  historico = () => respostaFalsa(200, HISTORICO_INICIAL),
  encaminhar = () => respostaFalsa(201, DETALHE),
  comunicar = () => respostaFalsa(201, DETALHE),
  providencia = () => respostaFalsa(201, DETALHE),
  encerrar = () => respostaFalsa(200, DETALHE_ENCERRADO),
} = {}) {
  let chamadasHistorico = 0;
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method } = opcoes;
    if (method === 'GET' && url === `${URL_API}/usuarios`) return respostaFalsa(200, USUARIOS);
    if (method === 'GET' && /\/estudantes\?turmaId=\d+$/.test(url)) return respostaFalsa(200, []);
    if (method === 'POST' && url.endsWith('/encaminhamentos')) return encaminhar();
    if (method === 'POST' && url.endsWith('/comunicacoes')) return comunicar();
    if (method === 'POST' && url.endsWith('/providencias')) return providencia();
    if (method === 'PATCH' && url.endsWith('/status')) return encerrar();
    if (method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return historico(chamadasHistorico++);
    }
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (method === 'GET' && get) return detalhe(decodeURIComponent(get[1]));
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO', id = ID_USUARIO) {
  gravarSessaoFicticia({ usuario: { id, nome: 'Pessoa Fictícia', perfil } });
}

const getsHistorico = () =>
  fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'GET' && url.endsWith('/ocorrencias/12/historico'),
  );
const getsDetalhe = () =>
  fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'GET' && url.endsWith('/ocorrencias/12'),
  );

function secaoHistorico() {
  return screen.getByRole('region', { name: 'Histórico' });
}

/** Espera o detalhe carregar e devolve a seção "Histórico". */
function esperarSecao() {
  return screen.findByRole('region', { name: 'Histórico' });
}

/** Itens da lista do histórico, já carregados. */
async function itensHistorico(quantidade) {
  const lista = await within(await esperarSecao()).findByRole('list', {
    name: 'Alterações da ocorrência',
  });
  if (quantidade !== undefined) {
    await waitFor(() => expect(within(lista).getAllByRole('listitem')).toHaveLength(quantidade));
  }
  return within(lista).getAllByRole('listitem');
}

/** Valor (dd) do rótulo (dt) dentro de um item. */
function valorNoItem(item, rotulo) {
  return within(item).getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

describe('Histórico no detalhe da ocorrência (#85)', () => {
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

  describe('lista (RF12, RN08, RN17)', () => {
    it.each(PERFIS)('%s vê a seção "Histórico" do mais antigo para o mais novo', async (perfil) => {
      sessao(perfil);
      mockarApi();
      renderizarApp('/ocorrencias/12');

      const itens = await itensHistorico(3);
      expect(itens.map((i) => i.querySelector('.detalhe-ocorrencia__nome').textContent)).toEqual([
        'Ocorrência registrada',
        'Encaminhamento registrado',
        'Status alterado',
      ]);
      expect(getsHistorico()).toHaveLength(1);
      expect(fetch).toHaveBeenCalledWith(
        `${URL_API}/ocorrencias/12/historico`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('mostra data/hora em São Paulo, nome de quem fez e a descrição só quando houver', async () => {
      sessao('PROFESSOR');
      mockarApi();
      renderizarApp('/ocorrencias/12');

      const [registro, encaminhamento, status] = await itensHistorico(3);
      expect(valorNoItem(registro, 'Data e hora')).toHaveTextContent('30/10/2026 às 09:39');
      expect(valorNoItem(registro, 'Feito por')).toHaveTextContent('Professor Fictício');
      expect(within(registro).queryByText('Descrição', { selector: 'dt' })).not.toBeInTheDocument();

      expect(valorNoItem(encaminhamento, 'Descrição')).toHaveTextContent(
        'Destinatário: equipe pedagógica',
      );
      // 02:10 UTC do dia 31 ainda é dia 30 em São Paulo.
      expect(valorNoItem(status, 'Data e hora')).toHaveTextContent('30/10/2026 às 23:10');
      expect(valorNoItem(status, 'Feito por')).toHaveTextContent('Pedagoga Fictícia');
      expect(valorNoItem(status, 'Descrição')).toHaveTextContent('De aberto para em acompanhamento');
    });

    it('lista vazia mostra mensagem simples', async () => {
      sessao();
      mockarApi({ historico: () => respostaFalsa(200, []) });
      renderizarApp('/ocorrencias/12');
      expect(await within(await esperarSecao()).findByText(MENSAGEM_SEM_HISTORICO)).toBeInTheDocument();
    });

    it('mostra "Carregando o histórico..." enquanto a lista não chega, com o detalhe já visível', async () => {
      sessao();
      // A promessa nasce antes de renderizar: o `resolver` já existe mesmo que o
      // efeito do histórico rode depois do texto do detalhe aparecer.
      let resolver;
      const lenta = new Promise((r) => {
        resolver = r;
      });
      mockarApi({ historico: () => lenta });
      renderizarApp('/ocorrencias/12');

      expect(await screen.findByText('Pátio fictício')).toBeInTheDocument();
      expect(await within(secaoHistorico()).findByText('Carregando o histórico...')).toBeInTheDocument();
      await waitFor(() => expect(getsHistorico()).toHaveLength(1));
      resolver(respostaFalsa(200, HISTORICO_INICIAL));
      await itensHistorico(3);
      expect(screen.queryByText('Carregando o histórico...')).not.toBeInTheDocument();
    });
  });

  describe('atualização depois de cada ação, sem recarregar a página', () => {
    it('encaminhamento: o novo item aparece no fim da lista', async () => {
      sessao('GESTAO');
      mockarApi({
        historico: (n) =>
          respostaFalsa(200, n === 0 ? HISTORICO_INICIAL : comNovo('encaminhamento registrado', 'Destinatário: gestão')),
      });
      renderizarApp('/ocorrencias/12');
      await itensHistorico(3);

      await usuario.click(screen.getByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      await usuario.selectOptions(await within(dialogo).findByLabelText('Encaminhar para'), 'Gestão');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

      expect(await screen.findByText('Encaminhamento registrado.')).toBeInTheDocument();
      const itens = await itensHistorico(4);
      expect(valorNoItem(itens[3], 'Descrição')).toHaveTextContent('Destinatário: gestão');
      expect(valorNoItem(itens[3], 'Feito por')).toHaveTextContent('Pessoa Fictícia');
      expect(valorNoItem(itens[3], 'Data e hora')).toHaveTextContent('31/10/2026 às 10:30');
      expect(getsHistorico()).toHaveLength(2);
      // A página não recarregou: o detalhe veio da resposta do POST.
      expect(getsDetalhe()).toHaveLength(1);
    });

    it('comunicação: a lista é buscada de novo', async () => {
      sessao('TUTOR', ID_RESPONSAVEL);
      mockarApi({
        historico: (n) => respostaFalsa(200, n === 0 ? HISTORICO_INICIAL : comNovo('comunicação registrada')),
      });
      renderizarApp('/ocorrencias/12');
      await itensHistorico(3);

      await usuario.click(screen.getByRole('button', { name: 'Registrar comunicação' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Registrar comunicação' });
      await usuario.type(within(dialogo).getByLabelText('Destinatário'), 'Responsável fictício');
      await usuario.type(within(dialogo).getByLabelText('Meio'), 'Telefone');
      await usuario.type(within(dialogo).getByLabelText('Descrição'), 'Contato fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));

      expect(await screen.findByText('Comunicação registrada.')).toBeInTheDocument();
      const itens = await itensHistorico(4);
      expect(itens[3]).toHaveTextContent('Comunicação registrada');
      expect(getsDetalhe()).toHaveLength(1);
    });

    it('providência e depois encerramento: a lista é atualizada após cada um', async () => {
      sessao('PEDAGOGICO');
      const respostas = [
        HISTORICO_INICIAL,
        comNovo('providência registrada'),
        [
          ...comNovo('providência registrada'),
          {
            id: 11,
            acao: 'status alterado',
            descricao: 'De em acompanhamento para encerrado',
            dataHora: '2026-10-31T13:35:00.000Z',
            usuario: { id: ID_USUARIO, nome: 'Pessoa Fictícia' },
          },
        ],
      ];
      mockarApi({ historico: (n) => respostaFalsa(200, respostas[Math.min(n, 2)]) });
      renderizarApp('/ocorrencias/12');
      await itensHistorico(3);

      await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Registrar providência' });
      await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), 'Texto fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));

      expect(await screen.findByText('Providência registrada.')).toBeInTheDocument();
      let itens = await itensHistorico(4);
      expect(itens[3]).toHaveTextContent('Providência registrada');

      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      const confirmacao = await screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' });
      await usuario.click(within(confirmacao).getByRole('button', { name: 'Encerrar ocorrência' }));

      expect(await screen.findByText('Ocorrência encerrada.')).toBeInTheDocument();
      itens = await itensHistorico(5);
      expect(valorNoItem(itens[4], 'Descrição')).toHaveTextContent(
        'De em acompanhamento para encerrado',
      );
      expect(getsHistorico()).toHaveLength(3);
      expect(getsDetalhe()).toHaveLength(1);
      // Encerrada: sem ações, mas o histórico continua visível.
      expect(screen.queryByRole('button', { name: 'Encerrar ocorrência' })).not.toBeInTheDocument();
      expect(secaoHistorico()).toBeInTheDocument();
    });
  });

  describe('erros', () => {
    it('falha não derruba o detalhe e "Tentar novamente" carrega a lista', async () => {
      sessao('TECNICO_ADMINISTRATIVO');
      mockarApi({
        historico: (n) =>
          n === 0 ? respostaFalsa(500, { erro: 'Erro interno.' }) : respostaFalsa(200, HISTORICO_INICIAL),
      });
      renderizarApp('/ocorrencias/12');

      const alerta = await within(await esperarSecao()).findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_ERRO_HISTORICO);
      // O resto do detalhe continua na tela.
      expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toBeInTheDocument();
      expect(screen.getByText('Pátio fictício')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Providências adotadas' })).toBeInTheDocument();

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      await itensHistorico(3);
      expect(within(secaoHistorico()).queryByRole('alert')).not.toBeInTheDocument();
      expect(getsHistorico()).toHaveLength(2);
      expect(getsDetalhe()).toHaveLength(1);
    });

    it('sem conexão: mensagem de conexão na seção, detalhe visível', async () => {
      sessao();
      mockarApi({
        historico: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      renderizarApp('/ocorrencias/12');
      const alerta = await within(await esperarSecao()).findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
      expect(screen.getByText('Pátio fictício')).toBeInTheDocument();
    });

    it('404: mesma tela de "não encontrada" do detalhe, sem "Tentar novamente"', async () => {
      sessao('PROFESSOR');
      mockarApi({ historico: () => respostaFalsa(404, { erro: MSG_NAO_ENCONTRADA }) });
      renderizarApp('/ocorrencias/12');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_NAO_ENCONTRADA);
      expect(alerta).toHaveTextContent('Confira se o endereço está correto');
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
      expect(screen.queryByText('Pátio fictício')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Histórico' })).not.toBeInTheDocument();
    });

    it('detalhe 404: a tela "não encontrada" não busca o histórico', async () => {
      sessao();
      mockarApi({ detalhe: () => respostaFalsa(404, { erro: MSG_NAO_ENCONTRADA }) });
      renderizarApp('/ocorrencias/12');
      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
      expect(getsHistorico()).toHaveLength(0);
    });

    it('401: tratamento central leva ao login com aviso', async () => {
      sessao();
      mockarApi({ historico: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      renderizarApp('/ocorrencias/12');
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(screen.queryByText(MSG_ERRO_HISTORICO)).not.toBeInTheDocument();
    });
  });

  describe('services', () => {
    it('listarHistoricoOcorrencia chama a rota com o id codificado', async () => {
      sessao();
      fetch.mockResolvedValue(respostaFalsa(200, HISTORICO_INICIAL));
      await expect(listarHistoricoOcorrencia('1 2')).resolves.toEqual(HISTORICO_INICIAL);
      expect(fetch).toHaveBeenCalledWith(
        `${URL_API}/ocorrencias/1%202/historico`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('listarHistoricoOcorrencia devolve lista vazia quando a resposta não é lista', async () => {
      sessao();
      fetch.mockResolvedValue(respostaFalsa(200, { inesperado: true }));
      await expect(listarHistoricoOcorrencia(12)).resolves.toEqual([]);
    });

    it('rótulo da ação, 404/400 e mensagens de erro', () => {
      expect(rotuloAcaoHistorico('ocorrência registrada')).toBe('Ocorrência registrada');
      expect(rotuloAcaoHistorico('')).toBe('');
      expect(rotuloAcaoHistorico(null)).toBe('');
      expect(historicoNaoEncontrado({ status: 404 })).toBe(true);
      expect(historicoNaoEncontrado({ status: 400 })).toBe(true);
      expect(historicoNaoEncontrado({ status: 500 })).toBe(false);
      expect(mensagemErroHistorico({ status: 0 })).toBe(MSG_SEM_CONEXAO);
      expect(mensagemErroHistorico({ status: 403 })).toBe(MSG_SEM_PERMISSAO);
      expect(mensagemErroHistorico({ status: 500 })).toBe(MSG_ERRO_HISTORICO);
    });
  });
});
