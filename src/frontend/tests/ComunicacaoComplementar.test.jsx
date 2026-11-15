// Testes complementares do QA para a Issue #52 — registro de comunicação no
// detalhe da ocorrência (RF09, RN16, RN17, RN06, RNF02). Cobrem o que a suíte
// principal (Comunicacao.test.jsx) não exercita: campos travados durante o
// envio, resposta 201 sem corpo, erro 500, 409 por conflito concorrente,
// U+0000 recusado pela API, virada de dia no fuso de São Paulo, limites de
// tamanho, perfis desconhecidos e acessibilidade do diálogo.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MENSAGEM_COMUNICACAO_CONFLITO,
  MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA,
  validarComunicacao,
  agoraNoFusoDaEscola,
} from '../src/services/mensagensOcorrencias.js';
import { podeRegistrarComunicacao } from '../src/services/perfis.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';

// Relógio fixo: 31/10/2026 às 11:00 em São Paulo (UTC-3).
const AGORA = new Date('2026-10-31T14:00:00.000Z');
const AGORA_LOCAL = '2026-10-31T11:00';

const MSG_SUCESSO = 'Comunicação registrada.';
const MSG_GENERICA = 'Não foi possível registrar a comunicação agora. Tente novamente em instantes.';

const TURMA = { id: 1, nome: '7º B', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 };

const DETALHE = Object.freeze({
  id: 21,
  dataHora: '2026-10-30T12:00:00.000Z',
  local: 'Quadra fictícia',
  turma: TURMA,
  categoria: { id: 2, nome: 'Categoria Fictícia Y' },
  descricao: 'Descrição fictícia.',
  demaisEnvolvidos: null,
  testemunhas: null,
  providenciasImediatas: null,
  observacoes: null,
  status: 'ABERTO',
  dataEncerramento: null,
  profissionalResponsavel: { id: 31, nome: 'Professora Fictícia' },
  responsavelAcompanhamento: null,
  estudantes: [{ id: 2, nomeCompleto: 'Estudante Fictício B', turma: TURMA }],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [],
});

const COMUNICACAO_1 = Object.freeze({
  id: 501,
  destinatario: 'Responsável fictício B',
  meio: 'WhatsApp',
  descricao: 'Contato fictício 1.',
  dataHora: '2026-10-31T13:00:00.000Z',
  registradoPor: { id: 9, nome: 'Tutora Fictícia' },
});

const COMUNICACAO_2 = Object.freeze({
  id: 502,
  destinatario: 'Conselho Tutelar fictício',
  meio: 'E-mail',
  descricao: 'Contato fictício 2.',
  dataHora: '2026-10-31T13:40:00.000Z',
  registradoPor: { id: 9, nome: 'Tutora Fictícia' },
});

function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE),
  comunicar = () => respostaFalsa(201, { ...DETALHE, comunicacoes: [COMUNICACAO_1] }),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'POST' && /\/ocorrencias\/[^/]+\/comunicacoes$/.test(url)) {
      return comunicar(JSON.parse(body));
    }
    if (method === 'GET' && /\/ocorrencias\/[^/]+$/.test(url)) return detalhe();
    // #85: o detalhe também busca o histórico (lista vazia aqui).
    if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return respostaFalsa(200, []);
    }
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function posts() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'POST' && url.endsWith('/comunicacoes'),
  );
}

function gets() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'GET' && url.endsWith('/ocorrencias/21'),
  );
}

describe('Registro de comunicação — complementar do QA (#52)', () => {
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
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function abrir({ perfil = 'TUTOR', ...api } = {}) {
    gravarSessaoFicticia({ usuario: { id: 9, nome: 'Tutora Fictícia', perfil } });
    mockarApi(api);
    renderizarApp('/ocorrencias/21');
    await usuario.click(await screen.findByRole('button', { name: 'Registrar comunicação' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Registrar comunicação' });
    return { dialogo, ...campos(dialogo) };
  }

  function campos(dialogo) {
    return {
      destinatario: within(dialogo).getByLabelText('Destinatário'),
      meio: within(dialogo).getByLabelText('Meio'),
      descricao: within(dialogo).getByLabelText('Descrição'),
      dataHora: within(dialogo).getByLabelText('Data e hora do contato'),
      enviar: within(dialogo).getByRole('button', { name: /^Registr/ }),
      cancelar: within(dialogo).getByRole('button', { name: 'Cancelar' }),
    };
  }

  async function preencher(c) {
    await usuario.type(c.destinatario, 'Responsável fictício B');
    await usuario.type(c.meio, 'WhatsApp');
    await usuario.type(c.descricao, 'Contato fictício 1.');
  }

  describe('permissões (RN01, RN16)', () => {
    it.each([['ADMIN'], [''], [null], ['tutor'], ['Gestao']])(
      'perfil desconhecido ou com grafia diferente (%s) não vê o botão (nem o detalhe)',
      async (perfil) => {
        expect(podeRegistrarComunicacao(perfil)).toBe(false);
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        mockarApi();
        renderizarApp('/ocorrencias/21');
        // A rota já barra perfis fora da matriz (RF14).
        expect(
          await screen.findByRole('heading', { name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Registrar comunicação' }),
        ).not.toBeInTheDocument();
      },
    );

    it('ocorrência que falha ao carregar não mostra o botão', async () => {
      gravarSessaoFicticia({ usuario: { id: 9, nome: 'Tutora Fictícia', perfil: 'TUTOR' } });
      mockarApi({ detalhe: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }) });
      renderizarApp('/ocorrencias/21');
      await screen.findByRole('alert');
      expect(
        screen.queryByRole('button', { name: 'Registrar comunicação' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('trava durante o envio', () => {
    it('campos ficam somente leitura, digitação é ignorada, Cancelar e Enter não agem', async () => {
      let responder;
      const c = await abrir({
        comunicar: () =>
          new Promise((resolve) => {
            responder = () =>
              resolve(respostaFalsa(201, { ...DETALHE, comunicacoes: [COMUNICACAO_1] }));
          }),
      });
      await preencher(c);
      await usuario.click(c.enviar);

      const form = c.enviar.closest('form');
      expect(form).toHaveAttribute('aria-busy', 'true');
      for (const campo of [c.destinatario, c.meio, c.descricao, c.dataHora]) {
        expect(campo).toHaveAttribute('readonly');
      }
      expect(c.cancelar).toHaveAttribute('aria-disabled', 'true');

      // Digitar não altera o valor; Enter no campo não reenvia.
      await usuario.type(c.meio, 'XYZ');
      expect(c.meio).toHaveValue('WhatsApp');
      fireEvent.change(c.destinatario, { target: { value: 'Outro' } });
      expect(c.destinatario).toHaveValue('Responsável fictício B');
      fireEvent.submit(form);
      await usuario.click(c.cancelar);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(posts()).toHaveLength(1);

      responder();
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(posts()).toHaveLength(1);
    });
  });

  describe('envio e atualização do detalhe', () => {
    it('201 sem corpo: busca o detalhe de novo e mostra a comunicação', async () => {
      let consultas = 0;
      const c = await abrir({
        detalhe: () =>
          respostaFalsa(
            200,
            ++consultas === 1 ? DETALHE : { ...DETALHE, comunicacoes: [COMUNICACAO_1] },
          ),
        comunicar: () => respostaFalsa(201),
      });
      await preencher(c);
      await usuario.click(c.enviar);

      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      const secao = screen.getByRole('region', { name: 'Comunicações' });
      await waitFor(() => expect(within(secao).getAllByRole('listitem')).toHaveLength(1));
      expect(within(secao).getByText('Responsável fictício B')).toBeInTheDocument();
      expect(gets()).toHaveLength(2);
    });

    it('segunda comunicação: lista passa a ter duas, com quem registrou e a descrição', async () => {
      let envios = 0;
      const c = await abrir({
        comunicar: () =>
          respostaFalsa(201, {
            ...DETALHE,
            comunicacoes: ++envios === 1 ? [COMUNICACAO_1] : [COMUNICACAO_1, COMUNICACAO_2],
          }),
      });
      await preencher(c);
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);

      await usuario.click(screen.getByRole('button', { name: 'Registrar comunicação' }));
      const novo = campos(await screen.findByRole('dialog', { name: 'Registrar comunicação' }));
      await usuario.type(novo.destinatario, 'Conselho Tutelar fictício');
      await usuario.type(novo.meio, 'E-mail');
      await usuario.type(novo.descricao, 'Contato fictício 2.');
      await usuario.click(novo.enviar);
      await screen.findByText(MSG_SUCESSO);

      const secao = screen.getByRole('region', { name: 'Comunicações' });
      expect(within(secao).getAllByRole('listitem')).toHaveLength(2);
      expect(within(secao).getByText('Contato fictício 2.')).toBeInTheDocument();
      expect(within(secao).getAllByText('Tutora Fictícia')).toHaveLength(2);
      expect(posts()).toHaveLength(2);
    });

    it('data bem no passado é aceita e enviada com o fuso de São Paulo', async () => {
      const c = await abrir();
      await preencher(c);
      fireEvent.change(c.dataHora, { target: { value: '2025-01-15T07:05' } });
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(JSON.parse(posts()[0][1].body).dataHora).toBe('2025-01-15T07:05:00-03:00');
    });
  });

  describe('fuso de São Paulo (RN17)', () => {
    it('sugestão de "agora" usa o dia de São Paulo, não o de UTC (virada do dia)', async () => {
      // 01/11/2026 02:30 UTC = 31/10/2026 23:30 em São Paulo.
      vi.setSystemTime(new Date('2026-11-01T02:30:00.000Z'));
      const c = await abrir();
      expect(c.dataHora).toHaveValue('2026-10-31T23:30');
      expect(agoraNoFusoDaEscola()).toBe('2026-10-31T23:30');
    });

    it('limite exato: +5 min aceito; +5 min e 1 s bloqueado', () => {
      const base = { destinatario: 'D', meio: 'M', descricao: 'T' };
      const agoraMs = AGORA.getTime();
      expect(validarComunicacao({ ...base, dataHora: '2026-10-31T11:05:00' }, agoraMs)).toEqual({});
      expect(validarComunicacao({ ...base, dataHora: '2026-10-31T11:05:01' }, agoraMs)).toEqual({
        dataHora: MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA,
      });
    });

    it('data inválida (texto) é tratada como não preenchida', () => {
      const base = { destinatario: 'D', meio: 'M', descricao: 'T' };
      expect(validarComunicacao({ ...base, dataHora: 'abc' }, AGORA.getTime())).toHaveProperty(
        'dataHora',
      );
    });

    it('data de amanhã é bloqueada com mensagem clara (critério de aceite)', async () => {
      const c = await abrir();
      await preencher(c);
      fireEvent.change(c.dataHora, { target: { value: '2026-11-01T09:00' } });
      await usuario.click(c.enviar);
      expect(within(c.dialogo).getByText(MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA)).toBeInTheDocument();
      expect(posts()).toHaveLength(0);
    });
  });

  describe('limites de tamanho', () => {
    it('destinatário e meio colados com mais de 150 caracteres ficam em 150', async () => {
      const c = await abrir();
      c.destinatario.focus();
      await usuario.paste('D'.repeat(160));
      c.meio.focus();
      await usuario.paste('M'.repeat(170));
      expect(c.destinatario.value).toHaveLength(150);
      expect(c.meio.value).toHaveLength(150);
    });

    it('descrição com exatamente 5000 caracteres é enviada inteira', async () => {
      const c = await abrir();
      await usuario.type(c.destinatario, 'Responsável fictício B');
      await usuario.type(c.meio, 'Telefone');
      fireEvent.change(c.descricao, { target: { value: 'x'.repeat(5000) } });
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(JSON.parse(posts()[0][1].body).descricao).toHaveLength(5000);
    });
  });

  describe('erros do envio', () => {
    async function enviarComErro(comunicar, api = {}) {
      const c = await abrir({ comunicar, ...api });
      await preencher(c);
      await usuario.click(c.enviar);
      const alerta = await within(c.dialogo).findByRole('alert');
      return { alerta, ...c };
    }

    it('500: mensagem genérica, sem "Atualizar a ocorrência", e permite tentar de novo', async () => {
      let tentativa = 0;
      const { alerta, enviar } = await enviarComErro(() =>
        ++tentativa === 1
          ? respostaFalsa(500, { erro: 'Erro interno com detalhe técnico.' })
          : respostaFalsa(201, { ...DETALHE, comunicacoes: [COMUNICACAO_1] }),
      );
      expect(alerta).toHaveTextContent(MSG_GENERICA);
      expect(alerta).not.toHaveTextContent('detalhe técnico');
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).toBeNull();
      await usuario.click(enviar);
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
    });

    it('400 por U+0000: mostra a mensagem da API e mantém o diálogo aberto', async () => {
      const mensagemApi = 'O texto contém caractere inválido.';
      const c = await abrir({ comunicar: () => respostaFalsa(400, { erro: mensagemApi }) });
      await usuario.type(c.destinatario, 'Responsável fictício B');
      await usuario.type(c.meio, 'Telefone');
      fireEvent.change(c.descricao, { target: { value: 'Texto\u0000fictício' } });
      await usuario.click(c.enviar);
      const alerta = await within(c.dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(mensagemApi);
      expect(JSON.parse(posts()[0][1].body).descricao).toBe('Texto\u0000fictício');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('409 por conflito concorrente: após atualizar, a ocorrência segue aberta e o botão continua', async () => {
      const { alerta } = await enviarComErro(() =>
        respostaFalsa(409, {
          erro: 'Não foi possível registrar a comunicação por causa de outra operação ao mesmo tempo. Tente novamente.',
        }),
      );
      expect(alerta).toHaveTextContent(MENSAGEM_COMUNICACAO_CONFLITO);
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: 'Registrar comunicação' }),
      ).toBeInTheDocument();
      expect(gets()).toHaveLength(2);
    });

    it('erro do envio não mostra a faixa de sucesso nem altera a lista', async () => {
      await enviarComErro(() => respostaFalsa(403, { erro: 'Acesso negado.' }));
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
      // A página atrás está inerte, mas segue no DOM.
      expect(screen.getByText('Nenhuma comunicação registrada.')).toBeInTheDocument();
    });
  });

  describe('acessibilidade (RNF02)', () => {
    it('diálogo modal: aria-modal, descrição de que o sistema não envia mensagens e fundo inerte', async () => {
      const { dialogo } = await abrir();
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      expect(dialogo).toHaveAccessibleDescription(/não envia mensagens/);
      expect(dialogo).toHaveAccessibleDescription(/nº 21/);
      const titulo = screen.getByRole('heading', { level: 1, hidden: true });
      expect(titulo.closest('[inert]')).not.toBeNull();
    });

    it('Tab e Shift+Tab ficam presos dentro do diálogo', async () => {
      const c = await abrir();
      expect(c.destinatario).toHaveFocus();
      await usuario.tab({ shift: true });
      expect(c.cancelar).toHaveFocus();
      await usuario.tab();
      expect(c.destinatario).toHaveFocus();
      // Ordem natural: destinatário -> meio -> descrição -> data -> Registrar -> Cancelar.
      await usuario.tab();
      expect(c.meio).toHaveFocus();
      await usuario.tab();
      expect(c.descricao).toHaveFocus();
      await usuario.tab();
      expect(c.dataHora).toHaveFocus();
      await usuario.tab();
      expect(c.enviar).toHaveFocus();
    });

    it('a orientação de redação (RN06) está visível junto da descrição', async () => {
      const { dialogo, descricao } = await abrir();
      const orientacao = within(dialogo).getByText(/de forma objetiva e sem opiniões/);
      expect(orientacao).toBeVisible();
      expect(descricao.getAttribute('aria-describedby')).toContain(orientacao.id);
    });

    it('erro de campo é ligado ao campo por aria-describedby e some ao corrigir', async () => {
      const c = await abrir();
      await usuario.click(c.enviar);
      const idErro = 'comunicacao-meio-erro';
      expect(c.meio.getAttribute('aria-describedby')).toContain(idErro);
      await usuario.type(c.meio, 'Telefone');
      expect(c.meio.getAttribute('aria-describedby')).not.toContain(idErro);
      expect(document.getElementById(idErro)).toBeNull();
    });
  });

  it('sanidade do relógio fixo', () => {
    expect(agoraNoFusoDaEscola()).toBe(AGORA_LOCAL);
  });
});
