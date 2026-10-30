// Testes complementares da Issue #46 (QA) — tela de registro de ocorrência
// (UC01, RF05, RF06, RN02, RN03, RN06, RN14, RN17, RNF02): troca da turma da
// ocorrência depois de escolher estudantes, filtro de turma, erros ao carregar
// estudantes, linhas de destinatário (remoção, renumeração, troca de tipo,
// limite de 10), tutores sugeridos, erros 409/500/401, campos opcionais só com
// espaços, datas na virada de dia/mês/ano em São Paulo e acessibilidade.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MAXIMO_ESTUDANTES,
  montarEnvio,
  validarRegistro,
} from '../src/services/mensagensOcorrencias.js';
import {
  CHAVE_SESSAO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
// 30/10/2026 08:00 em São Paulo (UTC-03:00).
const AGORA = new Date('2026-10-30T11:00:00.000Z');

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_ESTUDANTES = 'Selecione ao menos um estudante envolvido.';
const MSG_TUTOR = 'Escolha o tutor que vai receber a ocorrência.';
const MSG_DATA_FUTURA =
  'A data e a hora não podem estar no futuro. Informe quando o fato aconteceu.';
const MSG_REVISAR = 'Confira os campos destacados antes de enviar.';
const MSG_CATEGORIA = 'Selecione a categoria da ocorrência.';
const MSG_LOCAL = 'Informe o local onde o fato aconteceu.';
const MSG_REPETIDO_1 = 'Este destinatário repete o destinatário 1. Remova um deles.';
const MSG_GENERICA_REGISTRAR =
  'Não foi possível registrar a ocorrência agora. Tente novamente em instantes.';
const MSG_GENERICA_ESTUDANTES = 'Não foi possível carregar os estudantes desta turma agora.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_8C = { id: 3, nome: '8º C', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_8C = '8º C — Ensino Fundamental - Anos Finais (2026)';
const TURMAS_FICTICIAS = [TURMA_6A, TURMA_7B, TURMA_8C];

const CATEGORIAS_FICTICIAS = [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }];

const USUARIOS_FICTICIOS = [
  { id: 1, nome: 'Gestora Fictícia', email: 'g@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 20, nome: 'Pedagoga Fictícia', email: 'p@exemplo.test', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício A', email: 't1@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 11, nome: 'Tutora Fictícia B', email: 't2@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 13, nome: 'Tutora Fictícia C', email: 't4@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];

const ESTUDANTES_FICTICIOS = [
  { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: { id: 11, nome: 'Tutora Fictícia B' } },
  { id: 2, nomeCompleto: 'Estudante Fictício B', turma: TURMA_6A, tutor: null },
  { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B, tutor: { id: 13, nome: 'Tutora Fictícia C' } },
];

/**
 * GETs de apoio com os dados fictícios. `estudantes(turmaId)` permite trocar
 * a resposta de GET /estudantes?turmaId=; POST /ocorrencias chama `aoRegistrar`.
 */
function mockarApi({ usuarios = USUARIOS_FICTICIOS, estudantes, aoRegistrar } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) {
      return respostaFalsa(200, TURMAS_FICTICIAS);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/categorias`) {
      return respostaFalsa(200, CATEGORIAS_FICTICIAS);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/usuarios`) {
      return respostaFalsa(200, usuarios);
    }
    const get = url.match(/\/estudantes\?turmaId=(\d+)$/);
    if (opcoes.method === 'GET' && get) {
      const turmaId = Number(get[1]);
      if (estudantes) return estudantes(turmaId);
      return respostaFalsa(200, ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === turmaId));
    }
    if (opcoes.method === 'POST' && url === `${URL_API}/ocorrencias` && aoRegistrar) {
      return aoRegistrar(JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadasPost() {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === 'POST');
}

function corpoDoPost(indice = 0) {
  return JSON.parse(chamadasPost()[indice][1].body);
}

async function abrirPagina() {
  renderizarApp('/ocorrencias/nova');
  await screen.findByRole('button', { name: 'Registrar ocorrência' });
}

function campos() {
  return {
    turma: screen.getByLabelText('Turma da ocorrência'),
    filtro: screen.getByLabelText('Mostrar estudantes da turma'),
    categoria: screen.getByLabelText('Categoria'),
    descricao: screen.getByLabelText('Descrição do fato'),
    dataHora: screen.getByLabelText('Data e hora do fato'),
    local: screen.getByLabelText('Local'),
    demaisEnvolvidos: screen.getByLabelText('Demais envolvidos (opcional)'),
    testemunhas: screen.getByLabelText('Testemunhas (opcional)'),
    providencias: screen.getByLabelText('Providências imediatas (opcional)'),
    observacoes: screen.getByLabelText('Observações (opcional)'),
    enviar: screen.getByRole('button', { name: 'Registrar ocorrência' }),
  };
}

function destinatario(posicao) {
  const grupo = screen.getByRole('group', { name: `Destinatário ${posicao}` });
  return {
    grupo,
    tipo: within(grupo).getByLabelText('Encaminhar para'),
    usuario: () =>
      within(grupo).queryByLabelText('Tutor que vai receber') ??
      within(grupo).getByLabelText('Pessoa da equipe (opcional)'),
    observacao: within(grupo).getByLabelText('Observação para o destinatário (opcional)'),
  };
}

async function marcarEstudante(usuario, nome) {
  await usuario.click(await screen.findByRole('checkbox', { name: nome }));
}

function nomesSelecionados() {
  const lista = screen.queryByRole('list', { name: /Estudantes envolvidos/ });
  if (!lista) return [];
  return within(lista)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.selecao-estudantes__nome').textContent);
}

async function preencherValido(usuario) {
  const c = campos();
  await usuario.selectOptions(c.turma, ROTULO_6A);
  await marcarEstudante(usuario, 'Estudante Fictício A');
  await usuario.selectOptions(c.categoria, 'Categoria Fictícia X');
  await usuario.type(c.descricao, 'Descrição fictícia do fato.');
  await usuario.type(c.local, 'Pátio');
  await usuario.selectOptions(destinatario(1).tipo, 'Equipe pedagógica');
  return c;
}

describe('Tela de registro de ocorrência — testes complementares de QA (#46)', () => {
  let usuario;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('turma da ocorrência e estudantes (RN14)', () => {
    it('trocar a turma da ocorrência depois de escolher estudantes mantém os escolhidos e grava a nova turma', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 7 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await marcarEstudante(usuario, 'Estudante Fictício B');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A', 'Estudante Fictício B']);

      // O filtro acompanha (ainda não foi trocado à mão), mas os escolhidos ficam.
      await usuario.selectOptions(c.turma, ROTULO_7B);
      expect(c.filtro).toHaveValue('2');
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício C' })).toBeInTheDocument();
      expect(nomesSelecionados()).toEqual([
        `Estudante Fictício A (turma ${ROTULO_6A})`,
        `Estudante Fictício B (turma ${ROTULO_6A})`,
      ]);

      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().turmaId).toBe(2);
      expect(corpoDoPost().estudanteIds).toEqual([1, 2]);
    });

    it('voltar a turma da ocorrência para "Selecione" limpa o filtro, mas não os escolhidos', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');

      await usuario.selectOptions(c.turma, 'Selecione a turma');

      expect(c.filtro).toHaveValue('');
      expect(screen.getByText('Selecione uma turma acima para ver os estudantes.')).toBeInTheDocument();
      // Sem turma da ocorrência, nenhum estudante é marcado como "de outra turma".
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);
    });

    it('estudante escolhido que some da lista ao trocar o filtro continua em "Estudantes envolvidos" e pode ser removido', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');

      await usuario.selectOptions(c.filtro, ROTULO_7B);
      await screen.findByRole('checkbox', { name: 'Estudante Fictício C' });
      expect(screen.queryByRole('checkbox', { name: 'Estudante Fictício A' })).not.toBeInTheDocument();
      expect(c.turma).toHaveValue('1');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);

      await usuario.click(screen.getByRole('button', { name: 'Remover Estudante Fictício A' }));
      expect(nomesSelecionados()).toEqual([]);
      expect(screen.getByText('Nenhum estudante selecionado.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Estudantes envolvidos (0)' })).toBeInTheDocument();
    });

    it('turma sem estudantes mostra aviso claro', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();

      await usuario.selectOptions(campos().turma, ROTULO_8C);

      expect(await screen.findByText('Nenhum estudante cadastrado nesta turma.')).toBeInTheDocument();
    });

    it('erro ao carregar os estudantes da turma: mensagem, "Tentar novamente" e escolhidos preservados', async () => {
      gravarSessaoFicticia();
      let falharTurma2 = true;
      mockarApi({
        estudantes: (turmaId) => {
          if (turmaId === 2 && falharTurma2) return respostaFalsa(500, { erro: 'Erro interno.' });
          return respostaFalsa(200, ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === turmaId));
        },
      });
      await abrirPagina();
      const c = campos();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');

      await usuario.selectOptions(c.filtro, ROTULO_7B);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_GENERICA_ESTUDANTES);
      expect(alerta).not.toHaveTextContent('Erro interno.');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);

      falharTurma2 = false;
      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício C' })).toBeInTheDocument();
      expect(screen.queryByText(MSG_GENERICA_ESTUDANTES)).not.toBeInTheDocument();
    });

    it('403 ao carregar os estudantes mostra a mensagem de perfil sem permissão', async () => {
      gravarSessaoFicticia();
      mockarApi({ estudantes: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
      await abrirPagina();

      await usuario.selectOptions(campos().turma, ROTULO_6A);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('resposta atrasada de um filtro anterior não substitui a lista da turma atual', async () => {
      gravarSessaoFicticia();
      let responderTurma1;
      mockarApi({
        estudantes: (turmaId) =>
          turmaId === 1
            ? new Promise((resolve) => (responderTurma1 = resolve))
            : respostaFalsa(200, ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === turmaId)),
      });
      await abrirPagina();
      const c = campos();

      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.selectOptions(c.filtro, ROTULO_7B);
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício C' })).toBeInTheDocument();

      responderTurma1(respostaFalsa(200, ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === 1)));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByRole('checkbox', { name: 'Estudante Fictício C' })).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Estudante Fictício A' })).not.toBeInTheDocument();
    });
  });

  describe('destinatários (RN03)', () => {
    it('remover a linha do meio renumera as demais e preserva o que foi escolhido', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const adicionar = () => usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));

      await usuario.selectOptions(destinatario(1).tipo, 'Equipe pedagógica');
      await adicionar();
      await usuario.selectOptions(destinatario(2).tipo, 'Tutor');
      await adicionar();
      await usuario.selectOptions(destinatario(3).tipo, 'Gestão');
      await usuario.type(destinatario(3).observacao, 'Observação fictícia 3');

      await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 2' }));

      expect(screen.queryByRole('group', { name: 'Destinatário 3' })).not.toBeInTheDocument();
      expect(destinatario(1).tipo).toHaveValue('EQUIPE_PEDAGOGICA');
      expect(destinatario(2).tipo).toHaveValue('GESTAO');
      expect(destinatario(2).observacao).toHaveValue('Observação fictícia 3');
      expect(screen.getByRole('button', { name: 'Remover destinatário 2' })).toBeInTheDocument();
    });

    it('remover a linha com erro de "Tutor sem usuário" tira a mensagem e permite enviar', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 8 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Tutor');

      await usuario.click(c.enviar);
      expect(screen.getByText(MSG_TUTOR)).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 2' }));
      expect(screen.queryByText(MSG_TUTOR)).not.toBeInTheDocument();

      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().encaminhamentos).toEqual([
        { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: null, observacao: null },
      ]);
    });

    // Regressão (achado do QA): ao remover a linha original de um par repetido,
    // a mensagem "repete o destinatário 1" não pode ficar na linha que sobrou.
    it('remover a linha original de um par repetido tira a mensagem de repetido da outra', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 9 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Equipe pedagógica');
      await usuario.click(c.enviar);
      expect(within(destinatario(2).grupo).getByText(MSG_REPETIDO_1)).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 1' }));

      expect(screen.queryByRole('group', { name: 'Destinatário 2' })).not.toBeInTheDocument();
      expect(screen.queryByText(MSG_REPETIDO_1)).not.toBeInTheDocument();
    });

    it('trocar o tipo do destinatário limpa o usuário escolhido', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      await usuario.selectOptions(destinatario(1).usuario(), 'Tutor Fictício A');
      expect(destinatario(1).usuario()).toHaveValue('10');

      await usuario.selectOptions(destinatario(1).tipo, 'Gestão');
      expect(within(destinatario(1).grupo).queryByLabelText('Tutor que vai receber')).not.toBeInTheDocument();
      expect(destinatario(1).usuario()).toHaveValue('');
      await usuario.selectOptions(destinatario(1).usuario(), 'Gestora Fictícia');

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      expect(destinatario(1).usuario()).toHaveValue('');

      await usuario.selectOptions(destinatario(1).tipo, 'Selecione');
      expect(within(destinatario(1).grupo).queryByLabelText('Tutor que vai receber')).not.toBeInTheDocument();
      expect(
        within(destinatario(1).grupo).queryByLabelText('Pessoa da equipe (opcional)'),
      ).not.toBeInTheDocument();
    });

    it('tutor de estudante removido sai do grupo sugerido; o tutor já escolhido continua selecionado', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A'); // Tutora B
      await usuario.selectOptions(c.filtro, ROTULO_7B);
      await marcarEstudante(usuario, 'Estudante Fictício C'); // Tutora C
      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      await usuario.selectOptions(destinatario(1).usuario(), 'Tutora Fictícia C');

      const textos = (grupo) => [...grupo.querySelectorAll('option')].map((o) => o.textContent);
      let grupos = destinatario(1).usuario().querySelectorAll('optgroup');
      expect(textos(grupos[0])).toEqual(['Tutora Fictícia B', 'Tutora Fictícia C']);

      await usuario.click(screen.getByRole('button', { name: 'Remover Estudante Fictício C' }));

      grupos = destinatario(1).usuario().querySelectorAll('optgroup');
      expect([...grupos].map((g) => g.label)).toEqual([
        'Tutores dos estudantes selecionados',
        'Outros tutores',
      ]);
      expect(textos(grupos[0])).toEqual(['Tutora Fictícia B']);
      expect(textos(grupos[1])).toEqual(['Tutor Fictício A', 'Tutora Fictícia C']);
      expect(destinatario(1).usuario()).toHaveValue('13');

      // Sem estudantes com tutor, um único grupo "Tutores".
      await usuario.click(screen.getByRole('button', { name: 'Remover Estudante Fictício A' }));
      grupos = destinatario(1).usuario().querySelectorAll('optgroup');
      expect([...grupos].map((g) => g.label)).toEqual(['Tutores']);
    });

    it('sem tutores ativos, o seletor de Tutor orienta a escolher outro destinatário', async () => {
      gravarSessaoFicticia();
      mockarApi({ usuarios: USUARIOS_FICTICIOS.filter((u) => u.perfil !== 'TUTOR') });
      await abrirPagina();

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');

      expect(destinatario(1).usuario()).toHaveAccessibleDescription(
        'Obrigatório. Nenhum tutor ativo cadastrado: escolha outro destinatário.',
      );
      expect(within(destinatario(1).usuario()).getAllByRole('option')).toHaveLength(1);
    });

    it('limite de 10 destinatários: o botão some no 10º e volta ao remover um', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();

      for (let i = 2; i <= 10; i += 1) {
        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      }

      expect(screen.getByRole('group', { name: 'Destinatário 10' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Adicionar destinatário' })).not.toBeInTheDocument();
      expect(screen.getByText('Limite de 10 destinatários atingido.')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 10' }));
      expect(screen.getByRole('button', { name: 'Adicionar destinatário' })).toBeInTheDocument();
      expect(screen.queryByText('Limite de 10 destinatários atingido.')).not.toBeInTheDocument();
    });
  });

  describe('envio e erros da API', () => {
    it('409: mostra a mensagem da API e mantém o formulário', async () => {
      gravarSessaoFicticia();
      const mensagem =
        'Não foi possível registrar a ocorrência por causa de outra operação ao mesmo tempo. Tente novamente.';
      mockarApi({ aoRegistrar: () => respostaFalsa(409, { erro: mensagem }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      expect(await screen.findByRole('alert')).toHaveTextContent(mensagem);
      expect(c.turma).toHaveValue('1');
      expect(c.categoria).toHaveValue('5');
      expect(c.local).toHaveValue('Pátio');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);
      expect(destinatario(1).tipo).toHaveValue('EQUIPE_PEDAGOGICA');
      expect(c.enviar).toBeEnabled();
    });

    it('500 sem corpo: mensagem genérica, sem detalhe técnico; editar um campo limpa o alerta', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(500) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);
      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_GENERICA_REGISTRAR);

      await usuario.type(c.local, ' externo');
      expect(screen.queryByText(MSG_GENERICA_REGISTRAR)).not.toBeInTheDocument();
    });

    it('400 com mensagem da API e depois sucesso no reenvio', async () => {
      gravarSessaoFicticia();
      let tentativa = 0;
      mockarApi({
        aoRegistrar: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(400, { erro: 'A categoria informada não existe.' })
            : respostaFalsa(201, { id: 15, status: 'ABERTO' });
        },
      });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);
      expect(await screen.findByRole('alert')).toHaveTextContent('A categoria informada não existe.');

      await usuario.click(c.enviar);
      expect(await screen.findByText('Ocorrência nº 15 registrada com sucesso.')).toBeInTheDocument();
      expect(screen.queryByText('A categoria informada não existe.')).not.toBeInTheDocument();
      expect(chamadasPost()).toHaveLength(2);
    });

    it('401 no envio volta ao login com aviso de sessão', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    });

    it('campos opcionais vazios ou só com espaços vão como null; textos são enviados sem espaços nas pontas', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 16 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.clear(c.local);
      await usuario.type(c.local, '   Sala 12   ');
      await usuario.type(c.demaisEnvolvidos, '    ');
      await usuario.type(c.testemunhas, '  ');
      await usuario.type(c.providencias, '  Conversa fictícia com os envolvidos.  ');
      await usuario.type(c.observacoes, ' ');
      await usuario.type(destinatario(1).observacao, '   ');

      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));

      const corpo = corpoDoPost();
      expect(corpo.local).toBe('Sala 12');
      expect(corpo.demaisEnvolvidos).toBeNull();
      expect(corpo.testemunhas).toBeNull();
      expect(corpo.providenciasImediatas).toBe('Conversa fictícia com os envolvidos.');
      expect(corpo.observacoes).toBeNull();
      expect(corpo.encaminhamentos[0].observacao).toBeNull();
      // RN02: o profissional responsável nunca vai no corpo.
      expect(corpo).not.toHaveProperty('profissionalResponsavelId');
      expect(Object.keys(corpo).sort()).toEqual([
        'categoriaId', 'dataHora', 'demaisEnvolvidos', 'descricao', 'encaminhamentos',
        'estudanteIds', 'local', 'observacoes', 'providenciasImediatas', 'testemunhas', 'turmaId',
      ]);
    });

    it('local e descrição só com espaços são recusados no cliente', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.clear(c.local);
      await usuario.type(c.local, '   ');
      await usuario.clear(c.descricao);
      await usuario.type(c.descricao, '   ');

      await usuario.click(c.enviar);

      expect(screen.getByText(MSG_LOCAL)).toBeInTheDocument();
      expect(screen.getByText('Descreva o fato.')).toBeInTheDocument();
      expect(c.descricao).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('erro de validação no cliente preserva tudo o que foi preenchido', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.type(c.testemunhas, 'Testemunha fictícia');
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Gestão');
      fireEvent.change(c.dataHora, { target: { value: '2026-10-31T08:00' } });

      await usuario.click(c.enviar);

      expect(screen.getByText(MSG_DATA_FUTURA)).toBeInTheDocument();
      expect(c.turma).toHaveValue('1');
      expect(c.categoria).toHaveValue('5');
      expect(c.descricao).toHaveValue('Descrição fictícia do fato.');
      expect(c.local).toHaveValue('Pátio');
      expect(c.testemunhas).toHaveValue('Testemunha fictícia');
      expect(c.dataHora).toHaveValue('2026-10-31T08:00');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);
      expect(destinatario(2).tipo).toHaveValue('GESTAO');
      expect(chamadasPost()).toHaveLength(0);
    });

    it('a mensagem de sucesso some ao começar um novo registro', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 21 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.click(c.enviar);
      expect(await screen.findByText('Ocorrência nº 21 registrada com sucesso.')).toBeInTheDocument();

      await usuario.selectOptions(campos().turma, ROTULO_7B);
      expect(screen.queryByText('Ocorrência nº 21 registrada com sucesso.')).not.toBeInTheDocument();
    });
  });

  describe('data e hora no horário de São Paulo (RN17)', () => {
    it('virada de dia e de mês: 31/10 21:30 em São Paulo (01/11 em UTC)', async () => {
      vi.setSystemTime(new Date('2026-11-01T00:30:00.000Z'));
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 30 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      // A sugestão é a data de São Paulo, não a de UTC.
      expect(c.dataHora).toHaveValue('2026-10-31T21:30');

      // 01/11 00:00 em São Paulo ainda é futuro (2h30 à frente).
      fireEvent.change(c.dataHora, { target: { value: '2026-11-01T00:00' } });
      await usuario.click(c.enviar);
      expect(screen.getByText(MSG_DATA_FUTURA)).toBeInTheDocument();
      expect(chamadasPost()).toHaveLength(0);

      fireEvent.change(c.dataHora, { target: { value: '2026-10-31T21:30' } });
      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().dataHora).toBe('2026-10-31T21:30:00-03:00');
    });

    it('virada de ano: 31/12 22:00 em São Paulo (01/01 em UTC)', async () => {
      vi.setSystemTime(new Date('2027-01-01T01:00:00.000Z'));
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 31 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      expect(c.dataHora).toHaveValue('2026-12-31T22:00');

      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().dataHora).toBe('2026-12-31T22:00:00-03:00');
    });

    it('data no passado distante é aceita (só o futuro é recusado)', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 32 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      fireEvent.change(c.dataHora, { target: { value: '2026-02-01T07:15' } });
      await usuario.click(c.enviar);

      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().dataHora).toBe('2026-02-01T07:15:00-03:00');
    });
  });

  describe('acessibilidade e linguagem (RNF02)', () => {
    it('aria-invalid e descrição do erro aparecem no campo e saem quando ele é corrigido', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();
      expect(c.categoria).toHaveAttribute('aria-invalid', 'false');

      await usuario.click(c.enviar);

      expect(c.categoria).toHaveAttribute('aria-invalid', 'true');
      expect(c.categoria).toHaveAccessibleDescription(expect.stringContaining(MSG_CATEGORIA));
      expect(c.local).toHaveAccessibleDescription(expect.stringContaining(MSG_LOCAL));
      expect(c.filtro).toHaveAttribute('aria-invalid', 'true');
      expect(c.filtro).toHaveAccessibleDescription(expect.stringContaining(MSG_ESTUDANTES));
      expect(destinatario(1).tipo).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(MSG_REVISAR);

      await usuario.selectOptions(c.categoria, 'Categoria Fictícia X');
      expect(c.categoria).toHaveAttribute('aria-invalid', 'false');
      expect(screen.queryByText(MSG_CATEGORIA)).not.toBeInTheDocument();
      // Corrigir um campo não apaga o erro dos outros.
      expect(screen.getByText(MSG_LOCAL)).toBeInTheDocument();
    });

    it('o foco vai ao primeiro campo com erro, na ordem da tela', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');

      await usuario.click(c.enviar);
      expect(c.categoria).toHaveFocus();

      await usuario.selectOptions(c.categoria, 'Categoria Fictícia X');
      await usuario.type(c.descricao, 'Descrição fictícia.');
      await usuario.click(c.enviar);
      expect(c.local).toHaveFocus();

      await usuario.type(c.local, 'Pátio');
      await usuario.click(c.enviar);
      expect(destinatario(1).tipo).toHaveFocus();
    });

    it('com erro só no 2º destinatário, o foco vai para ele', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));

      await usuario.click(campos().enviar);

      expect(destinatario(2).tipo).toHaveFocus();
      expect(destinatario(2).tipo).toHaveAttribute('aria-invalid', 'true');
      expect(destinatario(1).tipo).toHaveAttribute('aria-invalid', 'false');
    });

    it('todos os campos têm rótulo visível e o sucesso é anunciado numa região de status', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 40 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      for (const campo of Object.values(c)) expect(campo).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: 'Estudante Fictício A' })).toBeChecked();

      await usuario.click(c.enviar);

      const status = await screen.findByText('Ocorrência nº 40 registrada com sucesso.');
      expect(status.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('validarRegistro e montarEnvio (limites do contrato)', () => {
    const dadosValidos = {
      turmaId: '1',
      categoriaId: '5',
      descricao: 'Descrição fictícia.',
      dataHora: '2026-10-30T07:00',
      local: 'Pátio',
      demaisEnvolvidos: '',
      testemunhas: '',
      providenciasImediatas: '',
      observacoes: '',
    };
    const destinatarioValido = [
      { chave: 1, destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '', observacao: '' },
    ];
    const agoraMs = AGORA.getTime();

    it(`aceita até ${MAXIMO_ESTUDANTES} estudantes e recusa o ${MAXIMO_ESTUDANTES + 1}º`, () => {
      const estudantes = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
      expect(validarRegistro(dadosValidos, estudantes(50), destinatarioValido, agoraMs).erros)
        .toEqual({});
      expect(validarRegistro(dadosValidos, estudantes(51), destinatarioValido, agoraMs).erros)
        .toEqual({ estudantes: 'Selecione no máximo 50 estudantes por ocorrência.' });
    });

    it('limites de texto após remover espaços: local 150 e textos longos 5000', () => {
      const est = [{ id: 1 }];
      expect(
        validarRegistro({ ...dadosValidos, local: ` ${'L'.repeat(150)} ` }, est, destinatarioValido, agoraMs).erros,
      ).toEqual({});
      expect(
        validarRegistro({ ...dadosValidos, local: 'L'.repeat(151) }, est, destinatarioValido, agoraMs).erros,
      ).toEqual({ local: 'O local deve ter no máximo 150 caracteres.' });
      expect(
        validarRegistro({ ...dadosValidos, observacoes: 'O'.repeat(5001) }, est, destinatarioValido, agoraMs)
          .erros,
      ).toEqual({ observacoes: 'Este campo deve ter no máximo 5000 caracteres.' });
    });

    it('recusa mais de 10 destinatários e "toda a equipe" repetida; aceita mesmo perfil com pessoas diferentes', () => {
      const est = [{ id: 1 }];
      const onze = Array.from({ length: 11 }, (_, i) => ({
        chave: i + 1, destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: String(100 + i), observacao: '',
      }));
      expect(validarRegistro(dadosValidos, est, onze, agoraMs).erros.destinatarios).toBe(
        'Adicione no máximo 10 destinatários.',
      );

      const resultado = validarRegistro(dadosValidos, est, [
        { chave: 1, destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '', observacao: '' },
        { chave: 2, destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '1', observacao: '' },
        { chave: 3, destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '', observacao: '' },
        { chave: 4, destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: '', observacao: '' },
      ], agoraMs);
      expect(resultado.errosDestinatarios).toEqual({
        3: { destinatarioUsuarioId: MSG_REPETIDO_1 },
      });
    });

    it('montarEnvio converte ids em número e mantém a ordem dos estudantes escolhidos', () => {
      const corpo = montarEnvio(
        dadosValidos,
        [{ id: 3 }, { id: 1 }],
        [{ chave: 1, destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: '13', observacao: '' }],
      );
      expect(corpo.turmaId).toBe(1);
      expect(corpo.categoriaId).toBe(5);
      expect(corpo.estudanteIds).toEqual([3, 1]);
      expect(corpo.encaminhamentos).toEqual([
        { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 13, observacao: null },
      ]);
      expect(corpo.dataHora).toBe('2026-10-30T07:00:00-03:00');
    });
  });
});
