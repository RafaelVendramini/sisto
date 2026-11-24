// Fluxos da Issue #52 — registro de comunicação no detalhe da ocorrência
// (RF09, RN16, RN17, RNF01, RNF02): botão "Registrar comunicação" só para
// Tutor, Gestão e Pedagógico em ocorrências não encerradas, ao lado de
// "Encaminhar"; diálogo com destinatário e meio (texto livre), descrição e
// data/hora do contato (sugestão: agora em São Paulo); validação no cliente;
// corpo exato enviado; detalhe atualizado pela resposta 201; erros
// 400/403/404/409/sem conexão/401; trava contra duplo envio.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MENSAGEM_COMUNICACAO_CONFLITO,
  MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA,
  MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA,
  MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA,
  MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO,
  MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO,
  mensagemErroComunicacao,
  montarEnvioComunicacao,
  validarComunicacao,
} from '../src/services/mensagensOcorrencias.js';
import { registrarComunicacao } from '../src/services/ocorrencias.js';
import {
  PERFIS_COMUNICACAO_OCORRENCIA,
  podeRegistrarComunicacao,
} from '../src/services/perfis.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'PSICOLOGO', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const STATUS = ['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO'];

// Relógio fixo: 31/10/2026 às 11:00 em São Paulo (UTC-3).
const AGORA = new Date('2026-10-31T14:00:00.000Z');
const AGORA_LOCAL = '2026-10-31T11:00';

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_SUCESSO = 'Comunicação registrada.';
const MSG_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
const MSG_GENERICA = 'Não foi possível registrar a comunicação agora. Tente novamente em instantes.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };

const DETALHE_ABERTO = Object.freeze({
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
  status: 'ABERTO',
  dataEncerramento: null,
  profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
  responsavelAcompanhamento: null,
  estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [],
});

const DETALHE_ACOMPANHAMENTO = Object.freeze({
  ...DETALHE_ABERTO,
  status: 'EM_ACOMPANHAMENTO',
  responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
});

const DETALHE_ENCERRADO = Object.freeze({
  ...DETALHE_ACOMPANHAMENTO,
  status: 'ENCERRADO',
  dataEncerramento: '2026-10-31T13:05:00.000Z',
});

const NOVA_COMUNICACAO = Object.freeze({
  id: 300,
  destinatario: 'Responsável fictício pelo estudante',
  meio: 'Telefone',
  descricao: 'Conversa fictícia sobre o fato.',
  dataHora: '2026-10-31T13:30:00.000Z',
  registradoPor: { id: 9, nome: 'Pessoa Fictícia' },
});

// Resposta 201: o detalhe completo, com a nova comunicação e o mesmo status.
const DETALHE_APOS_COMUNICAR = Object.freeze({
  ...DETALHE_ABERTO,
  comunicacoes: [NOVA_COMUNICACAO],
});

/** Roteia o fetch mockado: GET do detalhe e POST da comunicação (corpo já em objeto). */
function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE_ABERTO),
  comunicar = () => respostaFalsa(201, DETALHE_APOS_COMUNICAR),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'POST' && /\/ocorrencias\/[^/]+\/comunicacoes$/.test(url)) {
      return comunicar(JSON.parse(body));
    }
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (method === 'GET' && get) return detalhe(decodeURIComponent(get[1]));
    // #85: o detalhe também busca o histórico (lista vazia aqui).
    if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return respostaFalsa(200, []);
    }
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'TUTOR') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

function postsComunicacao() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'POST' && url.endsWith('/comunicacoes'),
  );
}

function getsDetalhe() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'GET' && url.endsWith('/ocorrencias/12'),
  );
}

function corpoDoPost(indice = 0) {
  return JSON.parse(postsComunicacao()[indice][1].body);
}

/** Valor (dd) do rótulo (dt) na página. */
function valorDe(rotulo) {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

describe('Registro de comunicação no detalhe da ocorrência (#52)', () => {
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
    // Desmonta antes de restaurar o fetch: nenhuma chamada pendente da tela
    // pode sair pelo fetch real (nem afetar a sessão do teste seguinte).
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Abre o detalhe e o diálogo. */
  async function abrirDialogo({ perfil = 'TUTOR', ...api } = {}) {
    sessao(perfil);
    mockarApi(api);
    renderizarApp('/ocorrencias/12');
    await usuario.click(await screen.findByRole('button', { name: 'Registrar comunicação' }));
    return screen.findByRole('dialog', { name: 'Registrar comunicação' });
  }

  function campos(dialogo) {
    return {
      destinatario: within(dialogo).getByLabelText('Destinatário'),
      meio: within(dialogo).getByLabelText('Meio'),
      descricao: within(dialogo).getByLabelText('Descrição'),
      dataHora: within(dialogo).getByLabelText('Data e hora do contato'),
      enviar: within(dialogo).getByRole('button', { name: /^Registr/ }),
    };
  }

  /** Preenche os textos obrigatórios (a data já vem com "agora"). */
  async function preencher(dialogo) {
    const c = campos(dialogo);
    await usuario.type(c.destinatario, 'Responsável fictício pelo estudante');
    await usuario.type(c.meio, 'Telefone');
    await usuario.type(c.descricao, 'Conversa fictícia sobre o fato.');
    return c;
  }

  // datetime-local no jsdom: o valor é trocado direto, como nos testes do registro.
  async function trocarData(campo, valor) {
    fireEvent.change(campo, { target: { value: valor } });
  }

  describe('permissões (RN16, RN01)', () => {
    const casos = PERFIS.flatMap((perfil) => STATUS.map((status) => [perfil, status]));

    it.each(casos)('%s com ocorrência %s', async (perfil, status) => {
      sessao(perfil);
      mockarApi({ detalhe: () => respostaFalsa(200, { ...DETALHE_ACOMPANHAMENTO, status }) });
      renderizarApp('/ocorrencias/12');
      await screen.findByText('Dados da ocorrência');

      const deveVer =
        ['TUTOR', 'PSICOLOGO', 'GESTAO', 'PEDAGOGICO'].includes(perfil) && status !== 'ENCERRADO';
      const botao = screen.queryByRole('button', { name: 'Registrar comunicação' });
      if (deveVer) expect(botao).toBeInTheDocument();
      else expect(botao).not.toBeInTheDocument();
    });

    it('Tutor e Psicólogo escolar veem só "Registrar comunicação"; Gestão e Pedagógico veem os dois', async () => {
      for (const [perfil, esperado] of [
        ['TUTOR', ['Registrar comunicação']],
        ['PSICOLOGO', ['Registrar comunicação']],
        ['GESTAO', ['Encaminhar', 'Registrar comunicação']],
        ['PEDAGOGICO', ['Encaminhar', 'Registrar comunicação']],
      ]) {
        sessionStorage.clear();
        sessao(perfil);
        mockarApi();
        renderizarApp('/ocorrencias/12');
        const acoes = await screen.findByRole('region', { name: 'Ações sobre a ocorrência' });
        const nomes = within(acoes)
          .getAllByRole('button')
          .map((b) => b.textContent);
        expect(nomes).toEqual(esperado);
        cleanup();
      }
    });

    it('Professor e Técnico-administrativo não têm área de ações', async () => {
      for (const perfil of ['PROFESSOR', 'TECNICO_ADMINISTRATIVO']) {
        sessionStorage.clear();
        sessao(perfil);
        mockarApi();
        renderizarApp('/ocorrencias/12');
        await screen.findByText('Dados da ocorrência');
        expect(
          screen.queryByRole('region', { name: 'Ações sobre a ocorrência' }),
        ).not.toBeInTheDocument();
        cleanup();
      }
    });

    it('constante e função de perfis seguem a matriz (Tutor, Psicólogo escolar, Gestão e Pedagógico)', () => {
      expect(PERFIS_COMUNICACAO_OCORRENCIA).toEqual(['TUTOR', 'PSICOLOGO', 'GESTAO', 'PEDAGOGICO']);
      expect(PERFIS.filter(podeRegistrarComunicacao)).toEqual(['TUTOR', 'PSICOLOGO', 'GESTAO', 'PEDAGOGICO']);
      expect(podeRegistrarComunicacao(undefined)).toBe(false);
    });
  });

  describe('diálogo', () => {
    it('abre com foco no destinatário, campos rotulados e data sugerida = agora em São Paulo', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      expect(c.destinatario).toHaveFocus();
      expect(c.destinatario).toHaveValue('');
      expect(c.destinatario).toHaveAttribute('maxLength', '150');
      expect(c.meio).toHaveValue('');
      expect(c.meio).toHaveAttribute('maxLength', '150');
      // Meio é texto livre (RN16): campo de texto, sem lista fixa.
      expect(c.meio.tagName).toBe('INPUT');
      expect(c.meio).toHaveAttribute('type', 'text');
      expect(c.descricao).toHaveAttribute('maxLength', '5000');
      expect(c.dataHora).toHaveAttribute('type', 'datetime-local');
      expect(c.dataHora).toHaveValue(AGORA_LOCAL);
      expect(c.dataHora).toHaveAccessibleDescription(/Horário de São Paulo\. Não pode ser no futuro\./);
      expect(c.destinatario).toHaveAccessibleDescription(/Conselho Tutelar/);
      expect(c.meio).toHaveAccessibleDescription(/telefone, WhatsApp, e-mail, presencial/);
      expect(c.descricao).toHaveAccessibleDescription(/de forma objetiva/);
      expect(c.descricao).toHaveAccessibleDescription(/dados pessoais/);
      expect(postsComunicacao()).toHaveLength(0);
    });

    it('Cancelar fecha sem enviar e devolve o foco ao botão', async () => {
      const dialogo = await abrirDialogo();
      await usuario.type(campos(dialogo).destinatario, 'Algo fictício');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      // Com texto digitado, Cancelar pede confirmação antes de descartar (#128).
      await usuario.click(within(dialogo).getByRole('button', { name: 'Descartar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Registrar comunicação' })).toHaveFocus();
      expect(postsComunicacao()).toHaveLength(0);
    });

    it('Esc também fecha e devolve o foco ao botão', async () => {
      await abrirDialogo();
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Registrar comunicação' })).toHaveFocus();
    });

    it('reabrir começa limpo, com a data de volta para agora', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.type(c.destinatario, 'Destinatário fictício');
      await usuario.type(c.meio, 'E-mail');
      await usuario.type(c.descricao, 'Texto fictício');
      await trocarData(c.dataHora, '2026-10-30T08:15');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      // Com texto digitado, Cancelar pede confirmação antes de descartar (#128).
      await usuario.click(within(dialogo).getByRole('button', { name: 'Descartar' }));

      await usuario.click(screen.getByRole('button', { name: 'Registrar comunicação' }));
      const novo = campos(await screen.findByRole('dialog', { name: 'Registrar comunicação' }));
      expect(novo.destinatario).toHaveValue('');
      expect(novo.meio).toHaveValue('');
      expect(novo.descricao).toHaveValue('');
      expect(novo.dataHora).toHaveValue(AGORA_LOCAL);
    });
  });

  describe('validação no cliente (RN16, RN17)', () => {
    it('tudo vazio: mensagens por campo, aria-invalid e foco no primeiro inválido', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await trocarData(c.dataHora, '');
      await usuario.click(c.enviar);

      for (const [campo, mensagem] of [
        [c.destinatario, MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO],
        [c.meio, MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO],
        [c.descricao, MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA],
        [c.dataHora, MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA],
      ]) {
        expect(campo).toHaveAttribute('aria-invalid', 'true');
        expect(campo).toHaveAccessibleDescription(expect.stringContaining(mensagem));
      }
      expect(c.destinatario).toHaveFocus();
      expect(postsComunicacao()).toHaveLength(0);
    });

    it.each([
      ['destinatario', MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO],
      ['meio', MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO],
      ['descricao', MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA],
    ])('%s só com espaços é bloqueado e recebe o foco', async (nome, mensagem) => {
      const dialogo = await abrirDialogo();
      const c = await preencher(dialogo);
      await usuario.clear(c[nome]);
      await usuario.type(c[nome], '   ');
      await usuario.click(c.enviar);

      expect(c[nome]).toHaveAttribute('aria-invalid', 'true');
      expect(within(dialogo).getByText(mensagem)).toBeInTheDocument();
      expect(c[nome]).toHaveFocus();
      // Só o campo vazio fica marcado.
      const outros = ['destinatario', 'meio', 'descricao', 'dataHora'].filter((n) => n !== nome);
      for (const outro of outros) expect(c[outro]).toHaveAttribute('aria-invalid', 'false');
      expect(postsComunicacao()).toHaveLength(0);
    });

    it('data vazia é bloqueada', async () => {
      const dialogo = await abrirDialogo();
      const c = await preencher(dialogo);
      await trocarData(c.dataHora, '');
      await usuario.click(c.enviar);
      expect(within(dialogo).getByText(MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA)).toBeInTheDocument();
      expect(c.dataHora).toHaveFocus();
      expect(postsComunicacao()).toHaveLength(0);
    });

    it('data 6 minutos no futuro é bloqueada com mensagem clara', async () => {
      const dialogo = await abrirDialogo();
      const c = await preencher(dialogo);
      await trocarData(c.dataHora, '2026-10-31T11:06');
      await usuario.click(c.enviar);
      expect(c.dataHora).toHaveAttribute('aria-invalid', 'true');
      expect(c.dataHora).toHaveAccessibleDescription(
        expect.stringContaining(MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA),
      );
      expect(c.dataHora).toHaveFocus();
      expect(postsComunicacao()).toHaveLength(0);
    });

    it('data 5 minutos no futuro é aceita (tolerância da RN17)', async () => {
      const dialogo = await abrirDialogo();
      const c = await preencher(dialogo);
      await trocarData(c.dataHora, '2026-10-31T11:05');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost().dataHora).toBe('2026-10-31T11:05:00-03:00');
    });

    it('corrigir o campo tira a marcação de erro', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.click(c.enviar);
      expect(c.destinatario).toHaveAttribute('aria-invalid', 'true');
      await usuario.type(c.destinatario, 'X');
      expect(c.destinatario).toHaveAttribute('aria-invalid', 'false');
      expect(within(dialogo).queryByText(MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO)).toBeNull();
    });
  });

  describe('envio', () => {
    it('envia exatamente o contrato e mostra a comunicação na lista e a faixa', async () => {
      const dialogo = await abrirDialogo();
      expect(screen.getByText('Nenhuma comunicação registrada.')).toBeInTheDocument();
      const c = await preencher(dialogo);
      await usuario.click(c.enviar);

      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(postsComunicacao()).toHaveLength(1);
      expect(postsComunicacao()[0][0]).toBe(`${URL_API}/ocorrencias/12/comunicacoes`);
      expect(corpoDoPost()).toEqual({
        destinatario: 'Responsável fictício pelo estudante',
        meio: 'Telefone',
        descricao: 'Conversa fictícia sobre o fato.',
        dataHora: '2026-10-31T11:00:00-03:00',
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      const secao = screen.getByRole('region', { name: 'Comunicações' });
      expect(within(secao).getAllByRole('listitem')).toHaveLength(1);
      expect(within(secao).getByText('Responsável fictício pelo estudante')).toBeInTheDocument();
      expect(within(secao).getByText('Telefone')).toBeInTheDocument();
      expect(within(secao).getByText('31/10/2026 às 10:30')).toBeInTheDocument();
      expect(screen.queryByText('Nenhuma comunicação registrada.')).not.toBeInTheDocument();
      // Status não muda (RN16).
      expect(valorDe('Status')).toHaveTextContent('Aberto');

      // Faixa de sucesso anunciada (role=status) e com o foco.
      const faixa = screen.getByText(MSG_SUCESSO);
      expect(faixa.closest('[role="status"]')).not.toBeNull();
      expect(faixa).toHaveFocus();
      // O detalhe veio da resposta 201: um único GET do detalhe.
      expect(getsDetalhe()).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Registrar comunicação' })).toBeInTheDocument();
    });

    it('mantém o texto como digitado (a API normaliza), inclusive espaços nas pontas', async () => {
      const dialogo = await abrirDialogo({ perfil: 'GESTAO' });
      const c = campos(dialogo);
      await usuario.type(c.destinatario, '  Conselho Tutelar fictício ');
      await usuario.type(c.meio, ' Presencial');
      await usuario.type(c.descricao, 'Linha 1{Enter}Linha 2 ');
      await trocarData(c.dataHora, '2026-10-30T08:15');
      await usuario.click(c.enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatario: '  Conselho Tutelar fictício ',
        meio: ' Presencial',
        descricao: 'Linha 1\nLinha 2 ',
        dataHora: '2026-10-30T08:15:00-03:00',
      });
    });

    it('Pedagógico em ocorrência "Em acompanhamento": status continua igual', async () => {
      const dialogo = await abrirDialogo({
        perfil: 'PEDAGOGICO',
        detalhe: () => respostaFalsa(200, DETALHE_ACOMPANHAMENTO),
        comunicar: () =>
          respostaFalsa(201, { ...DETALHE_ACOMPANHAMENTO, comunicacoes: [NOVA_COMUNICACAO] }),
      });
      await usuario.click((await preencher(dialogo)).enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
      expect(
        within(screen.getByRole('region', { name: 'Comunicações' })).getAllByRole('listitem'),
      ).toHaveLength(1);
    });

    it('trava contra duplo envio: botão desabilitado e um único POST', async () => {
      let responder;
      const dialogo = await abrirDialogo({
        comunicar: () =>
          new Promise((resolve) => {
            responder = () => resolve(respostaFalsa(201, DETALHE_APOS_COMUNICAR));
          }),
      });
      const { enviar } = await preencher(dialogo);
      await usuario.click(enviar);
      await usuario.click(enviar);
      await usuario.dblClick(enviar);

      expect(enviar).toHaveAttribute('aria-disabled', 'true');
      expect(enviar).toHaveTextContent('Registrando...');
      expect(postsComunicacao()).toHaveLength(1);
      // Durante o envio, Esc não fecha.
      await usuario.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      responder();
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(postsComunicacao()).toHaveLength(1);
    });

    it('a faixa de sucesso some ao abrir o diálogo de novo', async () => {
      const dialogo = await abrirDialogo();
      await usuario.click((await preencher(dialogo)).enviar);
      await screen.findByText(MSG_SUCESSO);
      await usuario.click(screen.getByRole('button', { name: 'Registrar comunicação' }));
      await screen.findByRole('dialog', { name: 'Registrar comunicação' });
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
    });
  });

  describe('erros do envio', () => {
    async function enviarComErro(comunicar, opcoes = {}) {
      const dialogo = await abrirDialogo({ comunicar, ...opcoes });
      const c = await preencher(dialogo);
      await usuario.click(c.enviar);
      const alerta = await within(dialogo).findByRole('alert');
      return { dialogo, alerta, ...c };
    }

    it('400: mostra a mensagem da API no diálogo e mantém o que foi preenchido', async () => {
      const mensagemApi = 'O destinatario contém caractere inválido.';
      const { alerta, destinatario, meio, descricao, dataHora, enviar } = await enviarComErro(() =>
        respostaFalsa(400, { erro: mensagemApi }),
      );
      expect(alerta).toHaveTextContent(mensagemApi);
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      expect(destinatario).toHaveValue('Responsável fictício pelo estudante');
      expect(meio).toHaveValue('Telefone');
      expect(descricao).toHaveValue('Conversa fictícia sobre o fato.');
      expect(dataHora).toHaveValue(AGORA_LOCAL);
      expect(enviar).toHaveAttribute('aria-disabled', 'false');
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
    });

    it('400 da API com data futura (relógio do servidor): mensagem da API', async () => {
      const mensagemApi = 'A data e hora da comunicação não pode estar no futuro.';
      const { alerta } = await enviarComErro(() => respostaFalsa(400, { erro: mensagemApi }));
      expect(alerta).toHaveTextContent(mensagemApi);
    });

    it('403: mensagem de perfil sem permissão', async () => {
      const { alerta } = await enviarComErro(() =>
        respostaFalsa(403, { erro: 'Acesso negado para o seu perfil.' }),
      );
      expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
    });

    it('sem conexão: mensagem compreensível e dá para tentar de novo', async () => {
      let tentativa = 0;
      const { alerta, enviar } = await enviarComErro(() =>
        ++tentativa === 1
          ? Promise.reject(new TypeError('Failed to fetch'))
          : respostaFalsa(201, DETALHE_APOS_COMUNICAR),
      );
      expect(alerta).toHaveTextContent(MSG_SEM_CONEXAO);
      await usuario.click(enviar);
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(postsComunicacao()).toHaveLength(2);
    });

    it('404: "Ocorrência não encontrada." com "Atualizar a ocorrência"', async () => {
      let consultas = 0;
      const { alerta } = await enviarComErro(
        () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
        {
          detalhe: () =>
            ++consultas === 1
              ? respostaFalsa(200, DETALHE_ABERTO)
              : respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
        },
      );
      expect(alerta).toHaveTextContent(MSG_NAO_ENCONTRADA);
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_NAO_ENCONTRADA);
      expect(consultas).toBe(2);
    });

    it('409: mensagem clara e "Atualizar a ocorrência" recarrega o detalhe sem o botão', async () => {
      let consultas = 0;
      const { alerta } = await enviarComErro(
        () => respostaFalsa(409, {
            erro: 'Ocorrência encerrada não recebe comunicações.',
            codigo: 'OCORRENCIA_ENCERRADA',
          }),
        {
          detalhe: () =>
            respostaFalsa(200, ++consultas === 1 ? DETALHE_ABERTO : DETALHE_ENCERRADO),
        },
      );
      expect(alerta).toHaveTextContent(MENSAGEM_COMUNICACAO_CONFLITO);
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Encerrado'));
      expect(screen.queryByRole('button', { name: 'Registrar comunicação' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toHaveFocus();
      expect(consultas).toBe(2);
    });

    it('editar um campo após o erro tira a mensagem', async () => {
      const { dialogo, alerta, meio } = await enviarComErro(() =>
        respostaFalsa(403, { erro: 'Acesso negado.' }),
      );
      expect(alerta).toBeInTheDocument();
      await usuario.type(meio, 'x');
      expect(within(dialogo).queryByRole('alert')).toBeNull();
    });

    it('401: tratamento central leva ao login com aviso', async () => {
      const dialogo = await abrirDialogo({
        comunicar: () => respostaFalsa(401, { erro: 'Não autenticado.' }),
      });
      await usuario.click((await preencher(dialogo)).enviar);
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('mensagens por status', () => {
      expect(mensagemErroComunicacao({ status: 404 })).toBe(MSG_NAO_ENCONTRADA);
      expect(mensagemErroComunicacao({ status: 409, doServidor: true, message: 'x' })).toBe(
        MENSAGEM_COMUNICACAO_CONFLITO,
      );
      expect(mensagemErroComunicacao({ status: 400, doServidor: true, message: 'Erro y.' })).toBe(
        'Erro y.',
      );
      expect(mensagemErroComunicacao({ status: 400, doServidor: false, message: 'x' })).toBe(
        MSG_GENERICA,
      );
      expect(mensagemErroComunicacao({ status: 500 })).toBe(MSG_GENERICA);
      expect(mensagemErroComunicacao({ status: 0 })).toBe(MSG_SEM_CONEXAO);
      expect(mensagemErroComunicacao({ status: 403 })).toBe(MSG_SEM_PERMISSAO);
    });
  });

  describe('serviço, validação e montagem do corpo', () => {
    it('registrarComunicacao codifica o id e envia só os campos do contrato', async () => {
      sessao('TUTOR');
      fetch.mockResolvedValue(respostaFalsa(201, DETALHE_APOS_COMUNICAR));
      const resposta = await registrarComunicacao('12/x', {
        destinatario: 'D',
        meio: 'M',
        descricao: 'Texto',
        dataHora: '2026-10-31T11:00:00-03:00',
        status: 'ENCERRADO',
        registradoPorId: 99,
      });
      expect(resposta).toEqual(DETALHE_APOS_COMUNICAR);
      const [url, opcoes] = fetch.mock.calls[0];
      expect(url).toBe(`${URL_API}/ocorrencias/12%2Fx/comunicacoes`);
      expect(opcoes.method).toBe('POST');
      expect(JSON.parse(opcoes.body)).toEqual({
        destinatario: 'D',
        meio: 'M',
        descricao: 'Texto',
        dataHora: '2026-10-31T11:00:00-03:00',
      });
    });

    it('validarComunicacao: tolerância de 5 minutos e campos obrigatórios', () => {
      const agoraMs = AGORA.getTime();
      const base = { destinatario: 'D', meio: 'M', descricao: 'T', dataHora: AGORA_LOCAL };
      expect(validarComunicacao(base, agoraMs)).toEqual({});
      expect(validarComunicacao({ ...base, dataHora: '2026-10-31T11:05' }, agoraMs)).toEqual({});
      expect(validarComunicacao({ ...base, dataHora: '2026-10-31T11:06' }, agoraMs)).toEqual({
        dataHora: MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA,
      });
      expect(
        validarComunicacao({ destinatario: ' ', meio: '', descricao: '\n', dataHora: '' }, agoraMs),
      ).toEqual({
        destinatario: MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO,
        meio: MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO,
        descricao: MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA,
        dataHora: MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA,
      });
    });

    it('montarEnvioComunicacao converte a data para ISO com o fuso de São Paulo', () => {
      expect(
        montarEnvioComunicacao({
          destinatario: ' D ',
          meio: 'M',
          descricao: 'T',
          dataHora: '2026-10-31T11:00',
        }),
      ).toEqual({
        destinatario: ' D ',
        meio: 'M',
        descricao: 'T',
        dataHora: '2026-10-31T11:00:00-03:00',
      });
    });
  });
});
