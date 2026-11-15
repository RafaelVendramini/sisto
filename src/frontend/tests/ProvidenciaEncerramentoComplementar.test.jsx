// Testes complementares do QA para a Issue #84 (providência e encerramento no
// detalhe da ocorrência). Cobrem lacunas da suíte do dev:
// - mensagens REAIS dos 409 do back-end (#81/#82): sem providência (corrida),
//   ocorrência aberta, já encerrada e conflito concorrente;
// - 500 nos dois envios (mensagem genérica, sem "Atualizar a ocorrência");
// - Pedagógico não responsável registra e encerra (RN22);
// - resposta sem corpo (fora do contrato) recarrega o detalhe;
// - Esc/Cancelar durante e fora do envio;
// - aviso da RN04 some ao abrir outras ações.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MENSAGEM_ENCERRAR_SEM_PROVIDENCIA } from '../src/services/mensagensOcorrencias.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';

// Textos copiados do contrato do back-end (services/ocorrencias.js, #81 e #82).
const API_ENCERRAR_SEM_PROVIDENCIA =
  'Registre ao menos uma providência adotada antes de encerrar a ocorrência.';
const API_ENCERRAR_ABERTA =
  'A ocorrência só pode ser encerrada depois de entrar em acompanhamento. Esta ocorrência ainda está aberta.';
const API_JA_ENCERRADA = 'Esta ocorrência já está encerrada e não pode ser reaberta.';
const API_CONFLITO_ENCERRAMENTO =
  'Não foi possível encerrar a ocorrência por causa de outra operação ao mesmo tempo. Tente novamente.';
const API_PROVIDENCIA_ABERTA =
  'A providência só pode ser registrada com a ocorrência em acompanhamento. Esta ocorrência ainda está aberta.';
const API_STATUS_INVALIDO = 'Informe status com o valor ENCERRADO.';

const MSG_GENERICA_PROVIDENCIA =
  'Não foi possível registrar a providência agora. Tente novamente em instantes.';
const MSG_GENERICA_ENCERRAMENTO =
  'Não foi possível encerrar a ocorrência agora. Tente novamente em instantes.';

const ID_USUARIO = 7;
const ID_RESPONSAVEL = 21;
const TURMA = { id: 3, nome: '7º B', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 };

const PROVIDENCIA = Object.freeze({
  id: 900,
  descricao: 'Orientação fictícia ao estudante.',
  dataHora: '2026-11-01T14:00:00.000Z',
  registradoPor: { id: ID_RESPONSAVEL, nome: 'Tutora Fictícia' },
});

const BASE = Object.freeze({
  id: 33,
  dataHora: '2026-11-01T11:00:00.000Z',
  local: 'Sala fictícia',
  turma: TURMA,
  categoria: { id: 2, nome: 'Categoria Fictícia Y' },
  descricao: 'Fato fictício.',
  demaisEnvolvidos: null,
  testemunhas: null,
  providenciasImediatas: null,
  observacoes: null,
  status: 'EM_ACOMPANHAMENTO',
  dataEncerramento: null,
  profissionalResponsavel: { id: 40, nome: 'Professora Fictícia' },
  responsavelAcompanhamento: { id: ID_RESPONSAVEL, nome: 'Tutora Fictícia' },
  estudantes: [{ id: 5, nomeCompleto: 'Estudante Fictício B', turma: TURMA }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [PROVIDENCIA],
});
const SEM_PROVIDENCIA = Object.freeze({ ...BASE, providencias: [] });
const NOVA = Object.freeze({
  id: 901,
  descricao: 'Contato fictício com a coordenação.',
  dataHora: '2026-11-01T15:00:00.000Z',
  registradoPor: { id: ID_USUARIO, nome: 'Pessoa Fictícia QA' },
});
const APOS_PROVIDENCIA = Object.freeze({ ...BASE, providencias: [PROVIDENCIA, NOVA] });
// 18:45 UTC = 15:45 em São Paulo (RN17).
const ENCERRADO = Object.freeze({
  ...BASE,
  status: 'ENCERRADO',
  dataEncerramento: '2026-11-01T18:45:00.000Z',
});

function mockarApi({
  detalhe = () => respostaFalsa(200, BASE),
  providencia = () => respostaFalsa(201, APOS_PROVIDENCIA),
  encerrar = () => respostaFalsa(200, ENCERRADO),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method } = opcoes;
    if (method === 'POST' && /\/ocorrencias\/33\/providencias$/.test(url)) return providencia();
    if (method === 'PATCH' && /\/ocorrencias\/33\/status$/.test(url)) return encerrar();
    if (method === 'GET' && /\/ocorrencias\/33$/.test(url)) return detalhe();
    // #85: o detalhe também busca o histórico (lista vazia aqui).
    if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return respostaFalsa(200, []);
    }
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

const chamadas = (metodo, sufixo) =>
  fetch.mock.calls.filter(([url, o = {}]) => o.method === metodo && url.endsWith(sufixo));
const posts = () => chamadas('POST', '/ocorrencias/33/providencias');
const patches = () => chamadas('PATCH', '/ocorrencias/33/status');
const gets = () => chamadas('GET', '/ocorrencias/33');

function valorDe(rotulo) {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

function botoesDeAcao() {
  const acoes = screen.queryByRole('region', { name: 'Ações sobre a ocorrência' });
  return acoes ? within(acoes).getAllByRole('button').map((b) => b.textContent) : [];
}

describe('Providência e encerramento — complementares do QA (#84)', () => {
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

  async function abrir({ perfil = 'GESTAO', id = ID_USUARIO, ...api } = {}) {
    gravarSessaoFicticia({ usuario: { id, nome: 'Pessoa Fictícia QA', perfil } });
    mockarApi(api);
    renderizarApp('/ocorrencias/33');
    await screen.findByText('Dados da ocorrência');
  }

  async function abrirEncerramento(opcoes) {
    await abrir(opcoes);
    await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
    return screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' });
  }

  async function abrirProvidencia(opcoes) {
    await abrir(opcoes);
    await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
    return screen.findByRole('dialog', { name: 'Registrar providência' });
  }

  async function confirmarEncerramento(dialogo) {
    await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));
  }

  describe('409 do encerramento com as mensagens reais do back-end (#82)', () => {
    it.each([
      [
        'sem providência (outra pessoa apagou/corrida)',
        API_ENCERRAR_SEM_PROVIDENCIA,
        'ENCERRAMENTO_SEM_PROVIDENCIA',
      ],
      ['ocorrência ainda aberta', API_ENCERRAR_ABERTA, 'OCORRENCIA_ABERTA'],
      ['já encerrada', API_JA_ENCERRADA, 'OCORRENCIA_ENCERRADA'],
      ['conflito concorrente', API_CONFLITO_ENCERRAMENTO, 'CONFLITO_CONCORRENTE'],
    ])('%s: mostra o texto do back-end e oferece "Atualizar a ocorrência"', async (_, mensagem, codigo) => {
      const dialogo = await abrirEncerramento({
        encerrar: () => respostaFalsa(409, { erro: mensagem, codigo }),
      });
      await confirmarEncerramento(dialogo);
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(mensagem);
      expect(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' })).toBeInTheDocument();
      // Nada mudou na tela enquanto o usuário não atualiza.
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
      expect(patches()).toHaveLength(1);
    });

    it('409 sem providência + "Atualizar": recarrega e, sem providência, a tela orienta (RN04)', async () => {
      let consultas = 0;
      const dialogo = await abrirEncerramento({
        detalhe: () => respostaFalsa(200, ++consultas === 1 ? BASE : SEM_PROVIDENCIA),
        encerrar: () => respostaFalsa(409, {
          erro: API_ENCERRAR_SEM_PROVIDENCIA,
          codigo: 'ENCERRAMENTO_SEM_PROVIDENCIA',
        }),
      });
      await confirmarEncerramento(dialogo);
      const alerta = await within(dialogo).findByRole('alert');
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
      await waitFor(() => expect(consultas).toBe(2));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      await screen.findByText('Nenhuma providência registrada.');

      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      expect(screen.getByRole('alert')).toHaveTextContent(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(patches()).toHaveLength(1);
    });

    it('400 inesperado (contrato) mostra a mensagem do back-end, sem "Atualizar"', async () => {
      const dialogo = await abrirEncerramento({
        encerrar: () => respostaFalsa(400, { erro: API_STATUS_INVALIDO }),
      });
      await confirmarEncerramento(dialogo);
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(API_STATUS_INVALIDO);
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
    });
  });

  describe('409 da providência com as mensagens reais do back-end (#81)', () => {
    it('ocorrência ainda aberta: texto do back-end e "Atualizar a ocorrência"', async () => {
      const dialogo = await abrirProvidencia({
        providencia: () => respostaFalsa(409, { erro: API_PROVIDENCIA_ABERTA, codigo: 'OCORRENCIA_ABERTA' }),
      });
      await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), 'Texto fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(API_PROVIDENCIA_ABERTA);
      expect(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' })).toBeInTheDocument();
      // O texto digitado é preservado para nova tentativa.
      expect(within(dialogo).getByLabelText('Descrição da providência')).toHaveValue('Texto fictício.');
    });
  });

  describe('erro 500 (falha inesperada do servidor)', () => {
    it('providência: mensagem genérica, sem "Atualizar", diálogo continua aberto', async () => {
      const dialogo = await abrirProvidencia({
        providencia: () => respostaFalsa(500, { erro: 'Erro interno.' }),
      });
      await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), 'Texto fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_GENERICA_PROVIDENCIA);
      expect(alerta).not.toHaveTextContent('Erro interno.');
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Registrar providência' })).toBeInTheDocument();
    });

    it('encerramento: mensagem genérica, sem "Atualizar", status inalterado', async () => {
      const dialogo = await abrirEncerramento({
        encerrar: () => respostaFalsa(500, { erro: 'Erro interno.' }),
      });
      await confirmarEncerramento(dialogo);
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_GENERICA_ENCERRAMENTO);
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
    });
  });

  describe('Pedagógico não responsável (RN22)', () => {
    it('registra providência e encerra a ocorrência', async () => {
      const dialogo = await abrirProvidencia({ perfil: 'PEDAGOGICO' });
      await usuario.type(
        within(dialogo).getByLabelText('Descrição da providência'),
        'Contato fictício com a coordenação.',
      );
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));
      await screen.findByText('Providência registrada.');
      const secao = screen.getByRole('region', { name: 'Providências adotadas' });
      expect(within(secao).getByText('Contato fictício com a coordenação.')).toBeInTheDocument();
      expect(within(secao).getByText('Orientação fictícia ao estudante.')).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      const confirmacao = await screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' });
      await confirmarEncerramento(confirmacao);
      await screen.findByText('Ocorrência encerrada.');
      expect(valorDe('Status')).toHaveTextContent('Encerrado');
      expect(valorDe('Data de encerramento')).toHaveTextContent('01/11/2026 às 15:45');
      expect(botoesDeAcao()).toEqual([]);
      expect(gets()).toHaveLength(1);
    });
  });

  describe('resposta sem corpo (fora do contrato)', () => {
    it('providência 201 vazia: busca o detalhe de novo', async () => {
      let consultas = 0;
      const dialogo = await abrirProvidencia({
        detalhe: () => respostaFalsa(200, ++consultas === 1 ? BASE : APOS_PROVIDENCIA),
        providencia: () => respostaFalsa(201),
      });
      await usuario.type(within(dialogo).getByLabelText('Descrição da providência'), 'Texto fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));
      expect(await screen.findByText('Contato fictício com a coordenação.')).toBeInTheDocument();
      expect(consultas).toBe(2);
    });

    it('encerramento 200 vazio: busca o detalhe de novo e mostra "Encerrado"', async () => {
      let consultas = 0;
      const dialogo = await abrirEncerramento({
        detalhe: () => respostaFalsa(200, ++consultas === 1 ? BASE : ENCERRADO),
        encerrar: () => respostaFalsa(200),
      });
      await confirmarEncerramento(dialogo);
      await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Encerrado'));
      expect(botoesDeAcao()).toEqual([]);
      expect(consultas).toBe(2);
    });
  });

  describe('fechar diálogos', () => {
    it('encerramento: Esc fora do envio fecha sem enviar', async () => {
      await abrirEncerramento();
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(patches()).toHaveLength(0);
      expect(botoesDeAcao()).toContain('Encerrar ocorrência');
    });

    it('encerramento: "Cancelar" durante o envio não fecha', async () => {
      let liberar;
      const dialogo = await abrirEncerramento({
        encerrar: () =>
          new Promise((resolve) => {
            liberar = () => resolve(respostaFalsa(200, ENCERRADO));
          }),
      });
      await confirmarEncerramento(dialogo);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      liberar();
      await screen.findByText('Ocorrência encerrada.');
    });

    it('providência: Esc e "Cancelar" durante o envio não fecham e o campo fica travado', async () => {
      let liberar;
      const dialogo = await abrirProvidencia({
        providencia: () =>
          new Promise((resolve) => {
            liberar = () => resolve(respostaFalsa(201, APOS_PROVIDENCIA));
          }),
      });
      const campo = within(dialogo).getByLabelText('Descrição da providência');
      await usuario.type(campo, 'Texto fictício.');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar' }));
      expect(campo).toHaveAttribute('readonly');
      await usuario.keyboard('{Escape}');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.getByRole('dialog', { name: 'Registrar providência' })).toBeInTheDocument();
      liberar();
      await screen.findByText('Providência registrada.');
      expect(posts()).toHaveLength(1);
    });
  });

  describe('aviso da RN04', () => {
    it('some ao abrir "Encaminhar" ou "Registrar comunicação"', async () => {
      await abrir({ detalhe: () => respostaFalsa(200, SEM_PROVIDENCIA) });
      for (const acao of ['Encaminhar', 'Registrar comunicação']) {
        await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
        expect(screen.getByText(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA)).toBeInTheDocument();
        await usuario.click(screen.getByRole('button', { name: acao }));
        expect(screen.queryByText(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA)).toBeNull();
        await usuario.keyboard('{Escape}');
      }
      expect(patches()).toHaveLength(0);
    });

    it('Tutor responsável também recebe a orientação e nada é enviado', async () => {
      await abrir({
        perfil: 'TUTOR',
        id: ID_RESPONSAVEL,
        detalhe: () => respostaFalsa(200, SEM_PROVIDENCIA),
      });
      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      expect(screen.getByRole('alert')).toHaveTextContent(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA);
      expect(patches()).toHaveLength(0);
    });
  });
});
