// Testes complementares do QA para a Issue #85 — seção "Histórico" no detalhe
// (RF12, RN08, RN17, RN19). Cobrem lacunas de Historico.test.jsx: ocorrência
// encerrada carregada direto com todas as ações reais da API, ordem da API
// mantida no empate de horário, resposta atrasada que não sobrescreve a lista
// nova, falha na recarga depois de uma ação, 403/400 na seção, ação que falha
// não recarrega o histórico, conflito (409) recarrega o histórico e campos
// ausentes. Respostas no formato exato de GET /ocorrencias/{id}/historico:
// { id, acao, descricao, dataHora, usuario: { id, nome } }.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_ERRO_HISTORICO = 'Não foi possível carregar o histórico agora.';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ID_USUARIO = 9;
const ID_PEDAGOGA = 20;
const TURMA = { id: 1, nome: '7º B', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 };
const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO', status: 'ATIVO' },
  { id: ID_PEDAGOGA, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO', status: 'ATIVO' },
];

const DETALHE = Object.freeze({
  id: 12,
  dataHora: '2026-10-30T12:39:00.000Z',
  local: 'Quadra fictícia',
  turma: TURMA,
  categoria: { id: 5, nome: 'Categoria Fictícia Y' },
  descricao: 'Descrição fictícia do fato.',
  demaisEnvolvidos: null,
  testemunhas: null,
  providenciasImediatas: null,
  observacoes: null,
  status: 'EM_ACOMPANHAMENTO',
  dataEncerramento: null,
  profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
  responsavelAcompanhamento: { id: ID_PEDAGOGA, nome: 'Pedagoga Fictícia' },
  estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício B', turma: TURMA }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [
    {
      id: 400,
      descricao: 'Conversa fictícia.',
      dataHora: '2026-10-31T12:00:00.000Z',
      registradoPor: { id: ID_PEDAGOGA, nome: 'Pedagoga Fictícia' },
    },
  ],
});

const DETALHE_ENCERRADO = Object.freeze({
  ...DETALHE,
  status: 'ENCERRADO',
  dataEncerramento: '2026-10-31T13:05:00.000Z',
});

const item = (id, acao, descricao, dataHora, usuario) => ({ id, acao, descricao, dataHora, usuario });
const PROFESSOR = { id: 30, nome: 'Professor Fictício' };
const PEDAGOGA = { id: ID_PEDAGOGA, nome: 'Pedagoga Fictícia' };

// Histórico completo de uma ocorrência encerrada, com as ações e descrições
// exatas que o back-end grava (ACOES_HISTORICO). Os 2 primeiros têm o mesmo
// horário (mesma transação do registro).
const HISTORICO_ENCERRADA = Object.freeze([
  item(1, 'ocorrência registrada', null, '2026-10-30T12:39:00.000Z', PROFESSOR),
  item(2, 'encaminhamento registrado', 'Destinatário: equipe pedagógica', '2026-10-30T12:39:00.000Z', PROFESSOR),
  item(3, 'encaminhamento registrado', 'Destinatário: tutor', '2026-10-30T14:00:00.000Z', PEDAGOGA),
  item(4, 'status alterado', 'De aberto para em acompanhamento', '2026-10-30T14:00:00.000Z', PEDAGOGA),
  item(5, 'responsável pelo acompanhamento definido', null, '2026-10-30T14:00:00.000Z', PEDAGOGA),
  item(6, 'comunicação registrada', null, '2026-10-31T11:00:00.000Z', PEDAGOGA),
  item(7, 'providência registrada', null, '2026-10-31T12:00:00.000Z', PEDAGOGA),
  item(8, 'status alterado', 'De em acompanhamento para encerrado', '2026-10-31T13:05:00.000Z', PEDAGOGA),
]);

const HISTORICO_CURTO = Object.freeze(HISTORICO_ENCERRADA.slice(0, 2));

function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE),
  historico = () => respostaFalsa(200, HISTORICO_CURTO),
  encaminhar = () => respostaFalsa(201, DETALHE),
  providencia = () => respostaFalsa(201, DETALHE),
  encerrar = () => respostaFalsa(200, DETALHE_ENCERRADO),
} = {}) {
  let n = 0;
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method } = opcoes;
    if (method === 'GET' && url === `${URL_API}/usuarios`) return respostaFalsa(200, USUARIOS);
    if (method === 'GET' && /\/estudantes\?turmaId=\d+$/.test(url)) return respostaFalsa(200, []);
    if (method === 'POST' && url.endsWith('/encaminhamentos')) return encaminhar();
    if (method === 'POST' && url.endsWith('/providencias')) return providencia();
    if (method === 'PATCH' && url.endsWith('/status')) return encerrar();
    if (method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) return historico(n++);
    if (method === 'GET' && /\/ocorrencias\/[^/]+$/.test(url)) return detalhe();
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO', id = ID_USUARIO) {
  gravarSessaoFicticia({ usuario: { id, nome: 'Pessoa Fictícia', perfil } });
}

const getsHistorico = () =>
  fetch.mock.calls.filter(([url, o = {}]) => o.method === 'GET' && url.endsWith('/historico'));

const secao = () => screen.findByRole('region', { name: 'Histórico' });

async function itens(quantidade) {
  const lista = await within(await secao()).findByRole('list', { name: 'Alterações da ocorrência' });
  await waitFor(() => expect(within(lista).getAllByRole('listitem')).toHaveLength(quantidade));
  return within(lista).getAllByRole('listitem');
}

const acao = (li) => li.querySelector('.detalhe-ocorrencia__nome').textContent;
const valor = (li, rotulo) => within(li).queryByText(rotulo, { selector: 'dt' })?.nextElementSibling ?? null;

async function encaminharParaGestao(usuario) {
  await usuario.click(screen.getByRole('button', { name: 'Encaminhar' }));
  const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
  await usuario.selectOptions(await within(dialogo).findByLabelText('Encaminhar para'), 'Gestão');
  await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));
}

describe('Histórico no detalhe — complementar do QA (#85)', () => {
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

  it.each(PERFIS)(
    '%s: ocorrência encerrada mostra o histórico completo na ordem da API, sem botões de ação',
    async (perfil) => {
      sessao(perfil);
      mockarApi({
        detalhe: () => respostaFalsa(200, DETALHE_ENCERRADO),
        historico: () => respostaFalsa(200, HISTORICO_ENCERRADA),
      });
      renderizarApp('/ocorrencias/12');

      const lis = await itens(8);
      expect(lis.map(acao)).toEqual([
        'Ocorrência registrada',
        'Encaminhamento registrado',
        'Encaminhamento registrado',
        'Status alterado',
        'Responsável pelo acompanhamento definido',
        'Comunicação registrada',
        'Providência registrada',
        'Status alterado',
      ]);
      // Empate de horário (mesma transação): mantém a ordem recebida (id 1, depois 2).
      expect(valor(lis[0], 'Data e hora')).toHaveTextContent('30/10/2026 às 09:39');
      expect(valor(lis[1], 'Data e hora')).toHaveTextContent('30/10/2026 às 09:39');
      expect(valor(lis[1], 'Descrição')).toHaveTextContent('Destinatário: equipe pedagógica');
      // Providência e comunicação: descrição nula não aparece (RN08: sem conteúdo).
      expect(valor(lis[5], 'Descrição')).toBeNull();
      expect(valor(lis[6], 'Descrição')).toBeNull();
      expect(lis[6]).not.toHaveTextContent('Conversa fictícia.');
      expect(valor(lis[6], 'Feito por')).toHaveTextContent('Pedagoga Fictícia');
      expect(valor(lis[7], 'Descrição')).toHaveTextContent('De em acompanhamento para encerrado');
      expect(valor(lis[7], 'Data e hora')).toHaveTextContent('31/10/2026 às 10:05');
      expect(
        screen.queryByRole('region', { name: 'Ações sobre a ocorrência' }),
      ).not.toBeInTheDocument();
    },
  );

  it('não reordena: exibe exatamente a ordem devolvida pela API', async () => {
    sessao();
    const foraDeOrdemDeId = [
      item(50, 'ocorrência registrada', null, '2026-10-30T12:00:00.000Z', PROFESSOR),
      item(7, 'comunicação registrada', null, '2026-10-30T12:00:00.000Z', PEDAGOGA),
    ];
    mockarApi({ historico: () => respostaFalsa(200, foraDeOrdemDeId) });
    renderizarApp('/ocorrencias/12');
    const lis = await itens(2);
    expect(lis.map(acao)).toEqual(['Ocorrência registrada', 'Comunicação registrada']);
  });

  it('resposta atrasada da busca inicial não sobrescreve a lista recarregada depois da ação', async () => {
    sessao('GESTAO');
    let liberarInicial;
    const depois = [
      ...HISTORICO_CURTO,
      item(10, 'encaminhamento registrado', 'Destinatário: gestão', '2026-10-31T13:30:00.000Z', {
        id: ID_USUARIO,
        nome: 'Pessoa Fictícia',
      }),
    ];
    mockarApi({
      historico: (n) =>
        n === 0 ? new Promise((r) => { liberarInicial = r; }) : respostaFalsa(200, depois),
    });
    renderizarApp('/ocorrencias/12');
    await screen.findByText('Quadra fictícia');

    await encaminharParaGestao(usuario);
    expect(await screen.findByText('Encaminhamento registrado.')).toBeInTheDocument();
    await itens(3);

    // A busca inicial chega só agora, com a lista antiga: deve ser ignorada.
    liberarInicial(respostaFalsa(200, HISTORICO_CURTO));
    await new Promise((r) => setTimeout(r, 50));
    const lis = await itens(3);
    expect(valor(lis[2], 'Descrição')).toHaveTextContent('Destinatário: gestão');
    expect(getsHistorico()).toHaveLength(2);
  });

  it('falha na recarga depois de uma ação: detalhe e confirmação ficam; "Tentar novamente" traz o novo item', async () => {
    sessao('PEDAGOGICO');
    const respostas = [
      () => respostaFalsa(200, HISTORICO_CURTO),
      () => respostaFalsa(500, { erro: 'Erro interno.' }),
      () => respostaFalsa(200, [...HISTORICO_CURTO, HISTORICO_ENCERRADA[6]]),
    ];
    mockarApi({ historico: (n) => respostas[Math.min(n, 2)]() });
    renderizarApp('/ocorrencias/12');
    await itens(2);

    await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Registrar providência' });
    await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), 'Texto fictício.');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));

    expect(await screen.findByText('Providência registrada.')).toBeInTheDocument();
    const alerta = await within(await secao()).findByRole('alert');
    expect(alerta).toHaveTextContent(MSG_ERRO_HISTORICO);
    expect(screen.getByText('Quadra fictícia')).toBeInTheDocument();
    expect(screen.getByText('Providência registrada.')).toBeInTheDocument();

    await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    const lis = await itens(3);
    expect(acao(lis[2])).toBe('Providência registrada');
    expect(getsHistorico()).toHaveLength(3);
  });

  it('403 no histórico: mensagem de permissão só na seção, detalhe visível', async () => {
    sessao('PROFESSOR');
    mockarApi({ historico: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
    renderizarApp('/ocorrencias/12');
    const alerta = await within(await secao()).findByRole('alert');
    expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
    expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toBeInTheDocument();
  });

  it('400 no histórico: mesma tela de "não encontrada" do detalhe', async () => {
    sessao();
    mockarApi({ historico: () => respostaFalsa(400, { erro: 'Id inválido.' }) });
    renderizarApp('/ocorrencias/12');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Confira se o endereço está correto');
    expect(screen.queryByText('Quadra fictícia')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
  });

  it('404 no histórico depois de uma ação: tela de "não encontrada", sem diálogo nem confirmação', async () => {
    sessao('GESTAO');
    mockarApi({
      historico: (n) =>
        n === 0 ? respostaFalsa(200, HISTORICO_CURTO) : respostaFalsa(404, { erro: MSG_NAO_ENCONTRADA }),
    });
    renderizarApp('/ocorrencias/12');
    await itens(2);
    await encaminharParaGestao(usuario);
    const alerta = await screen.findByText(/Confira se o endereço está correto/);
    expect(alerta).toBeInTheDocument();
    expect(screen.getByText(MSG_NAO_ENCONTRADA)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Encaminhamento registrado.')).not.toBeInTheDocument();
  });

  it('401 na recarga depois de uma ação: fluxo de sessão expirada', async () => {
    sessao('GESTAO');
    mockarApi({
      historico: (n) =>
        n === 0 ? respostaFalsa(200, HISTORICO_CURTO) : respostaFalsa(401, { erro: 'Não autenticado.' }),
    });
    renderizarApp('/ocorrencias/12');
    await itens(2);
    await encaminharParaGestao(usuario);
    expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
    expect(screen.queryByText(MSG_ERRO_HISTORICO)).not.toBeInTheDocument();
  });

  it('ação que falha (400) não recarrega o histórico', async () => {
    sessao('GESTAO');
    mockarApi({ encaminhar: () => respostaFalsa(400, { erro: 'Dados inválidos.' }) });
    renderizarApp('/ocorrencias/12');
    await itens(2);
    await encaminharParaGestao(usuario);
    expect(await screen.findByText('Dados inválidos.')).toBeInTheDocument();
    expect(getsHistorico()).toHaveLength(1);
    await itens(2);
  });

  it('409 no encerramento + "Atualizar a ocorrência": o histórico também é buscado de novo', async () => {
    sessao('PEDAGOGICO');
    let consultas = 0;
    mockarApi({
      detalhe: () => respostaFalsa(200, ++consultas === 1 ? DETALHE : DETALHE_ENCERRADO),
      historico: (n) => respostaFalsa(200, n === 0 ? HISTORICO_CURTO : HISTORICO_ENCERRADA),
      encerrar: () => respostaFalsa(409, { erro: 'A ocorrência já foi encerrada.', codigo: 'OCORRENCIA_ENCERRADA' }),
    });
    renderizarApp('/ocorrencias/12');
    await itens(2);

    await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
    const confirmacao = await screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' });
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Encerrar ocorrência' }));
    const alerta = await screen.findByText('A ocorrência já foi encerrada.');
    await usuario.click(
      within(alerta.closest('[role="alert"]')).getByRole('button', { name: 'Atualizar a ocorrência' }),
    );

    const lis = await itens(8);
    expect(valor(lis[7], 'Descrição')).toHaveTextContent('De em acompanhamento para encerrado');
    expect(getsHistorico()).toHaveLength(2);
  });

  it('campos ausentes ou vazios: "Não informado" e descrição só com espaços não aparece', async () => {
    sessao();
    mockarApi({
      historico: () =>
        respostaFalsa(200, [
          { id: 1, acao: '', descricao: '   ', dataHora: 'data-invalida', usuario: null },
        ]),
    });
    renderizarApp('/ocorrencias/12');
    const [li] = await itens(1);
    expect(acao(li)).toBe('Não informado');
    expect(valor(li, 'Data e hora')).toHaveTextContent('Não informado');
    expect(valor(li, 'Feito por')).toHaveTextContent('Não informado');
    expect(valor(li, 'Descrição')).toBeNull();
  });
});
