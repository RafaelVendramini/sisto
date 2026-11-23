// Fluxos da Issue #128 — experiência de uso (RNF01, RNF02, RNF03):
// 1. sessão vencida não apaga o formulário: 401 volta ao login com `state.de`
//    e, depois de entrar, à tela de origem; token vencido ANTES do envio não
//    envia nem limpa o registro de ocorrência nem os diálogos;
// 2. Esc e "Cancelar" com texto digitado pedem confirmação nos diálogos;
// 3. falha só do GET /usuarios não trava o registro de ocorrência;
// 5. "Pular para o conteúdo" e foco no título ao trocar de página.
// O relógio (Date) é fixado: nenhum teste depende da data ou da hora reais.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAGEM_SESSAO_EXPIRADA_FORMULARIO } from '../src/components/AvisoSessaoExpirada.jsx';
import { destinoInterno, estadoVoltarPara } from '../src/services/destinoLogin.js';
import {
  CHAVE_SESSAO,
  USUARIO_FICTICIO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
  tokenFicticio,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
// 30/10/2026 08:00 em São Paulo (UTC-03:00).
const AGORA = new Date('2026-10-30T11:00:00.000Z');

const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
const AVISO_USUARIOS =
  'Não foi possível carregar a lista de usuários. Você ainda pode encaminhar para toda a ' +
  'equipe pedagógica ou para toda a gestão; para escolher um tutor ou uma pessoa da equipe, ' +
  'tente carregar a lista de novo.';
const PERGUNTA_DESCARTE = 'Descartar o que foi digitado?';

const EMAIL_FICTICIO = 'gestao@exemplo.test';
const SENHA_FICTICIA = 'SenhaFicticia#1';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const CATEGORIAS = [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }];
const USUARIOS = [
  { id: 1, nome: 'Maria Fictícia', email: 'g@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 20, nome: 'Pedagoga Fictícia', email: 'p@exemplo.test', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício A', email: 't@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];
const ESTUDANTES = [
  { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: { id: 10, nome: 'Tutor Fictício A' } },
];

// "Em acompanhamento": a Gestão vê encaminhar, comunicar e registrar providência.
const DETALHE = Object.freeze({
  id: 12,
  dataHora: '2026-10-30T10:00:00.000Z',
  local: 'Pátio',
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
  responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
  estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [],
});

/**
 * Roteia o fetch mockado. Cada rota pode ser trocada por uma função que
 * devolve a resposta (ex.: para simular 401 ou falha).
 */
function mockarApi({
  usuarios = () => respostaFalsa(200, USUARIOS),
  registrar = () => respostaFalsa(201, { id: 77 }),
  listaOcorrencias = () => respostaFalsa(200, { itens: [], total: 0, pagina: 1, tamanhoPagina: 20 }),
  turmas = () => respostaFalsa(200, [TURMA_6A]),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'POST' && url === `${URL_API}/auth/login`) {
      return respostaFalsa(200, { token: tokenFicticio(), usuario: USUARIO_FICTICIO });
    }
    if (method === 'GET' && url === `${URL_API}/turmas`) return turmas();
    if (method === 'GET' && url === `${URL_API}/categorias`) return respostaFalsa(200, CATEGORIAS);
    if (method === 'GET' && url === `${URL_API}/usuarios`) return usuarios();
    if (method === 'GET' && /\/estudantes\?turmaId=\d+$/.test(url)) {
      return respostaFalsa(200, ESTUDANTES);
    }
    if (method === 'POST' && url === `${URL_API}/ocorrencias`) return registrar(JSON.parse(body));
    if (method === 'GET' && /\/ocorrencias(\?.*)?$/.test(url)) return listaOcorrencias(url);
    if (method === 'GET' && /\/ocorrencias\/\d+\/historico$/.test(url)) return respostaFalsa(200, []);
    if (method === 'GET' && /\/ocorrencias\/\d+$/.test(url)) return respostaFalsa(200, DETALHE);
    if (method === 'POST' && /\/ocorrencias\/\d+\/(providencias|comunicacoes|encaminhamentos)$/.test(url)) {
      return respostaFalsa(201, DETALHE);
    }
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function chamadas(metodo, trecho = '') {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === metodo && url.includes(trecho),
  );
}

/** Troca o token da sessão por um já vencido (mesmo usuário), sem mexer na tela. */
function vencerToken() {
  sessionStorage.setItem(
    CHAVE_SESSAO,
    JSON.stringify({ token: tokenFicticio({ expiraEmSegundos: -60 }), usuario: USUARIO_FICTICIO }),
  );
}

async function entrar(usuario) {
  await usuario.type(await screen.findByLabelText('E-mail'), EMAIL_FICTICIO);
  await usuario.type(screen.getByLabelText('Senha'), SENHA_FICTICIA);
  await usuario.click(screen.getByRole('button', { name: 'Entrar' }));
}

/** Preenche um registro válido mínimo (6º A, Estudante A, categoria X, equipe pedagógica). */
async function preencherRegistro(usuario) {
  await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
  await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
  await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
  await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia do fato.');
  await usuario.type(screen.getByLabelText('Local'), 'Pátio');
  const grupo = screen.getByRole('group', { name: 'Destinatário 1' });
  await usuario.selectOptions(within(grupo).getByLabelText('Encaminhar para'), 'Equipe pedagógica');
}

async function abrirDialogoNoDetalhe(usuario, botao, titulo) {
  renderizarApp('/ocorrencias/12');
  await usuario.click(await screen.findByRole('button', { name: botao }));
  return screen.findByRole('dialog', { name: titulo });
}

describe('Experiência de uso (#128)', () => {
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
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('destino depois do login (destinoInterno)', () => {
    it.each([
      ['/ocorrencias/nova', '/ocorrencias/nova'],
      ['/ocorrencias?pagina=2&status=ABERTO', '/ocorrencias?pagina=2&status=ABERTO'],
      ['/', '/'],
    ])('aceita o destino interno %s', (de, esperado) => {
      expect(destinoInterno(de)).toBe(esperado);
    });

    it.each([
      ['//exemplo.test/caminho'],
      ['/\\exemplo.test'],
      ['https://exemplo.test/'],
      ['javascript:alert(1)'],
      ['ocorrencias'],
      ['/login'],
      ['/login?x=1'],
      ['/ocorrencias\n/x'],
      [''],
      [null],
      [undefined],
      [42],
      [{ pathname: '/' }],
    ])('recusa %j', (de) => {
      expect(destinoInterno(de)).toBeNull();
    });

    // Análise de open redirect (revisão da #128): espaço ou tabulação antes de
    // "//", controles no meio do caminho e o login com outra caixa são recusados.
    it.each([
      [' //exemplo.test'],
      ['\t//exemplo.test'],
      ['/\t/exemplo.test'],
      ['/\n/exemplo.test'],
      ['javascript:alert(1)'],
      ['/LOGIN'],
      ['/Login?x=1'],
    ])('open redirect: recusa %j', (de) => {
      expect(destinoInterno(de)).toBeNull();
    });

    it('"/%2F%2Fexemplo.test" é aceito: o roteador o trata como caminho interno (cai na 404 do app)', () => {
      expect(destinoInterno('/%2F%2Fexemplo.test')).toBe('/%2F%2Fexemplo.test');
    });

    it('estadoVoltarPara junta caminho e busca, e não guarda o próprio login', () => {
      expect(estadoVoltarPara({ pathname: '/ocorrencias', search: '?pagina=2' })).toEqual({
        de: '/ocorrencias?pagina=2',
      });
      expect(estadoVoltarPara({ pathname: '/login', search: '' })).toBeUndefined();
    });

    it('no login, um state.de externo é ignorado e a pessoa vai para "Início"', async () => {
      mockarApi();
      renderizarApp({ pathname: '/login', state: { de: '//exemplo.test/fora' } });
      await entrar(usuario);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
      ).toBeInTheDocument();
    });
  });

  describe('1a. 401 da API: volta ao login e, depois de entrar, à tela de origem', () => {
    it('no registro de ocorrência', async () => {
      gravarSessaoFicticia();
      mockarApi({ registrar: () => respostaFalsa(401, { erro: 'Não autenticado.' }) });
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      await preencherRegistro(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      expect(await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();

      await entrar(usuario);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Registrar ocorrência' }),
      ).toBeInTheDocument();
    });

    it('mantém a busca (filtros e página) da tela de origem', async () => {
      gravarSessaoFicticia();
      let primeira = true;
      mockarApi({
        listaOcorrencias: () => {
          if (primeira) {
            primeira = false;
            return respostaFalsa(401, { erro: 'Não autenticado.' });
          }
          return respostaFalsa(200, { itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
        },
      });
      renderizarApp('/ocorrencias?status=ABERTO');

      expect(await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      await entrar(usuario);

      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrências' })).toBeInTheDocument();
      await waitFor(() => {
        const urls = chamadas('GET', '/ocorrencias').map(([url]) => url);
        expect(urls.at(-1)).toContain('status=ABERTO');
      });
    });

    it('depois de "Sair", o próximo login vai para "Início" (não guarda a tela anterior)', async () => {
      gravarSessaoFicticia();
      mockarApi({ turmas: () => respostaFalsa(200, []) });
      renderizarApp('/turmas');
      await screen.findByRole('heading', { level: 1, name: 'Turmas' });

      await usuario.click(screen.getByRole('button', { name: 'Sair' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      await entrar(usuario);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
      ).toBeInTheDocument();
    });
  });

  describe('1b. token vencido antes do envio: não envia e não limpa', () => {
    it('registro de ocorrência: mensagem clara, formulário preservado e volta depois do login', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      await preencherRegistro(usuario);

      vencerToken();
      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(MENSAGEM_SESSAO_EXPIRADA_FORMULARIO);
      expect(chamadas('POST', '/ocorrencias')).toHaveLength(0);
      // Nada foi apagado: a pessoa pode copiar o texto.
      expect(screen.getByLabelText('Descrição do fato')).toHaveValue('Descrição fictícia do fato.');
      expect(screen.getByLabelText('Local')).toHaveValue('Pátio');
      expect(screen.getByLabelText('Turma da ocorrência')).toHaveValue('1');
      expect(screen.getByRole('heading', { level: 1, name: 'Registrar ocorrência' })).toBeInTheDocument();
      // Nenhum rascunho no navegador (LGPD).
      expect(JSON.stringify({ ...sessionStorage })).not.toContain('Descrição fictícia');
      expect(JSON.stringify({ ...localStorage })).not.toContain('Descrição fictícia');

      await usuario.click(within(alerta).getByRole('button', { name: 'Entrar novamente' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      // O cabeçalho não mostra mais o usuário da sessão vencida.
      expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();

      await entrar(usuario);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Registrar ocorrência' }),
      ).toBeInTheDocument();
    });

    it('diálogo de providência: não envia e mantém o texto', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Registrar providência', 'Registrar providência');
      const campo = within(dialogo).getByLabelText('Descrição da providência');
      await usuario.type(campo, 'Providência fictícia.');

      vencerToken();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        MENSAGEM_SESSAO_EXPIRADA_FORMULARIO,
      );
      expect(chamadas('POST', '/providencias')).toHaveLength(0);
      expect(campo).toHaveValue('Providência fictícia.');
      expect(screen.getByRole('dialog', { name: 'Registrar providência' })).toBeInTheDocument();

      await usuario.click(within(dialogo).getByRole('button', { name: 'Entrar novamente' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      await entrar(usuario);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' }),
      ).toBeInTheDocument();
    });

    it('diálogo de comunicação: não envia e mantém os textos', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Registrar comunicação', 'Registrar comunicação');
      await usuario.type(within(dialogo).getByLabelText('Destinatário'), 'Responsável fictício');
      await usuario.type(within(dialogo).getByLabelText('Meio'), 'Telefone');
      await usuario.type(within(dialogo).getByLabelText('Descrição'), 'Contato fictício.');

      vencerToken();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        MENSAGEM_SESSAO_EXPIRADA_FORMULARIO,
      );
      expect(chamadas('POST', '/comunicacoes')).toHaveLength(0);
      expect(within(dialogo).getByLabelText('Descrição')).toHaveValue('Contato fictício.');
    });

    it('diálogo de encaminhamento: não envia e mantém a observação', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Encaminhar', 'Encaminhar ocorrência');
      await usuario.selectOptions(await within(dialogo).findByLabelText('Encaminhar para'), 'Gestão');
      await usuario.type(within(dialogo).getByLabelText('Observação (opcional)'), 'Observação fictícia.');

      vencerToken();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
        MENSAGEM_SESSAO_EXPIRADA_FORMULARIO,
      );
      expect(chamadas('POST', '/encaminhamentos')).toHaveLength(0);
      expect(within(dialogo).getByLabelText('Observação (opcional)')).toHaveValue('Observação fictícia.');
    });
  });

  describe('2. Esc e "Cancelar" com texto digitado pedem confirmação', () => {
    it('providência: Esc pergunta, "Continuar editando" volta ao campo e "Descartar" fecha', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Registrar providência', 'Registrar providência');
      const campo = within(dialogo).getByLabelText('Descrição da providência');
      await usuario.type(campo, 'Texto fictício');

      await usuario.keyboard('{Escape}');
      const confirmacao = within(dialogo).getByRole('alertdialog', { name: PERGUNTA_DESCARTE });
      const continuar = within(confirmacao).getByRole('button', { name: 'Continuar editando' });
      expect(continuar).toHaveFocus();
      // O formulário fica oculto, mas não é desmontado.
      expect(campo).not.toBeVisible();

      // Tab fica preso nos botões da confirmação.
      await usuario.tab();
      expect(within(confirmacao).getByRole('button', { name: 'Descartar' })).toHaveFocus();
      await usuario.tab();
      expect(continuar).toHaveFocus();

      await usuario.click(continuar);
      expect(within(dialogo).queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(campo).toBeVisible();
      expect(campo).toHaveValue('Texto fictício');
      expect(campo).toHaveFocus();

      await usuario.keyboard('{Escape}');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Descartar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Registrar providência' })).toHaveFocus();
      expect(chamadas('POST', '/providencias')).toHaveLength(0);
    });

    it('providência: Esc na confirmação equivale a "Continuar editando"', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Registrar providência', 'Registrar providência');
      const campo = within(dialogo).getByLabelText('Descrição da providência');
      await usuario.type(campo, 'Texto fictício');

      await usuario.keyboard('{Escape}');
      expect(within(dialogo).getByRole('alertdialog')).toBeInTheDocument();
      await usuario.keyboard('{Escape}');
      expect(within(dialogo).queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Registrar providência' })).toBeInTheDocument();
      expect(campo).toHaveFocus();
    });

    it('providência: sem texto (ou só espaços), Esc e Cancelar fecham direto', async () => {
      gravarSessaoFicticia();
      mockarApi();
      await abrirDialogoNoDetalhe(usuario, 'Registrar providência', 'Registrar providência');
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Registrar providência' });
      await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), '   ');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('comunicação: "Cancelar" com texto pede confirmação e volta o foco ao campo usado', async () => {
      gravarSessaoFicticia();
      mockarApi();
      const dialogo = await abrirDialogoNoDetalhe(usuario, 'Registrar comunicação', 'Registrar comunicação');
      const meio = within(dialogo).getByLabelText('Meio');
      await usuario.type(meio, 'Telefone');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      const confirmacao = within(dialogo).getByRole('alertdialog', { name: PERGUNTA_DESCARTE });
      expect(within(confirmacao).getByRole('button', { name: 'Continuar editando' })).toHaveFocus();

      await usuario.click(within(confirmacao).getByRole('button', { name: 'Continuar editando' }));
      expect(meio).toHaveFocus();
      expect(meio).toHaveValue('Telefone');
    });

    it('encaminhamento: só a observação conta como texto digitado', async () => {
      gravarSessaoFicticia();
      mockarApi();
      let dialogo = await abrirDialogoNoDetalhe(usuario, 'Encaminhar', 'Encaminhar ocorrência');
      // Só escolhas nas listas: fecha direto.
      await usuario.selectOptions(await within(dialogo).findByLabelText('Encaminhar para'), 'Gestão');
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Encaminhar' }));
      dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      const observacao = await within(dialogo).findByLabelText('Observação (opcional)');
      await usuario.type(observacao, 'Observação fictícia.');
      await usuario.keyboard('{Escape}');
      expect(within(dialogo).getByRole('alertdialog', { name: PERGUNTA_DESCARTE })).toBeInTheDocument();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Descartar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chamadas('POST', '/encaminhamentos')).toHaveLength(0);
    });
  });

  describe('3. falha só do GET /usuarios não trava o registro', () => {
    it('mostra o aviso e registra com "Equipe pedagógica" (toda a equipe)', async () => {
      gravarSessaoFicticia();
      const corpos = [];
      mockarApi({
        usuarios: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }),
        registrar: (corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, { id: 77 });
        },
      });
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });

      expect(screen.getByText(AVISO_USUARIOS)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Tutor: a ajuda explica que a lista não carregou (e não que não há tutores).
      const grupo = screen.getByRole('group', { name: 'Destinatário 1' });
      await usuario.selectOptions(within(grupo).getByLabelText('Encaminhar para'), 'Tutor');
      expect(within(grupo).getByLabelText('Tutor que vai receber')).toHaveAccessibleDescription(
        expect.stringContaining('A lista de tutores não carregou'),
      );

      await preencherRegistro(usuario);
      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      await waitFor(() => expect(corpos).toHaveLength(1));
      expect(corpos[0].encaminhamentos).toHaveLength(1);
      expect(corpos[0].encaminhamentos[0].destinatarioPerfil).toBe('EQUIPE_PEDAGOGICA');
    });

    it('"Carregar a lista de usuários" busca só os usuários e não apaga o formulário', async () => {
      gravarSessaoFicticia();
      let tentativa = 0;
      mockarApi({
        usuarios: () => {
          tentativa += 1;
          return tentativa === 1 ? respostaFalsa(500, {}) : respostaFalsa(200, USUARIOS);
        },
      });
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      await usuario.type(screen.getByLabelText('Descrição do fato'), 'Texto fictício.');
      const turmasAntes = chamadas('GET', '/turmas').length;

      await usuario.click(screen.getByRole('button', { name: 'Carregar a lista de usuários' }));

      await waitFor(() => expect(screen.queryByText(AVISO_USUARIOS)).not.toBeInTheDocument());
      expect(screen.getByLabelText('Descrição do fato')).toHaveValue('Texto fictício.');
      expect(chamadas('GET', '/turmas')).toHaveLength(turmasAntes);
      const grupo = screen.getByRole('group', { name: 'Destinatário 1' });
      await usuario.selectOptions(within(grupo).getByLabelText('Encaminhar para'), 'Tutor');
      expect(
        within(within(grupo).getByLabelText('Tutor que vai receber')).getByRole('option', {
          name: 'Tutor Fictício A',
        }),
      ).toBeInTheDocument();
    });

    it('se as turmas falharem, o erro continua bloqueando com "Tentar novamente"', async () => {
      gravarSessaoFicticia();
      mockarApi({ turmas: () => respostaFalsa(500, {}) });
      renderizarApp('/ocorrencias/nova');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar as turmas e as categorias agora.');
      expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Turma da ocorrência')).not.toBeInTheDocument();
    });
  });

  describe('5. acessibilidade do layout', () => {
    it('"Pular para o conteúdo" é o primeiro item do teclado e leva o foco ao <main>', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/');
      await screen.findByRole('heading', { level: 1 });

      await usuario.tab();
      const pular = screen.getByRole('link', { name: 'Pular para o conteúdo' });
      expect(pular).toHaveFocus();
      expect(pular).toHaveAttribute('href', '#conteudo');

      await usuario.click(pular);
      const principal = screen.getByRole('main');
      expect(principal).toHaveAttribute('id', 'conteudo');
      expect(principal).toHaveAttribute('tabindex', '-1');
      expect(principal).toHaveFocus();
    });

    it('também existe na tela de login (sem sessão)', () => {
      renderizarApp('/login');
      expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toBeInTheDocument();
    });

    it('ao trocar de página pelo menu, o foco vai para o título da nova página', async () => {
      gravarSessaoFicticia();
      fetch.mockImplementation(async (url, opcoes = {}) => {
        if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) return respostaFalsa(200, []);
        throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
      });
      renderizarApp('/');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Turmas' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Turmas' })).toHaveFocus();
    });

    it('não tira o foco que a página já definiu (ex.: primeiro campo de "Alterar minha senha")', async () => {
      gravarSessaoFicticia();
      renderizarApp('/');
      await usuario.click(screen.getByRole('link', { name: 'Alterar minha senha' }));

      expect(screen.getByLabelText('Senha atual')).toHaveFocus();
    });

    it('na primeira carga, o foco não é movido', () => {
      gravarSessaoFicticia();
      renderizarApp('/');
      expect(document.body).toHaveFocus();
    });
  });
});
