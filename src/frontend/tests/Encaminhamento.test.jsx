// Fluxos da Issue #50 — encaminhamento no detalhe da ocorrência (UC02, RF08,
// RN03, RN04, RN15, RN20, RNF01, RNF02): botão "Encaminhar" só para Gestão e
// Pedagógico em ocorrências não encerradas; diálogo com destinatário, usuário
// destinatário (tutores dos estudantes da ocorrência primeiro), responsável
// pelo acompanhamento (obrigatório em "Aberto"; "Manter o atual" em "Em
// acompanhamento") e observação; corpo exato enviado; detalhe atualizado pela
// resposta 201; erros 400/403/404/409/sem conexão; trava contra duplo envio.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MENSAGEM_ENCAMINHAMENTO_CONFLITO,
  MENSAGEM_RESPONSAVEL_OBRIGATORIO,
  MENSAGEM_TIPO_DESTINATARIO_OBRIGATORIO,
  MENSAGEM_TUTOR_OBRIGATORIO,
  mensagemErroEncaminhamento,
  montarEnvioEncaminhamento,
  validarEncaminhamento,
} from '../src/services/mensagensOcorrencias.js';
import { encaminharOcorrencia } from '../src/services/ocorrencias.js';
import {
  PERFIS_ENCAMINHAMENTO_OCORRENCIA,
  podeEncaminharOcorrencia,
} from '../src/services/perfis.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];
const STATUS = ['ABERTO', 'EM_ACOMPANHAMENTO', 'ENCERRADO'];

const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_SUCESSO = 'Encaminhamento registrado.';
const MSG_CARGA = 'Não foi possível carregar a lista de pessoas agora.';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
const GRUPO_SUGERIDOS = 'Tutores dos estudantes desta ocorrência';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };

const ENCAMINHAMENTO_INICIAL = Object.freeze({
  id: 100,
  destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
  destinatarioUsuario: null,
  registradoPor: { id: 30, nome: 'Professor Fictício' },
  dataHora: '2026-10-30T12:40:00.000Z',
  observacao: null,
});

// Detalhe "Aberto" como recebe quem não é Gestão (sem codigoEscolar — RN20).
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
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B },
  ],
  encaminhamentos: [ENCAMINHAMENTO_INICIAL],
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

const NOVO_ENCAMINHAMENTO = Object.freeze({
  id: 101,
  destinatarioPerfil: 'TUTOR',
  destinatarioUsuario: { id: 11, nome: 'Tutor Fictício A', perfil: 'TUTOR' },
  registradoPor: { id: 9, nome: 'Pessoa Fictícia' },
  dataHora: '2026-10-31T14:00:00.000Z',
  observacao: 'Observação fictícia do encaminhamento.',
});

// Resposta 201: o detalhe completo, já em acompanhamento e com o novo encaminhamento.
const DETALHE_APOS_ENCAMINHAR = Object.freeze({
  ...DETALHE_ABERTO,
  status: 'EM_ACOMPANHAMENTO',
  responsavelAcompanhamento: { id: 20, nome: 'Pedagoga Fictícia' },
  encaminhamentos: [ENCAMINHAMENTO_INICIAL, NOVO_ENCAMINHAMENTO],
});

// GET /usuarios como a Gestão recebe (com status): inativos e Professor não
// podem aparecer em nenhuma lista do diálogo.
const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 2, nome: 'Gestor Fictício Bloqueado', perfil: 'GESTAO', status: 'BLOQUEADO' },
  { id: 11, nome: 'Tutor Fictício A', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 12, nome: 'Tutora Fictícia B', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 13, nome: 'Tutora Fictícia C', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 14, nome: 'Tutor Fictício Desativado', perfil: 'TUTOR', status: 'DESATIVADO' },
  { id: 20, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 21, nome: 'Pedagogo Fictício Dois', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 30, nome: 'Professor Fictício', perfil: 'PROFESSOR', status: 'ATIVO' },
];

// GET /estudantes?turmaId=: o tutor atual de cada estudante (RN20: { id, nome }).
const ESTUDANTES_POR_TURMA = {
  1: [
    { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: { id: 11, nome: 'Tutor Fictício A' } },
    { id: 5, nomeCompleto: 'Estudante Fictício E', turma: TURMA_6A, tutor: { id: 12, nome: 'Tutora Fictícia B' } },
  ],
  2: [
    { id: 3, nomeCompleto: 'Estudante Fictício C', turma: TURMA_7B, tutor: { id: 13, nome: 'Tutora Fictícia C' } },
  ],
};

/**
 * Roteia o fetch mockado: GET do detalhe, GET /usuarios, GET /estudantes e o
 * POST do encaminhamento (recebe o corpo já convertido de JSON).
 */
function mockarApi({
  detalhe = () => respostaFalsa(200, DETALHE_ABERTO),
  usuarios = () => respostaFalsa(200, USUARIOS),
  estudantes = (turmaId) => respostaFalsa(200, ESTUDANTES_POR_TURMA[turmaId] ?? []),
  encaminhar = () => respostaFalsa(201, DETALHE_APOS_ENCAMINHAR),
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
    // #85: o detalhe também busca o histórico (lista vazia aqui).
    if (opcoes.method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) {
      return respostaFalsa(200, []);
    }
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

function chamadas(metodo, trecho) {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === metodo && url.includes(trecho) &&
      // #85: o GET do histórico não conta como GET do detalhe.
      (trecho.includes('/historico') || !url.includes('/historico')),
  );
}

function postsEncaminhamento() {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'POST' && url.endsWith('/encaminhamentos'),
  );
}

function corpoDoPost(indice = 0) {
  return JSON.parse(postsEncaminhamento()[indice][1].body);
}

/** Valor (dd) do rótulo (dt) na página. */
function valorDe(rotulo) {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

/** Rótulos dos grupos e nomes das opções de cada grupo de um <select>. */
function gruposDe(select) {
  return Array.from(select.querySelectorAll('optgroup')).map((grupo) => ({
    grupo: grupo.label,
    opcoes: Array.from(grupo.querySelectorAll('option')).map((o) => o.textContent),
  }));
}

describe('Encaminhamento no detalhe da ocorrência (#50)', () => {
  let usuario;

  beforeEach(() => {
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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Abre o detalhe e o diálogo e espera a lista de pessoas carregar. */
  async function abrirDialogo({ perfil = 'GESTAO', ...api } = {}) {
    sessao(perfil);
    mockarApi(api);
    renderizarApp('/ocorrencias/12');
    await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
    await within(dialogo).findByLabelText('Encaminhar para');
    return dialogo;
  }

  function campos(dialogo) {
    return {
      destinatario: within(dialogo).getByLabelText('Encaminhar para'),
      responsavel: within(dialogo).getByLabelText(/^Responsável pelo acompanhamento/),
      observacao: within(dialogo).getByLabelText('Observação (opcional)'),
      enviar: within(dialogo).getByRole('button', { name: /^Encaminh/ }),
    };
  }

  describe('permissões (RN15, RN01)', () => {
    const casos = PERFIS.flatMap((perfil) => STATUS.map((status) => [perfil, status]));

    it.each(casos)('%s com ocorrência %s', async (perfil, status) => {
      sessao(perfil);
      mockarApi({ detalhe: () => respostaFalsa(200, { ...DETALHE_ACOMPANHAMENTO, status }) });
      renderizarApp('/ocorrencias/12');
      await screen.findByText('Dados da ocorrência');

      const deveVer = ['GESTAO', 'PEDAGOGICO'].includes(perfil) && status !== 'ENCERRADO';
      const botao = screen.queryByRole('button', { name: 'Encaminhar' });
      if (deveVer) expect(botao).toBeInTheDocument();
      else expect(botao).not.toBeInTheDocument();
    });

    it('constante e função de perfis seguem a matriz (só Gestão e Pedagógico)', () => {
      expect(PERFIS_ENCAMINHAMENTO_OCORRENCIA).toEqual(['GESTAO', 'PEDAGOGICO']);
      expect(PERFIS.filter(podeEncaminharOcorrencia)).toEqual(['GESTAO', 'PEDAGOGICO']);
      expect(podeEncaminharOcorrencia(undefined)).toBe(false);
    });
  });

  describe('diálogo e listas de pessoas', () => {
    it('abre com foco no primeiro campo e só carrega a lista ao abrir', async () => {
      sessao('PEDAGOGICO');
      mockarApi();
      renderizarApp('/ocorrencias/12');
      const botao = await screen.findByRole('button', { name: 'Encaminhar' });
      expect(chamadas('GET', '/usuarios')).toHaveLength(0);

      await usuario.click(botao);
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      const destinatario = await within(dialogo).findByLabelText('Encaminhar para');
      await waitFor(() => expect(destinatario).toHaveFocus());
      expect(chamadas('GET', '/usuarios')).toHaveLength(1);
    });

    it('Tutor: tutores dos estudantes da ocorrência primeiro, só ativos e sem pré-seleção', async () => {
      const dialogo = await abrirDialogo();
      await usuario.selectOptions(campos(dialogo).destinatario, 'Tutor');

      const tutor = within(dialogo).getByLabelText('Tutor que vai receber');
      expect(tutor).toHaveValue('');
      expect(gruposDe(tutor)).toEqual([
        { grupo: GRUPO_SUGERIDOS, opcoes: ['Tutor Fictício A', 'Tutora Fictícia C'] },
        { grupo: 'Outros tutores', opcoes: ['Tutora Fictícia B'] },
      ]);
      expect(within(tutor).queryByText('Tutor Fictício Desativado')).not.toBeInTheDocument();
      // Uma consulta por turma dos estudantes da ocorrência.
      expect(chamadas('GET', '/estudantes?turmaId=1')).toHaveLength(1);
      expect(chamadas('GET', '/estudantes?turmaId=2')).toHaveLength(1);
    });

    it('sem a consulta de estudantes, os tutores aparecem num único grupo', async () => {
      const dialogo = await abrirDialogo({ estudantes: () => respostaFalsa(500, {}) });
      await usuario.selectOptions(campos(dialogo).destinatario, 'Tutor');
      expect(gruposDe(within(dialogo).getByLabelText('Tutor que vai receber'))).toEqual([
        { grupo: 'Tutores', opcoes: ['Tutor Fictício A', 'Tutora Fictícia B', 'Tutora Fictícia C'] },
      ]);
    });

    it.each([
      ['Equipe pedagógica', ['Pedagoga Fictícia', 'Pedagogo Fictício Dois']],
      ['Gestão', ['Gestora Fictícia']],
    ])('%s: "Toda a equipe" por padrão e só os ativos do perfil', async (rotulo, nomes) => {
      const dialogo = await abrirDialogo();
      await usuario.selectOptions(campos(dialogo).destinatario, rotulo);
      const pessoa = within(dialogo).getByLabelText('Pessoa da equipe (opcional)');
      expect(pessoa).toHaveValue('');
      expect(Array.from(pessoa.options).map((o) => o.textContent)).toEqual(['Toda a equipe', ...nomes]);
    });

    it('responsável: Tutores, Pedagógicos e Gestão ativos, agrupados, tutores da ocorrência primeiro', async () => {
      const dialogo = await abrirDialogo();
      const { responsavel } = campos(dialogo);
      expect(responsavel).toHaveValue('');
      expect(responsavel.options[0]).toHaveTextContent('Selecione o responsável');
      expect(gruposDe(responsavel)).toEqual([
        { grupo: GRUPO_SUGERIDOS, opcoes: ['Tutor Fictício A', 'Tutora Fictícia C'] },
        { grupo: 'Outros tutores', opcoes: ['Tutora Fictícia B'] },
        { grupo: 'Equipe pedagógica', opcoes: ['Pedagoga Fictícia', 'Pedagogo Fictício Dois'] },
        { grupo: 'Gestão', opcoes: ['Gestora Fictícia'] },
      ]);
      expect(within(responsavel).queryByText('Professor Fictício')).not.toBeInTheDocument();
    });

    it('em acompanhamento: "Manter o atual (nome)" vem selecionado', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () => respostaFalsa(200, DETALHE_ACOMPANHAMENTO),
      });
      const { responsavel } = campos(dialogo);
      expect(responsavel).toHaveValue('');
      expect(responsavel.selectedOptions[0]).toHaveTextContent('Manter o atual (Pedagoga Fictícia)');
      expect(within(dialogo).getByText(/^Responsável pelo acompanhamento \(opcional\)/)).toBeInTheDocument();
    });

    it('em acompanhamento sem responsável: "Manter sem responsável"', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () =>
          respostaFalsa(200, { ...DETALHE_ACOMPANHAMENTO, responsavelAcompanhamento: null }),
      });
      expect(campos(dialogo).responsavel.selectedOptions[0]).toHaveTextContent('Manter sem responsável');
    });

    it('erro ao carregar as pessoas: mensagem e "Tentar novamente"', async () => {
      let tentativa = 0;
      sessao('GESTAO');
      mockarApi({
        usuarios: () => (++tentativa === 1 ? respostaFalsa(500, {}) : respostaFalsa(200, USUARIOS)),
      });
      renderizarApp('/ocorrencias/12');
      await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_CARGA);
      const tentar = within(dialogo).getByRole('button', { name: 'Tentar novamente' });
      await waitFor(() => expect(tentar).toHaveFocus());
      await usuario.click(tentar);
      expect(await within(dialogo).findByLabelText('Encaminhar para')).toBeInTheDocument();
      expect(tentativa).toBe(2);
    });

    it('cancelar fecha sem enviar e devolve o foco ao botão "Encaminhar"', async () => {
      const dialogo = await abrirDialogo();
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Encaminhar' })).toHaveFocus();
      expect(postsEncaminhamento()).toHaveLength(0);
    });

    it('Esc também fecha o diálogo', async () => {
      await abrirDialogo();
      await usuario.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Encaminhar' })).toHaveFocus();
    });
  });

  describe('validação no cliente', () => {
    it('sem destinatário: mensagem, aria-invalid e foco no campo, sem envio', async () => {
      const dialogo = await abrirDialogo();
      const { destinatario, enviar } = campos(dialogo);
      await usuario.click(enviar);

      expect(destinatario).toHaveAttribute('aria-invalid', 'true');
      expect(destinatario).toHaveAccessibleDescription(MENSAGEM_TIPO_DESTINATARIO_OBRIGATORIO);
      expect(destinatario).toHaveFocus();
      expect(postsEncaminhamento()).toHaveLength(0);
    });

    it('ocorrência "Aberto" sem responsável: envio bloqueado com mensagem clara (critério de aceite)', async () => {
      const dialogo = await abrirDialogo();
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.click(enviar);

      expect(within(dialogo).getByText(MENSAGEM_RESPONSAVEL_OBRIGATORIO)).toBeInTheDocument();
      expect(responsavel).toHaveAttribute('aria-invalid', 'true');
      expect(responsavel).toHaveAccessibleDescription(
        expect.stringContaining(MENSAGEM_RESPONSAVEL_OBRIGATORIO),
      );
      expect(responsavel).toHaveFocus();
      expect(postsEncaminhamento()).toHaveLength(0);

      // Ao escolher o responsável, a mensagem some.
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      expect(within(dialogo).queryByText(MENSAGEM_RESPONSAVEL_OBRIGATORIO)).not.toBeInTheDocument();
      expect(responsavel).toHaveAttribute('aria-invalid', 'false');
    });

    it('Tutor sem tutor escolhido: envio bloqueado (RN03)', async () => {
      const dialogo = await abrirDialogo();
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Tutor');
      await usuario.selectOptions(responsavel, 'Pedagoga Fictícia');
      await usuario.click(enviar);

      const tutor = within(dialogo).getByLabelText('Tutor que vai receber');
      expect(tutor).toHaveAttribute('aria-invalid', 'true');
      expect(tutor).toHaveAccessibleDescription(expect.stringContaining(MENSAGEM_TUTOR_OBRIGATORIO));
      expect(tutor).toHaveFocus();
      expect(postsEncaminhamento()).toHaveLength(0);
    });

    it('em acompanhamento o responsável não é obrigatório', () => {
      const dados = {
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: '',
        responsavelAcompanhamentoId: '',
        observacao: '',
      };
      expect(validarEncaminhamento(dados, 'EM_ACOMPANHAMENTO')).toEqual({});
      expect(validarEncaminhamento(dados, 'ABERTO')).toEqual({
        responsavelAcompanhamentoId: MENSAGEM_RESPONSAVEL_OBRIGATORIO,
      });
    });
  });

  describe('envio e atualização do detalhe', () => {
    it('"Aberto": envia o corpo exato e o detalhe passa a "Em acompanhamento" sem recarregar', async () => {
      const dialogo = await abrirDialogo({ perfil: 'PEDAGOGICO' });
      const { destinatario, responsavel, observacao, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Tutor');
      await usuario.selectOptions(within(dialogo).getByLabelText('Tutor que vai receber'), 'Tutor Fictício A');
      await usuario.selectOptions(responsavel, 'Pedagoga Fictícia');
      await usuario.type(observacao, '  Observação fictícia do encaminhamento.  ');
      await usuario.click(enviar);

      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(postsEncaminhamento()).toHaveLength(1);
      expect(postsEncaminhamento()[0][0]).toBe(`${URL_API}/ocorrencias/12/encaminhamentos`);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'TUTOR',
        destinatarioUsuarioId: 11,
        observacao: 'Observação fictícia do encaminhamento.',
        responsavelAcompanhamentoId: 20,
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(valorDe('Status')).toHaveTextContent('Em acompanhamento');
      expect(valorDe('Responsável pelo acompanhamento')).toHaveTextContent('Pedagoga Fictícia');
      const secao = screen.getByRole('region', { name: 'Encaminhamentos' });
      expect(within(secao).getAllByRole('listitem')).toHaveLength(2);
      expect(within(secao).getByText('Tutor — Tutor Fictício A')).toBeInTheDocument();

      // Faixa de sucesso anunciada (role=status) e com o foco.
      const faixa = screen.getByText(MSG_SUCESSO);
      expect(faixa.closest('[role="status"]')).not.toBeNull();
      expect(faixa).toHaveFocus();
      // O detalhe veio da resposta 201: um único GET do detalhe.
      expect(chamadas('GET', '/ocorrencias/12')).toHaveLength(1);
      // O botão continua disponível para um novo encaminhamento.
      expect(screen.getByRole('button', { name: 'Encaminhar' })).toBeInTheDocument();
    });

    it('"Em acompanhamento" mantendo o atual: o corpo NÃO leva responsavelAcompanhamentoId', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () => respostaFalsa(200, DETALHE_ACOMPANHAMENTO),
        encaminhar: () => respostaFalsa(201, DETALHE_ACOMPANHAMENTO),
      });
      const { destinatario, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Equipe pedagógica');
      await usuario.click(enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
        destinatarioUsuarioId: null,
        observacao: null,
      });
      expect(corpoDoPost()).not.toHaveProperty('responsavelAcompanhamentoId');
    });

    it('"Em acompanhamento" trocando o responsável: envia o novo id', async () => {
      const dialogo = await abrirDialogo({
        detalhe: () => respostaFalsa(200, DETALHE_ACOMPANHAMENTO),
        encaminhar: () =>
          respostaFalsa(201, {
            ...DETALHE_ACOMPANHAMENTO,
            responsavelAcompanhamento: { id: 1, nome: 'Gestora Fictícia' },
          }),
      });
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(within(dialogo).getByLabelText('Pessoa da equipe (opcional)'), 'Gestora Fictícia');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(corpoDoPost()).toEqual({
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: 1,
        observacao: null,
        responsavelAcompanhamentoId: 1,
      });
      expect(valorDe('Responsável pelo acompanhamento')).toHaveTextContent('Gestora Fictícia');
    });

    it('trava contra duplo envio: botão desabilitado e um único POST', async () => {
      let responder;
      const dialogo = await abrirDialogo({
        encaminhar: () =>
          new Promise((resolve) => {
            responder = () => resolve(respostaFalsa(201, DETALHE_APOS_ENCAMINHAR));
          }),
      });
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);
      await usuario.click(enviar);
      await usuario.dblClick(enviar);

      expect(enviar).toHaveAttribute('aria-disabled', 'true');
      expect(enviar).toHaveTextContent('Encaminhando...');
      expect(postsEncaminhamento()).toHaveLength(1);

      responder();
      expect(await screen.findByText(MSG_SUCESSO)).toBeInTheDocument();
      expect(postsEncaminhamento()).toHaveLength(1);
    });

    it('Gestão: o código escolar aparece só quando vem na resposta (RN20)', async () => {
      const comCodigo = {
        ...DETALHE_APOS_ENCAMINHAR,
        estudantes: DETALHE_APOS_ENCAMINHAR.estudantes.map((e, i) => ({
          ...e,
          codigoEscolar: i === 0 ? 'COD-FICT-001' : null,
        })),
      };
      const dialogo = await abrirDialogo({
        perfil: 'GESTAO',
        encaminhar: () => respostaFalsa(201, comCodigo),
      });
      expect(screen.queryByText('Código escolar', { selector: 'dt' })).not.toBeInTheDocument();
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(screen.getAllByText('Código escolar', { selector: 'dt' })).toHaveLength(2);
      expect(screen.getByText('COD-FICT-001')).toBeInTheDocument();
    });

    it('Pedagógico: sem codigoEscolar na resposta, o código escolar não aparece', async () => {
      const dialogo = await abrirDialogo({ perfil: 'PEDAGOGICO' });
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);

      await screen.findByText(MSG_SUCESSO);
      expect(screen.queryByText('Código escolar', { selector: 'dt' })).not.toBeInTheDocument();
    });
  });

  describe('erros do envio', () => {
    async function enviarComErro(encaminhar) {
      const dialogo = await abrirDialogo({ encaminhar });
      const { destinatario, responsavel, observacao, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.type(observacao, 'Observação fictícia');
      await usuario.click(enviar);
      const alerta = await within(dialogo).findByRole('alert');
      return { dialogo, alerta, ...campos(dialogo) };
    }

    it('400: mostra a mensagem da API no diálogo e mantém o que foi preenchido', async () => {
      const mensagemApi =
        'O responsável pelo acompanhamento precisa ser um usuário com perfil Tutor, Pedagógico ou Gestão e status ativo.';
      const { alerta, destinatario, responsavel, observacao, enviar } = await enviarComErro(() =>
        respostaFalsa(400, { erro: mensagemApi }),
      );
      expect(alerta).toHaveTextContent(mensagemApi);
      expect(destinatario).toHaveValue('GESTAO');
      expect(responsavel).toHaveValue('1');
      expect(observacao).toHaveValue('Observação fictícia');
      expect(enviar).toHaveAttribute('aria-disabled', 'false');
      expect(screen.queryByText(MSG_SUCESSO)).not.toBeInTheDocument();
    });

    it('403: mensagem de perfil sem permissão', async () => {
      const { alerta } = await enviarComErro(() =>
        respostaFalsa(403, { erro: 'Acesso negado para o seu perfil.' }),
      );
      expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão: mensagem compreensível', async () => {
      const { alerta } = await enviarComErro(() => Promise.reject(new TypeError('Failed to fetch')));
      expect(alerta).toHaveTextContent(MSG_SEM_CONEXAO);
    });

    it('409: mensagem clara e "Atualizar a ocorrência" recarrega o detalhe', async () => {
      let consultas = 0;
      sessao('GESTAO');
      mockarApi({
        detalhe: () =>
          respostaFalsa(200, ++consultas === 1 ? DETALHE_ABERTO : DETALHE_ENCERRADO),
        encaminhar: () =>
          respostaFalsa(409, {
            erro: 'Ocorrência encerrada não recebe encaminhamentos.',
            codigo: 'OCORRENCIA_ENCERRADA',
          }),
      });
      renderizarApp('/ocorrencias/12');
      await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      await within(dialogo).findByLabelText('Encaminhar para');
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);

      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveTextContent(MENSAGEM_ENCAMINHAMENTO_CONFLITO);
      await usuario.click(within(alerta).getByRole('button', { name: 'Atualizar a ocorrência' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(valorDe('Status')).toHaveTextContent('Encerrado'));
      expect(screen.queryByRole('button', { name: 'Encaminhar' })).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Ocorrência nº 12' })).toHaveFocus();
      expect(consultas).toBe(2);
    });

    it('401: tratamento central leva ao login com aviso', async () => {
      const dialogo = await abrirDialogo({
        encaminhar: () => respostaFalsa(401, { erro: 'Não autenticado.' }),
      });
      const { destinatario, responsavel, enviar } = campos(dialogo);
      await usuario.selectOptions(destinatario, 'Gestão');
      await usuario.selectOptions(responsavel, 'Gestora Fictícia');
      await usuario.click(enviar);
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('mensagens por status', () => {
      expect(mensagemErroEncaminhamento({ status: 404 })).toBe('Ocorrência não encontrada.');
      expect(mensagemErroEncaminhamento({ status: 409, doServidor: true, message: 'x' })).toBe(
        MENSAGEM_ENCAMINHAMENTO_CONFLITO,
      );
      expect(mensagemErroEncaminhamento({ status: 400, doServidor: false, message: 'x' })).toBe(
        'Não foi possível registrar o encaminhamento agora. Tente novamente em instantes.',
      );
      expect(mensagemErroEncaminhamento({ status: 500 })).toBe(
        'Não foi possível registrar o encaminhamento agora. Tente novamente em instantes.',
      );
    });
  });

  describe('serviço e montagem do corpo', () => {
    it('encaminharOcorrencia codifica o id e envia só os campos do contrato', async () => {
      sessao('GESTAO');
      fetch.mockResolvedValue(respostaFalsa(201, DETALHE_APOS_ENCAMINHAR));
      await encaminharOcorrencia('12/../x', {
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: undefined,
        observacao: undefined,
        responsavelAcompanhamentoId: null,
        status: 'ENCERRADO',
        registradoPorId: 99,
      });
      const [url, opcoes] = fetch.mock.calls[0];
      expect(url).toBe(`${URL_API}/ocorrencias/12%2F..%2Fx/encaminhamentos`);
      expect(opcoes.method).toBe('POST');
      expect(JSON.parse(opcoes.body)).toEqual({
        destinatarioPerfil: 'GESTAO',
        destinatarioUsuarioId: null,
        observacao: null,
      });
    });

    it('montarEnvioEncaminhamento: ids numéricos, texto limpo e responsável só quando escolhido', () => {
      expect(
        montarEnvioEncaminhamento({
          destinatarioPerfil: 'TUTOR',
          destinatarioUsuarioId: '11',
          responsavelAcompanhamentoId: '20',
          observacao: '  texto fictício ',
        }),
      ).toEqual({
        destinatarioPerfil: 'TUTOR',
        destinatarioUsuarioId: 11,
        observacao: 'texto fictício',
        responsavelAcompanhamentoId: 20,
      });
      expect(
        montarEnvioEncaminhamento({
          destinatarioPerfil: 'GESTAO',
          destinatarioUsuarioId: '',
          responsavelAcompanhamentoId: '',
          observacao: '   ',
        }),
      ).toEqual({ destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null });
    });
  });
});
