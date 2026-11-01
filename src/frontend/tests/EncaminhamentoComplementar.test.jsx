// Testes complementares do QA para a Issue #50 — encaminhamento no detalhe da
// ocorrência (UC02, RF08, RN03, RN15, RNF01, RNF02). Cobrem fluxos que o
// arquivo principal não exercita: encaminhamentos seguidos, troca de
// responsável, consulta de estudantes por turma (inclusive falha parcial),
// limpeza de campos, reabertura, fechamento durante o envio, 404/409,
// acessibilidade do diálogo, XSS em nomes e o código extraído para o
// registro (#46). API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpcoesEquipe, OpcoesTutores } from '../src/components/OpcoesUsuarios.jsx';
import {
  MENSAGEM_TUTOR_OBRIGATORIO,
  separarUsuariosPorDestinatario,
  validarEncaminhamento,
} from '../src/services/mensagensOcorrencias.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const MSG_SUCESSO = 'Encaminhamento registrado.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const GRUPO_SUGERIDOS = 'Tutores dos estudantes desta ocorrência';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };

const ENC_INICIAL = Object.freeze({
  id: 100,
  destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
  destinatarioUsuario: null,
  registradoPor: { id: 30, nome: 'Professor Fictício' },
  dataHora: '2026-10-30T12:40:00.000Z',
  observacao: null,
});

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
  estudantes: [
    { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A },
    { id: 5, nomeCompleto: 'Estudante Fictício E', turma: TURMA_6A },
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B },
  ],
  encaminhamentos: [ENC_INICIAL],
  comunicacoes: [],
  providencias: [],
});

function encaminhamento(id, destinatarioPerfil, destinatarioUsuario = null) {
  return {
    id,
    destinatarioPerfil,
    destinatarioUsuario,
    registradoPor: { id: 9, nome: 'Pessoa Fictícia' },
    dataHora: '2026-10-31T14:00:00.000Z',
    observacao: null,
  };
}

const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 2, nome: 'Gestor Fictício Bloqueado', perfil: 'GESTAO', status: 'BLOQUEADO' },
  { id: 11, nome: 'Tutor Fictício A', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 12, nome: 'Tutora Fictícia B', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 13, nome: 'Tutora Fictícia C', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 15, nome: 'Tutor Fictício Bloqueado', perfil: 'TUTOR', status: 'BLOQUEADO' },
  { id: 20, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 22, nome: 'Pedagogo Fictício Desativado', perfil: 'PEDAGOGICO', status: 'DESATIVADO' },
  { id: 30, nome: 'Professor Fictício', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 40, nome: 'Técnica Fictícia', perfil: 'TECNICO_ADMINISTRATIVO', status: 'ATIVO' },
];

// Tutor de cada estudante: o E (turma 1) tem o tutor BLOQUEADO (não pode ser sugerido).
const ESTUDANTES_POR_TURMA = {
  1: [
    { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: { id: 11, nome: 'Tutor Fictício A' } },
    { id: 5, nomeCompleto: 'Estudante Fictício E', turma: TURMA_6A, tutor: { id: 15, nome: 'Tutor Fictício Bloqueado' } },
    { id: 7, nomeCompleto: 'Estudante Fictício G', turma: TURMA_6A, tutor: { id: 12, nome: 'Tutora Fictícia B' } },
  ],
  2: [
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B, tutor: { id: 13, nome: 'Tutora Fictícia C' } },
  ],
};

function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE_ABERTO),
  usuarios = () => respostaFalsa(200, USUARIOS),
  estudantes = (turmaId) => respostaFalsa(200, ESTUDANTES_POR_TURMA[turmaId] ?? []),
  encaminhar = () => respostaFalsa(201, DETALHE_ABERTO),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'GET' && url === `${URL_API}/usuarios`) return usuarios();
    const est = url.match(/\/estudantes\?turmaId=(\d+)$/);
    if (method === 'GET' && est) return estudantes(Number(est[1]));
    if (method === 'POST' && /\/ocorrencias\/[^/]+\/encaminhamentos$/.test(url)) {
      return encaminhar(JSON.parse(body));
    }
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (method === 'GET' && get) return detalhe(decodeURIComponent(get[1]));
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

function chamadas(metodo, trecho) {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === metodo && url.includes(trecho),
  );
}

function posts() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'POST' && url.endsWith('/encaminhamentos'),
  );
}

function corpoDoPost(indice = 0) {
  return JSON.parse(posts()[indice][1].body);
}

function valorDe(rotulo) {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

function gruposDe(select) {
  return Array.from(select.querySelectorAll('optgroup')).map((grupo) => ({
    grupo: grupo.label,
    opcoes: Array.from(grupo.querySelectorAll('option')).map((o) => o.textContent),
  }));
}

function textosOpcoes(select) {
  return Array.from(select.options).map((o) => o.textContent);
}

describe('Encaminhamento no detalhe — complementares do QA (#50)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta ANTES de restaurar fetch/env (nenhuma chamada pendente vaza).
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function abrirNaPagina() {
    await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
    await within(dialogo).findByLabelText('Encaminhar para');
    return dialogo;
  }

  async function abrirDialogo({ perfil = 'GESTAO', ...api } = {}) {
    sessao(perfil);
    mockarApi(api);
    renderizarApp('/ocorrencias/12');
    return abrirNaPagina();
  }

  function campos(dialogo) {
    return {
      destinatario: within(dialogo).getByLabelText('Encaminhar para'),
      responsavel: within(dialogo).getByLabelText(/^Responsável pelo acompanhamento/),
      observacao: within(dialogo).getByLabelText('Observação (opcional)'),
      enviar: within(dialogo).getByRole('button', { name: /^Encaminh/ }),
      cancelar: within(dialogo).getByRole('button', { name: 'Cancelar' }),
    };
  }

  describe('encaminhamentos seguidos e troca de responsável', () => {
    it('Aberto -> Em acompanhamento -> reabre com "Manter o atual" e envia sem responsável', async () => {
      const aposPrimeiro = {
        ...DETALHE_ABERTO,
        status: 'EM_ACOMPANHAMENTO',
        responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
        encaminhamentos: [ENC_INICIAL, encaminhamento(101, 'GESTAO')],
      };
      const aposSegundo = {
        ...aposPrimeiro,
        encaminhamentos: [...aposPrimeiro.encaminhamentos, encaminhamento(102, 'EQUIPE_PEDAGOGICA')],
      };
      let envios = 0;
      let dialogo = await abrirDialogo({
        perfil: 'PEDAGOGICO',
        encaminhar: () => respostaFalsa(201, ++envios === 1 ? aposPrimeiro : aposSegundo),
      });

      let c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Pedagoga Fictícia');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');

      // Segundo encaminhamento: diálogo já no modo "Em acompanhamento".
      dialogo = await abrirNaPagina();
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
      expect(within(dialogo).getByText(/O status continua "Em acompanhamento"/)).toBeInTheDocument();
      c = campos(dialogo);
      expect(c.responsavel).toHaveValue('');
      expect(c.responsavel.selectedOptions[0]).toHaveTextContent('Manter o atual (Pedagoga Fictícia)');
      await usuario.selectOptions(c.destinatario, 'Equipe pedagógica');
      await usuario.click(c.enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(posts()).toHaveLength(2);
      expect(corpoDoPost(0)).toEqual({
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: null,
        observacao: null,
        responsavelAcompanhamentoId: 20,
      });
      expect(corpoDoPost(1)).toEqual({
        destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
        destinatarioUsuarioId: null,
        observacao: null,
      });
      const secao = screen.getByRole('region', { name: 'Encaminhamentos' });
      expect(within(secao).getAllByRole('listitem')).toHaveLength(3);
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
      expect(valorDe('Responsável pelo acompanhamento')).toHaveTextContent('Pedagoga Fictícia');
      // Só um GET do detalhe: tudo veio das respostas 201.
      expect(chamadas('GET', '/ocorrencias/12')).toHaveLength(1);
    });

    it('troca do responsável: o nome novo aparece no detalhe e no "Manter o atual" seguinte', async () => {
      const acompanhamento = {
        ...DETALHE_ABERTO,
        status: 'EM_ACOMPANHAMENTO',
        responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
      };
      const trocado = {
        ...acompanhamento,
        responsavelAcompanhamento: { id: 13, nome: 'Tutora Fictícia C' },
        encaminhamentos: [ENC_INICIAL, encaminhamento(101, 'TUTOR', { id: 13, nome: 'Tutora Fictícia C', perfil: 'TUTOR' })],
      };
      let dialogo = await abrirDialogo({
        detalhe: () => respostaFalsa(200, acompanhamento),
        encaminhar: () => respostaFalsa(201, trocado),
      });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Tutor');
      await usuario.selectOptions(within(dialogo).getByLabelText('Tutor que vai receber'), 'Tutora Fictícia C');
      await usuario.selectOptions(c.responsavel, 'Tutora Fictícia C');
      await usuario.click(c.enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'TUTOR',
        destinatarioUsuarioId: 13,
        observacao: null,
        responsavelAcompanhamentoId: 13,
      });
      expect(valorDe('Responsável pelo acompanhamento')).toHaveTextContent('Tutora Fictícia C');
      expect(valorDe('Responsável pelo acompanhamento')).not.toHaveTextContent('Pedagoga Fictícia');

      dialogo = await abrirNaPagina();
      expect(campos(dialogo).responsavel.selectedOptions[0]).toHaveTextContent(
        'Manter o atual (Tutora Fictícia C)',
      );
    });

    it('Tutor como destinatário e o mesmo tutor como responsável (Aberto): corpo com os dois ids', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Tutor');
      await usuario.selectOptions(within(dialogo).getByLabelText('Tutor que vai receber'), 'Tutor Fictício A');
      await usuario.selectOptions(c.responsavel, 'Tutor Fictício A');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'TUTOR',
        destinatarioUsuarioId: 11,
        observacao: null,
        responsavelAcompanhamentoId: 11,
      });
    });
  });

  describe('listas de pessoas (RN03, RN15)', () => {
    it('bloqueados/desativados, Professor e Técnico não aparecem; tutor bloqueado de estudante não é sugerido', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      const nomesProibidos = [
        'Gestor Fictício Bloqueado',
        'Tutor Fictício Bloqueado',
        'Pedagogo Fictício Desativado',
        'Professor Fictício',
        'Técnica Fictícia',
      ];
      for (const nome of nomesProibidos) {
        expect(within(c.responsavel).queryByText(nome)).not.toBeInTheDocument();
      }
      // Sugeridos na ordem dos estudantes da ocorrência (A -> tutor 11, E -> bloqueado, C -> 13).
      expect(gruposDe(c.responsavel)).toEqual([
        { grupo: GRUPO_SUGERIDOS, opcoes: ['Tutor Fictício A', 'Tutora Fictícia C'] },
        { grupo: 'Outros tutores', opcoes: ['Tutora Fictícia B'] },
        { grupo: 'Equipe pedagógica', opcoes: ['Pedagoga Fictícia'] },
        { grupo: 'Gestão', opcoes: ['Gestora Fictícia'] },
      ]);

      await usuario.selectOptions(c.destinatario, 'Tutor');
      const tutor = within(dialogo).getByLabelText('Tutor que vai receber');
      for (const nome of nomesProibidos) {
        expect(within(tutor).queryByText(nome)).not.toBeInTheDocument();
      }
      await usuario.selectOptions(c.destinatario, 'Equipe pedagógica');
      expect(textosOpcoes(within(dialogo).getByLabelText('Pessoa da equipe (opcional)'))).toEqual([
        'Toda a equipe',
        'Pedagoga Fictícia',
      ]);
    });

    it('estudantes de turmas diferentes: uma consulta por turma, sem repetir turma', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () =>
          respostaFalsa(200, {
            ...DETALHE_ABERTO,
            estudantes: [
              ...DETALHE_ABERTO.estudantes,
              { id: 8, nomeCompleto: 'Estudante Fictício H', turma: null },
            ],
          }),
      });
      expect(dialogo).toBeInTheDocument();
      const consultas = chamadas('GET', '/estudantes');
      expect(consultas.map(([url]) => url).sort()).toEqual([
        `${URL_API}/estudantes?turmaId=1`,
        `${URL_API}/estudantes?turmaId=2`,
      ]);
    });

    it('ocorrência sem estudantes com turma: nenhuma consulta e grupo único "Tutores"', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () => respostaFalsa(200, { ...DETALHE_ABERTO, estudantes: [] }),
      });
      expect(chamadas('GET', '/estudantes')).toHaveLength(0);
      expect(gruposDe(campos(dialogo).responsavel)[0]).toEqual({
        grupo: 'Tutores',
        opcoes: ['Tutor Fictício A', 'Tutora Fictícia B', 'Tutora Fictícia C'],
      });
    });

    it('falha parcial (uma turma ok, outra 500): o diálogo abre e os tutores ficam num grupo único', async () => {
      const dialogo = await abrirDialogo({
        estudantes: (turmaId) =>
          turmaId === 2 ? respostaFalsa(500, {}) : respostaFalsa(200, ESTUDANTES_POR_TURMA[1]),
      });
      const c = campos(dialogo);
      expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument();
      expect(gruposDe(c.responsavel)[0]).toEqual({
        grupo: 'Tutores',
        opcoes: ['Tutor Fictício A', 'Tutora Fictícia B', 'Tutora Fictícia C'],
      });
      await usuario.selectOptions(c.destinatario, 'Tutor');
      expect(gruposDe(within(dialogo).getByLabelText('Tutor que vai receber'))).toEqual([
        { grupo: 'Tutores', opcoes: ['Tutor Fictício A', 'Tutora Fictícia B', 'Tutora Fictícia C'] },
      ]);
    });

    it.each([
      [403, MSG_SEM_PERMISSAO],
      [0, MSG_SEM_CONEXAO],
    ])('erro %s ao carregar /usuarios: mensagem no diálogo, sem formulário', async (status, msg) => {
      sessao('GESTAO');
      mockarApi({
        usuarios: () =>
          status === 0 ? Promise.reject(new TypeError('Failed to fetch')) : respostaFalsa(status, { erro: 'x' }),
      });
      renderizarApp('/ocorrencias/12');
      await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(msg);
      expect(within(dialogo).queryByLabelText('Encaminhar para')).not.toBeInTheDocument();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('campos e validação', () => {
    it('observação só com espaços vai como null', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.type(c.observacao, '      ');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost().observacao).toBeNull();
    });

    it('trocar o tipo de destinatário limpa o usuário escolhido e o erro do tutor', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      const pessoa = within(dialogo).getByLabelText('Pessoa da equipe (opcional)');
      await usuario.selectOptions(pessoa, 'Gestora Fictícia');
      expect(pessoa).toHaveValue('1');

      await usuario.selectOptions(c.destinatario, 'Equipe pedagógica');
      expect(within(dialogo).getByLabelText('Pessoa da equipe (opcional)')).toHaveValue('');

      await usuario.selectOptions(c.destinatario, 'Tutor');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      expect(within(dialogo).getByText(MENSAGEM_TUTOR_OBRIGATORIO)).toBeInTheDocument();
      expect(posts()).toHaveLength(0);

      await usuario.selectOptions(c.destinatario, 'Gestão');
      expect(within(dialogo).queryByText(MENSAGEM_TUTOR_OBRIGATORIO)).not.toBeInTheDocument();
      expect(within(dialogo).getByLabelText('Pessoa da equipe (opcional)')).toHaveValue('');
      await usuario.click(c.enviar);
      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: null,
        observacao: null,
        responsavelAcompanhamentoId: 1,
      });
    });

    it('voltar o destinatário para "Selecione" esconde o campo de usuário', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Tutor');
      expect(within(dialogo).getByLabelText('Tutor que vai receber')).toBeInTheDocument();
      await usuario.selectOptions(c.destinatario, 'Selecione');
      expect(within(dialogo).queryByLabelText('Tutor que vai receber')).not.toBeInTheDocument();
    });

    it('validarEncaminhamento: observação acima de 5000 caracteres e destinatário inválido', () => {
      const erros = validarEncaminhamento(
        {
          destinatarioPerfil: 'PROFESSOR',
          destinatarioUsuarioId: '',
          responsavelAcompanhamentoId: '',
          observacao: 'x'.repeat(5001),
        },
        'EM_ACOMPANHAMENTO',
      );
      expect(Object.keys(erros).sort()).toEqual(['destinatarioPerfil', 'observacao']);
      expect(
        validarEncaminhamento(
          {
            destinatarioPerfil: 'GESTAO',
            destinatarioUsuarioId: '',
            responsavelAcompanhamentoId: '',
            observacao: `  ${'x'.repeat(5000)}  `,
          },
          'EM_ACOMPANHAMENTO',
        ),
      ).toEqual({});
    });

    it('reabrir o diálogo começa limpo (sem valores, erros nem alerta de envio)', async () => {
      const dialogo = await abrirDialogo({
        encaminhar: () => respostaFalsa(400, { erro: 'Mensagem fictícia da API.' }),
      });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.type(c.observacao, 'Texto fictício');
      await usuario.click(c.enviar);
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Mensagem fictícia da API.');
      await usuario.click(c.cancelar);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const novo = await abrirNaPagina();
      const n = campos(novo);
      expect(n.destinatario).toHaveValue('');
      expect(n.responsavel).toHaveValue('');
      expect(n.observacao).toHaveValue('');
      expect(within(novo).queryByRole('alert')).not.toBeInTheDocument();
      expect(n.destinatario).toHaveAttribute('aria-invalid', 'false');
    });
  });

  describe('envio', () => {
    it('durante o envio, Cancelar e Esc não fecham e os campos não mudam', async () => {
      let responder;
      const aposEnviar = { ...DETALHE_ABERTO, status: 'EM_ACOMPANHAMENTO', responsavelAcompanhamento: { id: 1, nome: 'Gestora Fictícia' } };
      const dialogo = await abrirDialogo({
        encaminhar: () =>
          new Promise((resolve) => {
            responder = () => resolve(respostaFalsa(201, aposEnviar));
          }),
      });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      expect(c.enviar).toHaveTextContent('Encaminhando...');

      await usuario.click(c.cancelar);
      await usuario.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Encaminhar ocorrência' })).toBeInTheDocument();
      await usuario.selectOptions(c.destinatario, 'Tutor');
      expect(c.destinatario).toHaveValue('GESTAO');
      expect(c.observacao).toHaveAttribute('readonly');

      responder();
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(posts()).toHaveLength(1);
    });

    it('201 sem corpo: busca o detalhe de novo e mostra a faixa', async () => {
      let consultas = 0;
      const dialogo = await abrirDialogo({
        detalhe: () =>
          respostaFalsa(
            200,
            ++consultas === 1
              ? DETALHE_ABERTO
              : { ...DETALHE_ABERTO, status: 'EM_ACOMPANHAMENTO', responsavelAcompanhamento: { id: 1, nome: 'Gestora Fictícia' } },
          ),
        encaminhar: () => respostaFalsa(201, undefined),
      });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Em acompanhamento'));
      expect(screen.getByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(consultas).toBe(2);
    });

    it('409 com a ocorrência ainda aberta a encaminhamentos: "Atualizar" recarrega e o botão continua', async () => {
      let consultas = 0;
      sessao('PEDAGOGICO');
      mockarApi({
        detalhe: () =>
          respostaFalsa(
            200,
            ++consultas === 1
              ? DETALHE_ABERTO
              : { ...DETALHE_ABERTO, status: 'EM_ACOMPANHAMENTO', responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' } },
          ),
        encaminhar: () => respostaFalsa(409, { erro: 'Conflito fictício.' }),
      });
      renderizarApp('/ocorrencias/12');
      const dialogo = await abrirNaPagina();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      const alerta = await within(dialogo).findByRole('alert');
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));

      await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Em acompanhamento'));
      expect(screen.getByRole('button', { name: 'Encaminhar' })).toBeInTheDocument();
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
      // Reabrindo, o diálogo já reflete o novo status.
      const novo = await abrirNaPagina();
      expect(campos(novo).responsavel.selectedOptions[0]).toHaveTextContent('Manter o atual (Pedagoga Fictícia)');
    });

    it('404 no envio: mensagem "Ocorrência não encontrada." e "Atualizar" leva ao estado de não encontrada', async () => {
      let consultas = 0;
      sessao('GESTAO');
      mockarApi({
        detalhe: () =>
          ++consultas === 1
            ? respostaFalsa(200, DETALHE_ABERTO)
            : respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
        encaminhar: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }),
      });
      renderizarApp('/ocorrencias/12');
      const dialogo = await abrirNaPagina();
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent('Ocorrência não encontrada.');
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText(/Confira se o endereço está correto/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Encaminhar' })).not.toBeInTheDocument();
    });

    it('500 no envio: mensagem genérica e sem "Atualizar a ocorrência"', async () => {
      const dialogo = await abrirDialogo({ encaminhar: () => respostaFalsa(500, { erro: 'interno' }) });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível registrar o encaminhamento agora.');
      expect(alerta).not.toHaveTextContent('interno');
      expect(within(alerta).queryByRole('button', { name: 'Atualizar a ocorrência' })).not.toBeInTheDocument();
      // Ao mexer num campo, o alerta some.
      await usuario.type(c.observacao, 'a');
      expect(within(dialogo).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('acessibilidade do diálogo (RNF02)', () => {
    it('role dialog, aria-modal, título, descrição e fundo inerte', async () => {
      const dialogo = await abrirDialogo();
      expect(dialogo).toHaveAttribute('aria-modal', 'true');
      expect(within(dialogo).getByRole('heading', { level: 2, name: 'Encaminhar ocorrência' })).toBeInTheDocument();
      expect(dialogo).toHaveAccessibleDescription(/ocorrência nº 12/);
      expect(dialogo).toHaveAccessibleDescription(/passa para "Em acompanhamento"/);
      // A página atrás fica inerte enquanto o diálogo está aberto.
      const titulo = screen.getByRole('heading', { level: 1, hidden: true });
      expect(titulo.closest('[inert]')).not.toBeNull();
      await usuario.click(campos(dialogo).cancelar);
      expect(titulo.closest('[inert]')).toBeNull();
    });

    it('foco preso: Tab no último volta ao primeiro e Shift+Tab no primeiro vai ao último', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      await waitFor(() => expect(c.destinatario).toHaveFocus());
      await usuario.tab({ shift: true });
      expect(c.cancelar).toHaveFocus();
      await usuario.tab();
      expect(c.destinatario).toHaveFocus();
    });

    it('campos com rótulo e ajuda associados; responsável descrito como obrigatório em "Aberto"', async () => {
      const dialogo = await abrirDialogo();
      const c = campos(dialogo);
      expect(c.responsavel).toHaveAccessibleDescription(/^Obrigatório/);
      expect(c.observacao).toHaveAccessibleDescription('Até 5000 caracteres.');
      await usuario.selectOptions(c.destinatario, 'Tutor');
      expect(within(dialogo).getByLabelText('Tutor que vai receber')).toHaveAccessibleDescription(/^Obrigatório/);
    });

    it('a faixa de sucesso some ao reabrir o diálogo', async () => {
      const dialogo = await abrirDialogo({
        encaminhar: () =>
          respostaFalsa(201, { ...DETALHE_ABERTO, status: 'EM_ACOMPANHAMENTO', responsavelAcompanhamento: { id: 1, nome: 'Gestora Fictícia' } }),
      });
      const c = campos(dialogo);
      await usuario.selectOptions(c.destinatario, 'Gestão');
      await usuario.selectOptions(c.responsavel, 'Gestora Fictícia');
      await usuario.click(c.enviar);
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      await abrirNaPagina();
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
    });
  });

  describe('segurança (XSS)', () => {
    it('nomes com HTML aparecem como texto, sem criar elementos', async () => {
      const malicioso = '<img src=x onerror="window.__xssFicticio=1">Tutor Fictício X';
      const dialogo = await abrirDialogo({
        usuarios: () =>
          respostaFalsa(200, [
            ...USUARIOS,
            { id: 50, nome: malicioso, perfil: 'TUTOR', status: 'ATIVO' },
          ]),
        detalhe: () =>
          respostaFalsa(200, {
            ...DETALHE_ABERTO,
            status: 'EM_ACOMPANHAMENTO',
            responsavelAcompanhamento: { id: 50, nome: malicioso },
          }),
      });
      const c = campos(dialogo);
      expect(c.responsavel.selectedOptions[0].textContent).toBe(`Manter o atual (${malicioso})`);
      expect(within(c.responsavel).getByText(malicioso)).toBeInTheDocument();
      expect(document.querySelector('img[src="x"]')).toBeNull();
      expect(window.__xssFicticio).toBeUndefined();
    });
  });

  describe('código extraído e reaproveitado pelo registro (#46)', () => {
    it('separarUsuariosPorDestinatario: só ativos (ou sem status), só { id, nome }, por tipo', () => {
      const porTipo = separarUsuariosPorDestinatario([
        ...USUARIOS,
        { id: 60, nome: 'Pedagoga Sem Status Fictícia', perfil: 'PEDAGOGICO', email: 'x@exemplo.test' },
      ]);
      expect(porTipo).toEqual({
        TUTOR: [
          { id: 11, nome: 'Tutor Fictício A' },
          { id: 12, nome: 'Tutora Fictícia B' },
          { id: 13, nome: 'Tutora Fictícia C' },
        ],
        EQUIPE_PEDAGOGICA: [
          { id: 20, nome: 'Pedagoga Fictícia' },
          { id: 60, nome: 'Pedagoga Sem Status Fictícia' },
        ],
        GESTAO: [{ id: 1, nome: 'Gestora Fictícia' }],
      });
      expect(separarUsuariosPorDestinatario(undefined)).toEqual({
        TUTOR: [],
        EQUIPE_PEDAGOGICA: [],
        GESTAO: [],
      });
    });

    it('OpcoesTutores: dois grupos com rótulo informado, ou grupo único "Tutores"; vazio sem tutores', () => {
      const { container, rerender } = render(
        <select aria-label="t">
          <OpcoesTutores
            sugeridos={[{ id: 11, nome: 'Tutor Fictício A' }]}
            outros={[{ id: 12, nome: 'Tutora Fictícia B' }]}
            rotuloSugeridos="Tutores dos estudantes selecionados"
          />
        </select>,
      );
      expect(gruposDe(container.querySelector('select'))).toEqual([
        { grupo: 'Tutores dos estudantes selecionados', opcoes: ['Tutor Fictício A'] },
        { grupo: 'Outros tutores', opcoes: ['Tutora Fictícia B'] },
      ]);
      expect(container.querySelector('option[value="11"]')).not.toBeNull();

      rerender(
        <select aria-label="t">
          <OpcoesTutores sugeridos={[]} outros={[{ id: 12, nome: 'Tutora Fictícia B' }]} rotuloSugeridos="x" />
        </select>,
      );
      expect(gruposDe(container.querySelector('select'))).toEqual([
        { grupo: 'Tutores', opcoes: ['Tutora Fictícia B'] },
      ]);

      rerender(
        <select aria-label="t">
          <OpcoesTutores sugeridos={[]} outros={[]} rotuloSugeridos="x" />
        </select>,
      );
      expect(container.querySelectorAll('option, optgroup')).toHaveLength(0);
    });

    it('OpcoesEquipe: "Toda a equipe" com valor vazio e as pessoas', () => {
      const { container } = render(
        <select aria-label="e" defaultValue="">
          <OpcoesEquipe usuarios={[{ id: 1, nome: 'Gestora Fictícia' }]} />
        </select>,
      );
      const opcoes = Array.from(container.querySelectorAll('option'));
      expect(opcoes.map((o) => [o.value, o.textContent])).toEqual([
        ['', 'Toda a equipe'],
        ['1', 'Gestora Fictícia'],
      ]);
    });
  });
});
