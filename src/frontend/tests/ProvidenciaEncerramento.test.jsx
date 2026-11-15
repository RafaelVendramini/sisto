// Fluxos da Issue #84 — providência e encerramento no detalhe da ocorrência
// (UC04, RF10, RF12, RN04, RN17, RN19, RN22, RNF01, RNF02): botões
// "Registrar providência" e "Encerrar ocorrência" só em "Em acompanhamento",
// para Gestão, Pedagógico e o responsável pelo acompanhamento; diálogo com a
// descrição (obrigatória, até 5000); confirmação antes de encerrar; orientação
// da RN04 sem providência; detalhe atualizado pela resposta da API; ocorrência
// encerrada sem ações, com selo e data de encerramento em São Paulo; erros
// 400/403/404/409/sem conexão/401; trava contra duplo envio.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MENSAGEM_CONFLITO_OCORRENCIA,
  MENSAGEM_ENCERRAR_SEM_PROVIDENCIA,
  MENSAGEM_PROVIDENCIA_DESCRICAO_LONGA,
  MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA,
  PERGUNTA_ENCERRAMENTO,
  atualizacaoOcorrenciaPedeAtualizacao,
  mensagemErroEncerramento,
  mensagemErroProvidencia,
  temProvidencia,
  validarProvidencia,
} from '../src/services/mensagensOcorrencias.js';
import { encerrarOcorrencia, registrarProvidencia } from '../src/services/ocorrencias.js';
import { PERFIS_ATUALIZACAO_OCORRENCIA, podeAtualizarOcorrencia } from '../src/services/perfis.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const STATUS = ['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO'];

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
const MSG_PROVIDENCIA_REGISTRADA = 'Providência registrada.';
const MSG_OCORRENCIA_ENCERRADA = 'Ocorrência encerrada.';
const MSG_GENERICA_PROVIDENCIA =
  'Não foi possível registrar a providência agora. Tente novamente em instantes.';
const MSG_GENERICA_ENCERRAMENTO =
  'Não foi possível encerrar a ocorrência agora. Tente novamente em instantes.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ID_USUARIO = 9;
const ID_RESPONSAVEL = 20;

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };

const PROVIDENCIA_EXISTENTE = Object.freeze({
  id: 400,
  descricao: 'Conversa fictícia com o estudante.',
  dataHora: '2026-10-31T12:00:00.000Z',
  registradoPor: { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia' },
});

const NOVA_PROVIDENCIA = Object.freeze({
  id: 401,
  descricao: 'Reunião fictícia com a família.',
  dataHora: '2026-10-31T13:30:00.000Z',
  registradoPor: { id: ID_USUARIO, nome: 'Pessoa Fictícia' },
});

// "Em acompanhamento" sem providência: encerrar mostra a orientação da RN04.
const DETALHE_SEM_PROVIDENCIA = Object.freeze({
  id: 12,
  dataHora: '2026-10-30T12:39:00.000Z',
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
  responsavelAcompanhamento: { id: ID_RESPONSAVEL, nome: 'Pedagoga Fictícia' },
  estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [],
});

const DETALHE_COM_PROVIDENCIA = Object.freeze({
  ...DETALHE_SEM_PROVIDENCIA,
  providencias: [PROVIDENCIA_EXISTENTE],
});

// Resposta 201 do POST de providência: detalhe completo, mesmo status.
const DETALHE_APOS_PROVIDENCIA = Object.freeze({
  ...DETALHE_SEM_PROVIDENCIA,
  providencias: [NOVA_PROVIDENCIA],
});

// Resposta 200 do PATCH de status: detalhe completo, já encerrado.
// 13:05 UTC = 10:05 em São Paulo (RN17).
const DETALHE_ENCERRADO = Object.freeze({
  ...DETALHE_COM_PROVIDENCIA,
  status: 'ENCERRADO',
  dataEncerramento: '2026-10-31T13:05:00.000Z',
});

const DETALHE_ABERTO = Object.freeze({
  ...DETALHE_SEM_PROVIDENCIA,
  status: 'ABERTO',
  responsavelAcompanhamento: null,
});

/** Roteia o fetch mockado: GET do detalhe, POST da providência e PATCH do status. */
function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE_COM_PROVIDENCIA),
  providencia = () => respostaFalsa(201, DETALHE_APOS_PROVIDENCIA),
  encerrar = () => respostaFalsa(200, DETALHE_ENCERRADO),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'POST' && /\/ocorrencias\/[^/]+\/providencias$/.test(url)) {
      return providencia(JSON.parse(body));
    }
    if (method === 'PATCH' && /\/ocorrencias\/[^/]+\/status$/.test(url)) {
      return encerrar(JSON.parse(body));
    }
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (method === 'GET' && get) return detalhe(decodeURIComponent(get[1]));
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO', id = ID_USUARIO) {
  gravarSessaoFicticia({ usuario: { id, nome: 'Pessoa Fictícia', perfil } });
}

function chamadas(metodo, sufixo) {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === metodo && url.endsWith(sufixo),
  );
}
const postsProvidencia = () => chamadas('POST', '/ocorrencias/12/providencias');
const patchesStatus = () => chamadas('PATCH', '/ocorrencias/12/status');
const getsDetalhe = () => chamadas('GET', '/ocorrencias/12');

/** Valor (dd) do rótulo (dt) na página. */
function valorDe(rotulo) {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

function botoesDeAcao() {
  const acoes = screen.queryByRole('region', { name: 'Ações sobre a ocorrência' });
  return acoes ? within(acoes).getAllByRole('button').map((b) => b.textContent) : [];
}

describe('Providência e encerramento no detalhe da ocorrência (#84)', () => {
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

  async function abrirDetalhe({ perfil = 'GESTAO', id = ID_USUARIO, ...api } = {}) {
    sessao(perfil, id);
    mockarApi(api);
    renderizarApp('/ocorrencias/12');
    await screen.findByText('Dados da ocorrência');
  }

  async function abrirProvidencia(opcoes) {
    await abrirDetalhe(opcoes);
    await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
    return screen.findByRole('dialog', { name: 'Registrar providência' });
  }

  async function abrirEncerramento(opcoes) {
    await abrirDetalhe(opcoes);
    await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
    return screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' });
  }

  function camposProvidencia(dialogo) {
    return {
      descricao: within(dialogo).getByLabelText('Descrição da providência'),
      enviar: within(dialogo).getByRole('button', { name: /^Registr/ }),
    };
  }

  describe('quem vê os botões (RN04, RN22)', () => {
    const casos = PERFIS.flatMap((perfil) => STATUS.map((status) => [perfil, status]));

    it.each(casos)('%s (não responsável) com ocorrência %s', async (perfil, status) => {
      await abrirDetalhe({
        perfil,
        detalhe: () => respostaFalsa(200, { ...DETALHE_COM_PROVIDENCIA, status }),
      });
      const deveVer = ['GESTAO', 'PEDAGOGICO'].includes(perfil) && status === 'EM_ACOMPANHAMENTO';
      for (const nome of ['Registrar providência', 'Encerrar ocorrência']) {
        const botao = screen.queryByRole('button', { name: nome });
        if (deveVer) expect(botao).toBeInTheDocument();
        else expect(botao).not.toBeInTheDocument();
      }
    });

    it('Tutor responsável pelo acompanhamento vê os dois botões', async () => {
      await abrirDetalhe({ perfil: 'TUTOR', id: ID_RESPONSAVEL });
      expect(botoesDeAcao()).toEqual([
        'Registrar comunicação',
        'Registrar providência',
        'Encerrar ocorrência',
      ]);
    });

    it('Tutor não responsável vê só "Registrar comunicação"', async () => {
      await abrirDetalhe({ perfil: 'TUTOR', id: ID_USUARIO });
      expect(botoesDeAcao()).toEqual(['Registrar comunicação']);
    });

    it('Professor e Técnico-administrativo não têm área de ações', async () => {
      for (const perfil of ['PROFESSOR', 'TECNICO_ADMINISTRATIVO']) {
        sessionStorage.clear();
        await abrirDetalhe({ perfil });
        expect(botoesDeAcao()).toEqual([]);
        cleanup();
      }
    });

    it('Gestão e Pedagógico veem as quatro ações em "Em acompanhamento"', async () => {
      for (const perfil of ['GESTAO', 'PEDAGOGICO']) {
        sessionStorage.clear();
        await abrirDetalhe({ perfil });
        expect(botoesDeAcao()).toEqual([
          'Encaminhar',
          'Registrar comunicação',
          'Registrar providência',
          'Encerrar ocorrência',
        ]);
        cleanup();
      }
    });

    it('em "Aberto" os botões não aparecem, nem para o responsável', async () => {
      await abrirDetalhe({ detalhe: () => respostaFalsa(200, DETALHE_ABERTO) });
      expect(botoesDeAcao()).toEqual(['Encaminhar', 'Registrar comunicação']);
    });

    it('podeAtualizarOcorrencia segue a RN22', () => {
      expect(PERFIS_ATUALIZACAO_OCORRENCIA).toEqual(['GESTAO', 'PEDAGOGICO']);
      const em = DETALHE_SEM_PROVIDENCIA;
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'GESTAO' }, em)).toBe(true);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'PEDAGOGICO' }, em)).toBe(true);
      expect(podeAtualizarOcorrencia({ id: ID_RESPONSAVEL, perfil: 'TUTOR' }, em)).toBe(true);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'TUTOR' }, em)).toBe(false);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'PROFESSOR' }, em)).toBe(false);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'GESTAO' }, DETALHE_ABERTO)).toBe(false);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'GESTAO' }, DETALHE_ENCERRADO)).toBe(false);
      expect(
        podeAtualizarOcorrencia({ id: undefined, perfil: 'TUTOR' }, { ...em, responsavelAcompanhamento: null }),
      ).toBe(false);
      expect(podeAtualizarOcorrencia(null, em)).toBe(false);
      expect(podeAtualizarOcorrencia({ id: 1, perfil: 'GESTAO' }, null)).toBe(false);
    });
  });

  describe('ocorrência encerrada', () => {
    it('sem nenhum botão de ação, com selo "Encerrado" e data de encerramento em São Paulo', async () => {
      for (const perfil of PERFIS) {
        sessionStorage.clear();
        await abrirDetalhe({ perfil, id: ID_RESPONSAVEL, detalhe: () => respostaFalsa(200, DETALHE_ENCERRADO) });
        expect(botoesDeAcao()).toEqual([]);
        for (const nome of ['Encaminhar', 'Registrar comunicação', 'Registrar providência', 'Encerrar ocorrência']) {
          expect(screen.queryByRole('button', { name: nome })).not.toBeInTheDocument();
        }
        expect(valorDe('Status')).toHaveTextContent('Encerrado');
        expect(valorDe('Data de encerramento')).toHaveTextContent('31/10/2026 às 10:05');
        cleanup();
      }
    });
  });

  describe('registrar providência', () => {
    it('diálogo com campo rotulado, foco na descrição e limite de 5000', async () => {
      const dialogo = await abrirProvidencia();
      const { descricao } = camposProvidencia(dialogo);
      expect(descricao).toHaveFocus();
      expect(descricao).toHaveValue('');
      expect(descricao.tagName).toBe('TEXTAREA');
      expect(descricao).toHaveAttribute('maxLength', '5000');
      expect(descricao).toHaveAccessibleDescription(/Obrigatório\. Até 5000 caracteres\./);
      expect(dialogo).toHaveAccessibleDescription(/ocorrência nº 12/);
    });

    it('Gestão registra e vê a providência na lista, com autor e data/hora, sem recarregar', async () => {
      const dialogo = await abrirProvidencia({
        detalhe: () => respostaFalsa(200, DETALHE_SEM_PROVIDENCIA),
      });
      const c = camposProvidencia(dialogo);
      await usuario.type(c.descricao, 'Reunião fictícia com a família.');
      await usuario.click(c.enviar);

      expect(await screen.findByText(MSG_PROVIDENCIA_REGISTRADA)).toHaveFocus();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(postsProvidencia()).toHaveLength(1);
      expect(JSON.parse(postsProvidencia()[0][1].body)).toEqual({
        descricao: 'Reunião fictícia com a família.',
      });
      expect(postsProvidencia()[0][1].headers.Authorization).toMatch(/^Bearer /);

      const secao = screen.getByRole('region', { name: 'Providências adotadas' });
      expect(within(secao).getByText('Reunião fictícia com a família.')).toBeInTheDocument();
      expect(within(secao).getByText('Pessoa Fictícia')).toBeInTheDocument();
      // 13:30 UTC = 10:30 em São Paulo (RN17).
      expect(within(secao).getByText('31/10/2026 às 10:30')).toBeInTheDocument();
      expect(within(secao).queryByText('Nenhuma providência registrada.')).toBeNull();
      expect(getsDetalhe()).toHaveLength(1);
      // Registrar providência não muda o status.
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
    });

    it('Tutor responsável registra providência', async () => {
      const dialogo = await abrirProvidencia({ perfil: 'TUTOR', id: ID_RESPONSAVEL });
      const c = camposProvidencia(dialogo);
      await usuario.type(c.descricao, 'Texto fictício.');
      await usuario.click(c.enviar);
      expect(await screen.findByText(MSG_PROVIDENCIA_REGISTRADA)).toBeInTheDocument();
      expect(postsProvidencia()).toHaveLength(1);
    });

    it('Cancelar e Esc fecham sem enviar; reabrir começa limpo', async () => {
      const dialogo = await abrirProvidencia();
      await usuario.type(camposProvidencia(dialogo).descricao, 'Algo fictício');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Registrar providência' })).toHaveFocus();

      await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
      const novo = await screen.findByRole('dialog', { name: 'Registrar providência' });
      expect(camposProvidencia(novo).descricao).toHaveValue('');
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(postsProvidencia()).toHaveLength(0);
    });

    describe('validação da descrição', () => {
      it('vazia: mensagem no campo, foco nele e nada enviado', async () => {
        const dialogo = await abrirProvidencia();
        const c = camposProvidencia(dialogo);
        await usuario.click(c.enviar);
        expect(c.descricao).toHaveAttribute('aria-invalid', 'true');
        expect(c.descricao).toHaveAccessibleDescription(
          expect.stringContaining(MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA),
        );
        expect(c.descricao).toHaveFocus();
        expect(postsProvidencia()).toHaveLength(0);
      });

      it('só com espaços conta como vazia', async () => {
        const dialogo = await abrirProvidencia();
        const c = camposProvidencia(dialogo);
        await usuario.type(c.descricao, '    ');
        await usuario.click(c.enviar);
        expect(within(dialogo).getByText(MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA)).toBeInTheDocument();
        expect(postsProvidencia()).toHaveLength(0);
      });

      it('digitar após o erro tira a mensagem', async () => {
        const dialogo = await abrirProvidencia();
        const c = camposProvidencia(dialogo);
        await usuario.click(c.enviar);
        await usuario.type(c.descricao, 'x');
        expect(c.descricao).toHaveAttribute('aria-invalid', 'false');
        expect(within(dialogo).queryByText(MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA)).toBeNull();
      });

      it('5000 caracteres é aceito e enviado', async () => {
        const dialogo = await abrirProvidencia();
        const c = camposProvidencia(dialogo);
        const texto = 'a'.repeat(5000);
        fireEvent.change(c.descricao, { target: { value: texto } });
        await usuario.click(c.enviar);
        expect(await screen.findByText(MSG_PROVIDENCIA_REGISTRADA)).toBeInTheDocument();
        expect(JSON.parse(postsProvidencia()[0][1].body).descricao).toHaveLength(5000);
      });

      it('mais de 5000 (contornando o maxLength) é bloqueado', async () => {
        const dialogo = await abrirProvidencia();
        const c = camposProvidencia(dialogo);
        fireEvent.change(c.descricao, { target: { value: 'a'.repeat(5001) } });
        await usuario.click(c.enviar);
        expect(within(dialogo).getByText(MENSAGEM_PROVIDENCIA_DESCRICAO_LONGA)).toBeInTheDocument();
        expect(postsProvidencia()).toHaveLength(0);
      });

      it('validarProvidencia', () => {
        expect(validarProvidencia({ descricao: '' })).toEqual({
          descricao: MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA,
        });
        expect(validarProvidencia({ descricao: '  \n ' })).toEqual({
          descricao: MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA,
        });
        expect(validarProvidencia({ descricao: 'ok' })).toEqual({});
        expect(validarProvidencia({ descricao: ` ${'a'.repeat(5000)} ` })).toEqual({});
        expect(validarProvidencia({ descricao: 'a'.repeat(5001) })).toEqual({
          descricao: MENSAGEM_PROVIDENCIA_DESCRICAO_LONGA,
        });
      });
    });

    it('duplo clique envia uma vez só', async () => {
      let liberar;
      const dialogo = await abrirProvidencia({
        providencia: () =>
          new Promise((resolve) => {
            liberar = () => resolve(respostaFalsa(201, DETALHE_APOS_PROVIDENCIA));
          }),
      });
      const c = camposProvidencia(dialogo);
      await usuario.type(c.descricao, 'Texto fictício.');
      await usuario.dblClick(c.enviar);
      expect(c.enviar).toHaveTextContent('Registrando...');
      expect(c.enviar).toHaveAttribute('aria-disabled', 'true');
      expect(postsProvidencia()).toHaveLength(1);
      liberar();
      expect(await screen.findByText(MSG_PROVIDENCIA_REGISTRADA)).toBeInTheDocument();
      expect(postsProvidencia()).toHaveLength(1);
    });

    describe('erros da API', () => {
      async function enviarComErro(providencia, opcoes = {}) {
        const dialogo = await abrirProvidencia({ providencia, ...opcoes });
        const c = camposProvidencia(dialogo);
        await usuario.type(c.descricao, 'Texto fictício.');
        await usuario.click(c.enviar);
        const alerta = await within(dialogo).findByRole('alert');
        return { dialogo, alerta, ...c };
      }

      it('400: mensagem da API, mantendo o texto', async () => {
        const mensagemApi = 'A descricao contém caractere inválido.';
        const { alerta, descricao } = await enviarComErro(() =>
          respostaFalsa(400, { erro: mensagemApi }),
        );
        expect(alerta).toHaveTextContent(mensagemApi);
        expect(descricao).toHaveValue('Texto fictício.');
        expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      });

      it('403: mensagem de perfil sem permissão', async () => {
        const { alerta } = await enviarComErro(() =>
          respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
        );
        expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
        expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      });

      it('sem conexão: mensagem compreensível e dá para tentar de novo', async () => {
        let tentativa = 0;
        const { alerta, enviar } = await enviarComErro(() =>
          ++tentativa === 1
            ? Promise.reject(new TypeError('Failed to fetch'))
            : respostaFalsa(201, DETALHE_APOS_PROVIDENCIA),
        );
        expect(alerta).toHaveTextContent(MSG_SEM_CONEXAO);
        await usuario.click(enviar);
        expect(await screen.findByText(MSG_PROVIDENCIA_REGISTRADA)).toBeInTheDocument();
        expect(postsProvidencia()).toHaveLength(2);
      });

      it('404: "Ocorrência não encontrada." com "Atualizar a ocorrência"', async () => {
        let consultas = 0;
        const { alerta } = await enviarComErro(
          () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
          {
            detalhe: () =>
              ++consultas === 1
                ? respostaFalsa(200, DETALHE_COM_PROVIDENCIA)
                : respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
          },
        );
        expect(alerta).toHaveTextContent(MSG_NAO_ENCONTRADA);
        await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
        expect(consultas).toBe(2);
      });

      it('409: mensagem do back-end e "Atualizar a ocorrência" recarrega sem os botões', async () => {
        const mensagemApi = 'Ocorrência encerrada não recebe providências.';
        let consultas = 0;
        const { alerta } = await enviarComErro(() => respostaFalsa(409, { erro: mensagemApi }), {
          detalhe: () =>
            respostaFalsa(200, ++consultas === 1 ? DETALHE_COM_PROVIDENCIA : DETALHE_ENCERRADO),
        });
        expect(alerta).toHaveTextContent(mensagemApi);
        await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Encerrado'));
        expect(botoesDeAcao()).toEqual([]);
        expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toHaveFocus();
        expect(consultas).toBe(2);
      });

      it('409 de conflito concorrente: mensagem do back-end com "Atualizar a ocorrência"', async () => {
        const mensagemApi =
          'Não foi possível registrar a providência por causa de outra operação ao mesmo tempo. Tente novamente.';
        const { alerta } = await enviarComErro(() => respostaFalsa(409, { erro: mensagemApi }));
        expect(alerta).toHaveTextContent(mensagemApi);
        expect(
          within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }),
        ).toBeInTheDocument();
      });

      it('401: tratamento central leva ao login com aviso', async () => {
        const dialogo = await abrirProvidencia({
          providencia: () => respostaFalsa(401, { erro: 'Não autenticado.' }),
        });
        const c = camposProvidencia(dialogo);
        await usuario.type(c.descricao, 'Texto fictício.');
        await usuario.click(c.enviar);
        expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('encerrar ocorrência', () => {
    it('sem providência: orientação da RN04, sem diálogo e sem envio', async () => {
      await abrirDetalhe({ detalhe: () => respostaFalsa(200, DETALHE_SEM_PROVIDENCIA) });
      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      const aviso = screen.getByRole('alert');
      expect(aviso).toHaveTextContent(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA);
      expect(aviso).toHaveFocus();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(patchesStatus()).toHaveLength(0);
      // O botão continua visível (RN04: a tela orienta, não esconde).
      expect(screen.getByRole('button', { name: 'Encerrar ocorrência' })).toBeInTheDocument();
    });

    it('depois de registrar a providência, o aviso some e o encerramento é liberado', async () => {
      await abrirDetalhe({ detalhe: () => respostaFalsa(200, DETALHE_SEM_PROVIDENCIA) });
      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      expect(screen.getByRole('alert')).toHaveTextContent(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA);

      await usuario.click(screen.getByRole('button', { name: 'Registrar providência' }));
      expect(screen.queryByText(MENSAGEM_ENCERRAR_SEM_PROVIDENCIA)).toBeNull();
      const dialogo = await screen.findByRole('dialog', { name: 'Registrar providência' });
      const c = camposProvidencia(dialogo);
      await usuario.type(c.descricao, 'Texto fictício.');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_PROVIDENCIA_REGISTRADA);

      await usuario.click(screen.getByRole('button', { name: 'Encerrar ocorrência' }));
      expect(
        await screen.findByRole('alertdialog', { name: 'Encerrar ocorrência' }),
      ).toBeInTheDocument();
    });

    it('confirmação: pergunta clara, foco em Cancelar; Cancelar não envia', async () => {
      const dialogo = await abrirEncerramento();
      expect(dialogo).toHaveTextContent(PERGUNTA_ENCERRAMENTO);
      expect(PERGUNTA_ENCERRAMENTO).toBe(
        'Encerrar a ocorrência? Depois de encerrada, ela não recebe mais encaminhamentos, comunicações nem providências.',
      );
      expect(dialogo).toHaveAccessibleDescription(/não recebe mais encaminhamentos/);
      const cancelar = within(dialogo).getByRole('button', { name: 'Cancelar' });
      expect(cancelar).toHaveFocus();
      await usuario.click(cancelar);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(patchesStatus()).toHaveLength(0);
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
    });

    it('Gestão encerra: selo "Encerrado", data de encerramento e botões ocultos, sem recarregar', async () => {
      const dialogo = await abrirEncerramento();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));

      expect(await screen.findByText(MSG_OCORRENCIA_ENCERRADA)).toHaveFocus();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(patchesStatus()).toHaveLength(1);
      expect(JSON.parse(patchesStatus()[0][1].body)).toEqual({ status: 'ENCERRADO' });
      expect(valorDe('Status')).toHaveTextContent('Encerrado');
      expect(valorDe('Data de encerramento')).toHaveTextContent('31/10/2026 às 10:05');
      expect(botoesDeAcao()).toEqual([]);
      expect(getsDetalhe()).toHaveLength(1);
    });

    it('Tutor responsável encerra', async () => {
      const dialogo = await abrirEncerramento({ perfil: 'TUTOR', id: ID_RESPONSAVEL });
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));
      expect(await screen.findByText(MSG_OCORRENCIA_ENCERRADA)).toBeInTheDocument();
      expect(botoesDeAcao()).toEqual([]);
    });

    it('duplo clique envia uma vez só', async () => {
      let liberar;
      const dialogo = await abrirEncerramento({
        encerrar: () =>
          new Promise((resolve) => {
            liberar = () => resolve(respostaFalsa(200, DETALHE_ENCERRADO));
          }),
      });
      const confirmar = within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' });
      await usuario.dblClick(confirmar);
      expect(confirmar).toHaveTextContent('Encerrando...');
      expect(confirmar).toHaveAttribute('aria-disabled', 'true');
      // Durante o envio, Cancelar e Esc não fecham.
      await usuario.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(patchesStatus()).toHaveLength(1);
      liberar();
      expect(await screen.findByText(MSG_OCORRENCIA_ENCERRADA)).toBeInTheDocument();
    });

    describe('erros da API', () => {
      async function encerrarComErro(encerrar, opcoes = {}) {
        const dialogo = await abrirEncerramento({ encerrar, ...opcoes });
        await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));
        const alerta = await within(dialogo).findByRole('alert');
        return { dialogo, alerta };
      }

      it('403: mensagem de perfil sem permissão, sem encerrar', async () => {
        const { alerta } = await encerrarComErro(() =>
          respostaFalsa(403, { erro: 'Acesso não permitido para o seu perfil.' }),
        );
        expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
        expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
        expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
      });

      it('sem conexão: mensagem compreensível e dá para tentar de novo', async () => {
        let tentativa = 0;
        const { dialogo, alerta } = await encerrarComErro(() =>
          ++tentativa === 1
            ? Promise.reject(new TypeError('Failed to fetch'))
            : respostaFalsa(200, DETALHE_ENCERRADO),
        );
        expect(alerta).toHaveTextContent(MSG_SEM_CONEXAO);
        await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));
        expect(await screen.findByText(MSG_OCORRENCIA_ENCERRADA)).toBeInTheDocument();
        expect(patchesStatus()).toHaveLength(2);
      });

      it('404: "Ocorrência não encontrada." com "Atualizar a ocorrência"', async () => {
        let consultas = 0;
        const { alerta } = await encerrarComErro(
          () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
          {
            detalhe: () =>
              ++consultas === 1
                ? respostaFalsa(200, DETALHE_COM_PROVIDENCIA)
                : respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
          },
        );
        expect(alerta).toHaveTextContent(MSG_NAO_ENCONTRADA);
        await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
        expect(consultas).toBe(2);
      });

      it('409 (já encerrada por outra pessoa): mensagem do back-end e "Atualizar a ocorrência"', async () => {
        const mensagemApi = 'A ocorrência já está encerrada.';
        let consultas = 0;
        const { alerta } = await encerrarComErro(() => respostaFalsa(409, { erro: mensagemApi }), {
          detalhe: () =>
            respostaFalsa(200, ++consultas === 1 ? DETALHE_COM_PROVIDENCIA : DETALHE_ENCERRADO),
        });
        expect(alerta).toHaveTextContent(mensagemApi);
        await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Encerrado'));
        expect(botoesDeAcao()).toEqual([]);
        expect(consultas).toBe(2);
      });

      it('409 sem mensagem do back-end: texto padrão de conflito', async () => {
        const { alerta } = await encerrarComErro(() => respostaFalsa(409));
        expect(alerta).toHaveTextContent(MENSAGEM_CONFLITO_OCORRENCIA);
        expect(
          within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }),
        ).toBeInTheDocument();
      });

      it('401: tratamento central leva ao login com aviso', async () => {
        const dialogo = await abrirEncerramento({
          encerrar: () => respostaFalsa(401, { erro: 'Não autenticado.' }),
        });
        await usuario.click(within(dialogo).getByRole('button', { name: 'Encerrar ocorrência' }));
        expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    });
  });

  describe('serviços e mensagens', () => {
    it('registrarProvidencia: POST com só a descrição', async () => {
      sessao();
      mockarApi();
      const detalhe = await registrarProvidencia(12, { descricao: 'Texto', extra: 'x' });
      expect(detalhe).toEqual(DETALHE_APOS_PROVIDENCIA);
      const [url, opcoes] = postsProvidencia()[0];
      expect(url).toBe(`${URL_API}/ocorrencias/12/providencias`);
      expect(JSON.parse(opcoes.body)).toEqual({ descricao: 'Texto' });
    });

    it('encerrarOcorrencia: PATCH com status ENCERRADO', async () => {
      sessao();
      mockarApi();
      const detalhe = await encerrarOcorrencia(12);
      expect(detalhe).toEqual(DETALHE_ENCERRADO);
      const [url, opcoes] = patchesStatus()[0];
      expect(url).toBe(`${URL_API}/ocorrencias/12/status`);
      expect(JSON.parse(opcoes.body)).toEqual({ status: 'ENCERRADO' });
    });

    it('mensagens por status', () => {
      for (const [fn, generica] of [
        [mensagemErroProvidencia, MSG_GENERICA_PROVIDENCIA],
        [mensagemErroEncerramento, MSG_GENERICA_ENCERRAMENTO],
      ]) {
        expect(fn({ status: 403, doServidor: true, message: 'x' })).toBe(MSG_SEM_PERMISSAO);
        expect(fn({ status: 0 })).toBe(MSG_SEM_CONEXAO);
        expect(fn({ status: 404, doServidor: true, message: 'x' })).toBe(MSG_NAO_ENCONTRADA);
        expect(fn({ status: 409, doServidor: true, message: 'Do servidor.' })).toBe('Do servidor.');
        expect(fn({ status: 409 })).toBe(MENSAGEM_CONFLITO_OCORRENCIA);
        expect(fn({ status: 400, doServidor: true, message: 'Inválido.' })).toBe('Inválido.');
        expect(fn({ status: 400 })).toBe(generica);
        expect(fn({ status: 500, doServidor: true, message: 'Erro interno.' })).toBe(generica);
        expect(fn(undefined)).toBe(generica);
      }
      expect(atualizacaoOcorrenciaPedeAtualizacao({ status: 404 })).toBe(true);
      expect(atualizacaoOcorrenciaPedeAtualizacao({ status: 409 })).toBe(true);
      expect(atualizacaoOcorrenciaPedeAtualizacao({ status: 403 })).toBe(false);
      expect(atualizacaoOcorrenciaPedeAtualizacao({ status: 0 })).toBe(false);
      expect(temProvidencia(DETALHE_SEM_PROVIDENCIA)).toBe(false);
      expect(temProvidencia(DETALHE_COM_PROVIDENCIA)).toBe(true);
      expect(temProvidencia(null)).toBe(false);
    });
  });
});
