// Fluxos da Issue #46 — tela de registro de ocorrência (UC01): acesso pelos
// 5 perfis, seleção de vários estudantes (inclusive de turmas diferentes),
// filtro de turma separado da turma da ocorrência, sugestão de tutores,
// validações no cliente, corpo do POST /ocorrencias (dataHora com fuso de
// São Paulo), envio único, sucesso com número e erros da API (400, 403, sem
// conexão). Após o registro, leva ao detalhe da ocorrência criada (#48).
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
// 30/10/2026 08:00 em São Paulo (UTC-03:00).
const AGORA = new Date('2026-10-30T11:00:00.000Z');
const AGORA_NO_CAMPO = '2026-10-30T08:00';

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_ESTUDANTES = 'Selecione ao menos um estudante envolvido.';
const MSG_DESTINATARIOS = 'Adicione ao menos um destinatário (tutor, equipe pedagógica ou gestão).';
const MSG_TUTOR = 'Escolha o tutor que vai receber a ocorrência.';
const MSG_DATA_FUTURA =
  'A data e a hora não podem estar no futuro. Informe quando o fato aconteceu.';
const MSG_REVISAR = 'Confira os campos destacados antes de enviar.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const TURMAS_FICTICIAS = [TURMA_6A, TURMA_7B];

const CATEGORIAS_FICTICIAS = [
  { id: 5, nome: 'Categoria Fictícia X', descricao: null },
  { id: 6, nome: 'Categoria Fictícia Y', descricao: 'Descrição fictícia' },
];

// Lista completa, como a Gestão recebe (com status e e-mail).
const USUARIOS_GESTAO = [
  { id: 1, nome: 'Gestora Fictícia', email: 'g@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 20, nome: 'Pedagoga Fictícia', email: 'p@exemplo.test', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 21, nome: 'Pedagogo Fictício Desativado', email: 'p2@exemplo.test', perfil: 'PEDAGOGICO', status: 'DESATIVADO' },
  { id: 30, nome: 'Professor Fictício', email: 'pr@exemplo.test', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício A', email: 't1@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 11, nome: 'Tutora Fictícia B', email: 't2@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 12, nome: 'Tutor Fictício Bloqueado', email: 't3@exemplo.test', perfil: 'TUTOR', status: 'BLOQUEADO' },
  { id: 13, nome: 'Tutora Fictícia C', email: 't4@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];

// Lista reduzida (RN20), como os demais perfis recebem: só ativos, sem status.
const USUARIOS_REDUZIDOS = USUARIOS_GESTAO.filter(
  (u) => u.status === 'ATIVO' && ['TUTOR', 'PEDAGOGICO', 'GESTAO'].includes(u.perfil),
).map(({ id, nome, perfil }) => ({ id, nome, perfil }));

function tutor(id) {
  const { nome } = USUARIOS_GESTAO.find((u) => u.id === id);
  return { id, nome };
}

// Formato reduzido (RN20): id, nome, turma e tutor (id e nome).
const ESTUDANTES_FICTICIOS = [
  { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: tutor(11) },
  { id: 2, nomeCompleto: 'Estudante Fictício B', turma: TURMA_6A, tutor: tutor(12) },
  { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B, tutor: tutor(13) },
  { id: 4, nomeCompleto: 'Estudante Fictício D', turma: TURMA_7B, tutor: null },
];

/** Detalhe fictício (GET /ocorrencias/{id}) exibido após o registro (#48). */
function detalheFicticio(id) {
  return {
    id,
    dataHora: '2026-10-30T10:00:00.000Z',
    local: 'Pátio',
    turma: TURMA_6A,
    categoria: { id: 5, nome: 'Categoria Fictícia X' },
    descricao: 'Descrição fictícia do fato.',
    demaisEnvolvidos: null,
    testemunhas: null,
    providenciasImediatas: null,
    observacoes: null,
    status: 'ABERTO',
    dataEncerramento: null,
    profissionalResponsavel: { id: 1, nome: 'Maria Fictícia' },
    responsavelAcompanhamento: null,
    estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
    encaminhamentos: [],
    comunicacoes: [],
    providencias: [],
  };
}

/**
 * GET /turmas, /categorias, /usuarios e /estudantes?turmaId= respondem com
 * os dados fictícios; POST /ocorrencias chama `aoRegistrar(corpo)`;
 * GET /ocorrencias/{id} devolve o detalhe fictício.
 */
function mockarApi({ usuarios = USUARIOS_GESTAO, turmas, aoRegistrar } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) {
      return turmas ? turmas() : respostaFalsa(200, TURMAS_FICTICIAS);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/categorias`) {
      return respostaFalsa(200, CATEGORIAS_FICTICIAS);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/usuarios`) {
      return respostaFalsa(200, usuarios);
    }
    const get = url.match(/\/estudantes\?turmaId=(\d+)$/);
    if (opcoes.method === 'GET' && get) {
      return respostaFalsa(
        200,
        ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === Number(get[1])),
      );
    }
    if (opcoes.method === 'POST' && url === `${URL_API}/ocorrencias` && aoRegistrar) {
      return aoRegistrar(JSON.parse(opcoes.body));
    }
    const detalhe = url.match(/\/ocorrencias\/(\d+)$/);
    if (opcoes.method === 'GET' && detalhe) {
      return respostaFalsa(200, detalheFicticio(Number(detalhe[1])));
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

async function abrirPagina(rota = '/ocorrencias/nova') {
  renderizarApp(rota);
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

/** Preenche um registro válido mínimo: 6º A, Estudante A, categoria X, equipe pedagógica. */
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

describe('Tela de registro de ocorrência (#46)', () => {
  let usuario;

  beforeEach(() => {
    // Só o relógio (Date) é fixado; os temporizadores continuam reais.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar o fetch: depois do registro a tela navega
    // ao detalhe (#48) e um GET pendente não pode sair pelo fetch real.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('acesso pelos 5 perfis (UC01, matriz da Seção 4)', () => {
    it.each(['GESTAO', 'PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      '%s vê "Registrar ocorrência" no menu e chega ao formulário',
      async (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        mockarApi({ usuarios: perfil === 'GESTAO' ? USUARIOS_GESTAO : USUARIOS_REDUZIDOS });
        renderizarApp('/');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        await usuario.click(within(menu).getByRole('link', { name: 'Registrar ocorrência' }));

        expect(
          screen.getByRole('heading', { level: 1, name: 'Registrar ocorrência' }),
        ).toBeInTheDocument();
        expect(await screen.findByLabelText('Turma da ocorrência')).toBeInTheDocument();
      },
    );

    it('mostra os campos na ordem da UC01 e sugere a data e hora de agora em São Paulo', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();

      const c = campos();
      const ordem = [c.turma, c.filtro, c.categoria, c.descricao, c.dataHora, c.local,
        c.demaisEnvolvidos, c.testemunhas, c.providencias, c.observacoes, destinatario(1).tipo];
      for (let i = 1; i < ordem.length; i += 1) {
        expect(ordem[i - 1].compareDocumentPosition(ordem[i]) & Node.DOCUMENT_POSITION_FOLLOWING)
          .toBeTruthy();
      }
      expect(c.dataHora).toHaveValue(AGORA_NO_CAMPO);
      // RN06: orientação de redação junto da descrição.
      expect(c.descricao).toHaveAccessibleDescription(
        expect.stringContaining('Não use linguagem ofensiva nem classificações que estigmatizem'),
      );
    });

    it('falha ao carregar as opções mostra mensagem e "Tentar novamente"', async () => {
      gravarSessaoFicticia();
      let falhar = true;
      mockarApi({
        turmas: () =>
          falhar ? Promise.reject(new TypeError('Failed to fetch')) : respostaFalsa(200, TURMAS_FICTICIAS),
      });
      renderizarApp('/ocorrencias/nova');

      expect(await screen.findByText(MSG_SEM_CONEXAO)).toBeInTheDocument();
      falhar = false;
      await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByLabelText('Turma da ocorrência')).toBeInTheDocument();
    });
  });

  describe('estudantes (RF06, RN14)', () => {
    it('o filtro acompanha a turma da ocorrência até ser trocado manualmente', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();

      expect(screen.getByText('Selecione uma turma acima para ver os estudantes.')).toBeInTheDocument();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      expect(c.filtro).toHaveValue('1');
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' })).toBeInTheDocument();

      await usuario.selectOptions(c.turma, ROTULO_7B);
      expect(c.filtro).toHaveValue('2');

      await usuario.selectOptions(c.filtro, ROTULO_6A);
      await usuario.selectOptions(c.turma, ROTULO_7B);
      expect(c.filtro).toHaveValue('1');
    });

    it('seleciona vários estudantes de turmas diferentes sem perder os escolhidos nem mudar a turma da ocorrência', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();

      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');
      await marcarEstudante(usuario, 'Estudante Fictício B');

      await usuario.selectOptions(c.filtro, ROTULO_7B);
      await marcarEstudante(usuario, 'Estudante Fictício C');

      expect(c.turma).toHaveValue('1');
      expect(nomesSelecionados()).toEqual([
        'Estudante Fictício A',
        'Estudante Fictício B',
        `Estudante Fictício C (turma ${ROTULO_7B})`,
      ]);
      expect(screen.getByRole('heading', { name: 'Estudantes envolvidos (3)' })).toBeInTheDocument();

      // Voltando ao filtro da 6º A, os escolhidos continuam marcados.
      await usuario.selectOptions(c.filtro, ROTULO_6A);
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Estudante Fictício B' })).toBeChecked();

      // Remover pelo item da lista e desmarcar pela caixa.
      await usuario.click(screen.getByRole('button', { name: 'Remover Estudante Fictício C' }));
      await usuario.click(screen.getByRole('checkbox', { name: 'Estudante Fictício B' }));
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);
    });
  });

  describe('validação no cliente', () => {
    it('formulário vazio: mostra as mensagens de cada campo e não chama a API', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();

      await usuario.click(campos().enviar);

      expect(screen.getByText(MSG_REVISAR)).toBeInTheDocument();
      expect(screen.getByText('Selecione a turma da ocorrência.')).toBeInTheDocument();
      expect(screen.getByText(MSG_ESTUDANTES)).toBeInTheDocument();
      expect(screen.getByText('Selecione a categoria da ocorrência.')).toBeInTheDocument();
      expect(screen.getByText('Descreva o fato.')).toBeInTheDocument();
      expect(screen.getByText('Informe o local onde o fato aconteceu.')).toBeInTheDocument();
      expect(
        screen.getByText('Escolha para quem a ocorrência será encaminhada.'),
      ).toBeInTheDocument();
      expect(campos().turma).toHaveFocus();
      expect(campos().turma).toHaveAttribute('aria-invalid', 'true');
      expect(chamadasPost()).toHaveLength(0);
    });

    it('sem estudante: bloqueia o envio e leva o foco à seleção de estudantes', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Remover Estudante Fictício A' }));

      await usuario.click(campos().enviar);

      expect(screen.getByText(MSG_ESTUDANTES)).toBeInTheDocument();
      expect(campos().filtro).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('sem destinatário: bloqueia o envio com mensagem clara', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 1' }));
      expect(screen.getByText('Nenhum destinatário adicionado.')).toBeInTheDocument();

      await usuario.click(campos().enviar);

      expect(screen.getByText(MSG_DESTINATARIOS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Adicionar destinatário' })).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('destinatário Tutor sem usuário: bloqueia o envio com mensagem clara', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      await preencherValido(usuario);
      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');

      await usuario.click(campos().enviar);

      expect(screen.getByText(MSG_TUTOR)).toBeInTheDocument();
      expect(destinatario(1).usuario()).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('destinatário repetido: bloqueia o envio indicando o repetido', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Equipe pedagógica');

      await usuario.click(campos().enviar);

      expect(
        within(destinatario(2).grupo).getByText(
          'Este destinatário repete o destinatário 1. Remova um deles.',
        ),
      ).toBeInTheDocument();
      expect(chamadasPost()).toHaveLength(0);

      // Com outra pessoa da equipe, deixa de ser repetido.
      await usuario.selectOptions(destinatario(2).usuario(), 'Pedagoga Fictícia');
      await usuario.click(campos().enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
    });

    it('data futura além de 5 minutos é recusada; dentro da tolerância é enviada', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 3, status: 'ABERTO' }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      fireEvent.change(c.dataHora, { target: { value: '2026-10-30T08:06' } });
      await usuario.click(c.enviar);
      expect(screen.getByText(MSG_DATA_FUTURA)).toBeInTheDocument();
      expect(c.dataHora).toHaveFocus();
      expect(chamadasPost()).toHaveLength(0);

      fireEvent.change(c.dataHora, { target: { value: '2026-10-30T08:05' } });
      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));
      expect(corpoDoPost().dataHora).toBe('2026-10-30T08:05:00-03:00');
    });

    it('data e hora vazias são recusadas', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 1 }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      fireEvent.change(c.dataHora, { target: { value: '' } });
      await usuario.click(c.enviar);

      expect(
        screen.getByText('Informe a data e a hora em que o fato aconteceu.'),
      ).toBeInTheDocument();
      expect(chamadasPost()).toHaveLength(0);
    });

    it('respeita os limites de tamanho dos campos (maxLength)', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();

      expect(c.local).toHaveAttribute('maxLength', '150');
      for (const campo of [c.descricao, c.demaisEnvolvidos, c.testemunhas, c.providencias,
        c.observacoes, destinatario(1).observacao]) {
        expect(campo).toHaveAttribute('maxLength', '5000');
      }
    });
  });

  describe('destinatários (RN03)', () => {
    it('Tutor: agrupa os tutores dos estudantes selecionados e não escolhe nenhum sozinho', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();
      const c = campos();

      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A'); // Tutora B (ativa)
      await marcarEstudante(usuario, 'Estudante Fictício B'); // tutor bloqueado: não sugerido
      await usuario.selectOptions(c.filtro, ROTULO_7B);
      await marcarEstudante(usuario, 'Estudante Fictício C'); // Tutora C (ativa)
      await marcarEstudante(usuario, 'Estudante Fictício D'); // sem tutor

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      const seletor = destinatario(1).usuario();
      expect(seletor).toHaveValue('');

      const grupos = seletor.querySelectorAll('optgroup');
      expect([...grupos].map((g) => g.label)).toEqual([
        'Tutores dos estudantes selecionados',
        'Outros tutores',
      ]);
      const textos = (grupo) => [...grupo.querySelectorAll('option')].map((o) => o.textContent);
      expect(textos(grupos[0])).toEqual(['Tutora Fictícia B', 'Tutora Fictícia C']);
      expect(textos(grupos[1])).toEqual(['Tutor Fictício A']);
      expect(within(seletor).queryByText('Tutor Fictício Bloqueado')).not.toBeInTheDocument();
    });

    it('Equipe pedagógica e Gestão: "Toda a equipe" por padrão, só usuários ativos do perfil', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirPagina();

      await usuario.selectOptions(destinatario(1).tipo, 'Equipe pedagógica');
      const seletor = destinatario(1).usuario();
      expect(seletor).toHaveValue('');
      expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Toda a equipe',
        'Pedagoga Fictícia',
      ]);

      await usuario.selectOptions(destinatario(1).tipo, 'Gestão');
      expect(
        within(destinatario(1).usuario()).getAllByRole('option').map((o) => o.textContent),
      ).toEqual(['Toda a equipe', 'Gestora Fictícia']);
    });

    it('perfil sem Gestão recebe a lista reduzida (sem status) e vê os tutores ativos', async () => {
      gravarSessaoFicticia({ usuario: { id: 9, nome: 'Professora Fictícia', perfil: 'PROFESSOR' } });
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      await abrirPagina();

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      expect(
        [...destinatario(1).usuario().querySelectorAll('optgroup option')].map((o) => o.textContent),
      ).toEqual(['Tutor Fictício A', 'Tutora Fictícia B', 'Tutora Fictícia C']);
    });
  });

  describe('envio (POST /ocorrencias)', () => {
    it('envia o corpo do contrato, com dataHora no fuso de São Paulo e vários destinatários', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 42, status: 'ABERTO' }) });
      await abrirPagina();
      const c = campos();

      await usuario.selectOptions(c.turma, ROTULO_6A);
      await marcarEstudante(usuario, 'Estudante Fictício A');
      await usuario.selectOptions(c.filtro, ROTULO_7B);
      await marcarEstudante(usuario, 'Estudante Fictício C');
      await usuario.selectOptions(c.categoria, 'Categoria Fictícia Y');
      await usuario.type(c.descricao, '  Descrição fictícia do fato.  ');
      fireEvent.change(c.dataHora, { target: { value: '2026-10-30T07:30' } });
      await usuario.type(c.local, 'Quadra');
      await usuario.type(c.testemunhas, 'Testemunha fictícia');

      await usuario.selectOptions(destinatario(1).tipo, 'Tutor');
      await usuario.selectOptions(destinatario(1).usuario(), 'Tutora Fictícia C');
      await usuario.type(destinatario(1).observacao, 'Observação fictícia');
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Gestão');

      await usuario.click(c.enviar);
      await waitFor(() => expect(chamadasPost()).toHaveLength(1));

      expect(chamadasPost()[0][0]).toBe(`${URL_API}/ocorrencias`);
      expect(corpoDoPost()).toEqual({
        dataHora: '2026-10-30T07:30:00-03:00',
        local: 'Quadra',
        turmaId: 1,
        categoriaId: 6,
        descricao: 'Descrição fictícia do fato.',
        estudanteIds: [1, 3],
        demaisEnvolvidos: null,
        testemunhas: 'Testemunha fictícia',
        providenciasImediatas: null,
        observacoes: null,
        encaminhamentos: [
          { destinatarioPerfil: 'TUTOR', destinatarioUsuarioId: 13, observacao: 'Observação fictícia' },
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null },
        ],
      });
    });

    it('botão desabilitado durante o envio; sucesso leva ao detalhe com o número em destaque', async () => {
      gravarSessaoFicticia();
      let responder;
      mockarApi({ aoRegistrar: () => new Promise((resolve) => (responder = resolve)) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      fireEvent.change(c.dataHora, { target: { value: '2026-10-30T07:00' } });

      await usuario.click(c.enviar);
      const botao = screen.getByRole('button', { name: 'Registrando...' });
      expect(botao).toBeDisabled();
      await usuario.click(botao);
      expect(chamadasPost()).toHaveLength(1);

      responder(respostaFalsa(201, { id: 42, status: 'ABERTO' }));

      // #48: vai para o detalhe da ocorrência criada, com a confirmação no topo.
      const sucesso = await screen.findByText('Ocorrência nº 42 registrada com sucesso.');
      expect(sucesso).toHaveFocus();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 42' }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Turma da ocorrência')).not.toBeInTheDocument();
      expect(chamadasPost()).toHaveLength(1);
      const gets = fetch.mock.calls.filter(([url]) => url === `${URL_API}/ocorrencias/42`);
      expect(gets).toHaveLength(1);
    });

    it('depois do sucesso, abrir "Registrar ocorrência" de novo mostra o formulário vazio', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { id: 42, status: 'ABERTO' }) });
      await abrirPagina();
      const c = await preencherValido(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(destinatario(2).tipo, 'Gestão');
      await usuario.click(c.enviar);
      await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 42' });

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Registrar ocorrência' }));
      await screen.findByRole('button', { name: 'Registrar ocorrência' });

      const limpo = campos();
      expect(limpo.enviar).toBeEnabled();
      expect(limpo.turma).toHaveValue('');
      expect(limpo.filtro).toHaveValue('');
      expect(limpo.categoria).toHaveValue('');
      expect(limpo.descricao).toHaveValue('');
      expect(limpo.local).toHaveValue('');
      expect(limpo.dataHora).toHaveValue(AGORA_NO_CAMPO);
      expect(nomesSelecionados()).toEqual([]);
      expect(destinatario(1).tipo).toHaveValue('');
      expect(screen.queryByRole('group', { name: 'Destinatário 2' })).not.toBeInTheDocument();
      expect(screen.queryByText('Ocorrência nº 42 registrada com sucesso.')).not.toBeInTheDocument();

      // O filtro acompanha a turma da ocorrência no formulário novo.
      await usuario.selectOptions(limpo.turma, ROTULO_7B);
      expect(limpo.filtro).toHaveValue('2');
    });

    it('resposta sem id (fora do contrato): fica na tela, confirma e limpa o formulário', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(201, { status: 'ABERTO' }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      const sucesso = await screen.findByText('Ocorrência registrada com sucesso.');
      expect(sucesso).toHaveFocus();
      expect(screen.getByRole('heading', { level: 1, name: 'Registrar ocorrência' })).toBeInTheDocument();
      expect(campos().descricao).toHaveValue('');
      expect(nomesSelecionados()).toEqual([]);
    });

    it('erro 400: mostra a mensagem da API e mantém o que foi preenchido', async () => {
      gravarSessaoFicticia();
      const mensagem = 'Um ou mais estudantes informados não existem.';
      mockarApi({ aoRegistrar: () => respostaFalsa(400, { erro: mensagem }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      expect(await screen.findByRole('alert')).toHaveTextContent(mensagem);
      expect(c.local).toHaveValue('Pátio');
      expect(nomesSelecionados()).toEqual(['Estudante Fictício A']);
      expect(c.enviar).toBeEnabled();
    });

    it('erro 403: mostra que o perfil não tem permissão', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => respostaFalsa(403, { erro: 'Acesso negado.' }) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão: mostra mensagem compreensível e permite tentar de novo', async () => {
      gravarSessaoFicticia();
      mockarApi({ aoRegistrar: () => Promise.reject(new TypeError('Failed to fetch')) });
      await abrirPagina();
      const c = await preencherValido(usuario);

      await usuario.click(c.enviar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(c.enviar).toBeEnabled();
      expect(c.descricao).toHaveValue('Descrição fictícia do fato.');
    });
  });
});
