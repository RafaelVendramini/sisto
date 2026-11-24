// Fluxos da Issue #154 (front-end da Story #152, SSD 1.18) — perfil Psicólogo
// escolar e encaminhamento ao psicólogo com justificativa (RN03, RN06, RN15,
// RN16, RN19, RN20, RN22, RN23, RN24, RNF01, RNF02):
// - rótulo "Psicólogo escolar" nos perfis, nos usuários e nos destinatários;
// - registro de ocorrência com o destinatário "Psicólogo escolar" (lista de
//   psicólogos ativos e justificativa obrigatória, com orientação e aviso);
// - diálogo "Encaminhar" com as mesmas regras, sem o psicólogo entre os
//   responsáveis pelo acompanhamento;
// - menu e botões do detalhe para o perfil PSICOLOGO;
// - aviso fixo no lugar da justificativa quando a API devolve `observacao: null`;
// - página /privacidade com o perfil e a regra de quem lê a justificativa.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DESTINATARIOS,
  MENSAGEM_JUSTIFICATIVA_LONGA,
  MENSAGEM_JUSTIFICATIVA_OBRIGATORIA,
  MENSAGEM_PSICOLOGO_OBRIGATORIO,
  TEXTO_JUSTIFICATIVA_RESTRITA,
  agruparResponsaveis,
  destinatarioExigeJustificativa,
  destinatarioExigeUsuario,
  justificativaOculta,
  montarEnvio,
  montarEnvioEncaminhamento,
  rotuloDestinatario,
  separarUsuariosPorDestinatario,
  validarEncaminhamento,
  validarRegistro,
} from '../src/services/mensagensOcorrencias.js';
import {
  podeAtualizarOcorrencia,
  podeConsultarOcorrencias,
  podeEncaminharOcorrencia,
  podeFiltrarPorProfissional,
  podeGerarRelatorios,
  podeGerenciarCategorias,
  podeGerenciarEstudantes,
  podeGerenciarTurmas,
  podeGerenciarUsuarios,
  podeRegistrarComunicacao,
  podeRegistrarOcorrencia,
  rotuloPerfil,
} from '../src/services/perfis.js';
import {
  NOTA_VERSAO_POLITICA_PRIVACIDADE,
  NOTA_VERSAO_TERMOS_USO,
  POLITICA_PRIVACIDADE,
  TERMOS_USO,
} from '../src/services/textosLegais.js';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
// 30/10/2026 08:00 em São Paulo (UTC-03:00): relógio fixo do registro.
const AGORA = new Date('2026-10-30T11:00:00.000Z');

const AVISO = 'Justificativa visível somente para o psicólogo escolar, a Gestão e quem fez o encaminhamento';
const MSG_PSICOLOGO = 'Escolha o psicólogo escolar que vai receber a ocorrência.';
const MSG_JUSTIFICATIVA = 'Informe a justificativa do encaminhamento ao psicólogo escolar.';
const MSG_REVISAR = 'Confira os campos destacados antes de enviar.';
const JUSTIFICATIVA = 'Justificativa fictícia: estudante chorou durante a aula.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';

// GET /usuarios como a Gestão recebe (com status): o psicólogo desativado e o
// professor não podem aparecer em nenhuma lista.
const USUARIOS_GESTAO = [
  { id: 1, nome: 'Gestora Fictícia', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 11, nome: 'Tutor Fictício A', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 20, nome: 'Pedagoga Fictícia', perfil: 'PEDAGOGICO', status: 'ATIVO' },
  { id: 30, nome: 'Professor Fictício', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 40, nome: 'Psicóloga Fictícia', perfil: 'PSICOLOGO', status: 'ATIVO' },
  { id: 41, nome: 'Psicólogo Fictício Desativado', perfil: 'PSICOLOGO', status: 'DESATIVADO' },
  { id: 42, nome: 'Psicólogo Fictício Dois', perfil: 'PSICOLOGO', status: 'ATIVO' },
];

// Lista reduzida (RN20, v1.18): só ativos de Tutor, Psicólogo, Pedagógico e Gestão.
const USUARIOS_REDUZIDOS = USUARIOS_GESTAO.filter(
  (u) => u.status === 'ATIVO' && ['TUTOR', 'PSICOLOGO', 'PEDAGOGICO', 'GESTAO'].includes(u.perfil),
).map(({ id, nome, perfil }) => ({ id, nome, perfil }));

const ESTUDANTES = [
  { id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A, tutor: { id: 11, nome: 'Tutor Fictício A' } },
];

const ENCAMINHAMENTO_PSICOLOGO = Object.freeze({
  id: 200,
  destinatarioPerfil: 'PSICOLOGO',
  destinatarioUsuario: { id: 40, nome: 'Psicóloga Fictícia', perfil: 'PSICOLOGO' },
  registradoPor: { id: 30, nome: 'Professor Fictício' },
  dataHora: '2026-10-30T12:40:00.000Z',
  observacao: JUSTIFICATIVA,
});

const ENCAMINHAMENTO_EQUIPE = Object.freeze({
  id: 201,
  destinatarioPerfil: 'EQUIPE_PEDAGOGICA',
  destinatarioUsuario: null,
  registradoPor: { id: 30, nome: 'Professor Fictício' },
  dataHora: '2026-10-30T12:40:00.000Z',
  observacao: null,
});

function detalhe({ status = 'EM_ACOMPANHAMENTO', encaminhamentos = [ENCAMINHAMENTO_PSICOLOGO] } = {}) {
  return {
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
    status,
    dataEncerramento: null,
    profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
    responsavelAcompanhamento:
      status === 'ABERTO' ? null : { id: 20, nome: 'Pedagoga Fictícia' },
    estudantes: [{ id: 1, nomeCompleto: 'Estudante Fictício A', turma: TURMA_6A }],
    encaminhamentos,
    comunicacoes: [],
    providencias: [],
  };
}

/**
 * Roteia o fetch mockado: turmas, categorias, usuários, estudantes, detalhe e
 * histórico, além dos POST do registro e do encaminhamento (recebem o corpo).
 */
function mockarApi({
  usuarios = USUARIOS_GESTAO,
  obterDetalhe = () => respostaFalsa(200, detalhe()),
  aoRegistrar = () => respostaFalsa(201, { id: 12 }),
  aoEncaminhar = () => respostaFalsa(201, detalhe()),
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const { method, body } = opcoes;
    if (method === 'GET' && url === `${URL_API}/turmas`) return respostaFalsa(200, [TURMA_6A]);
    if (method === 'GET' && url === `${URL_API}/categorias`) {
      return respostaFalsa(200, [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }]);
    }
    if (method === 'GET' && url === `${URL_API}/usuarios`) return respostaFalsa(200, usuarios);
    if (method === 'GET' && /\/estudantes\?turmaId=\d+$/.test(url)) return respostaFalsa(200, ESTUDANTES);
    if (method === 'POST' && url === `${URL_API}/ocorrencias`) return aoRegistrar(JSON.parse(body));
    if (method === 'POST' && /\/ocorrencias\/[^/]+\/encaminhamentos$/.test(url)) {
      return aoEncaminhar(JSON.parse(body));
    }
    if (method === 'GET' && /\/ocorrencias\/[^/]+\/historico$/.test(url)) return respostaFalsa(200, []);
    if (method === 'GET' && /\/ocorrencias\/[^/]+$/.test(url)) return obterDetalhe();
    throw new Error(`Chamada inesperada: ${method} ${url}`);
  });
}

function sessao(perfil, id = 9) {
  gravarSessaoFicticia({ usuario: { id, nome: 'Pessoa Fictícia', perfil } });
}

function posts(trecho) {
  return fetch.mock.calls.filter(
    ([url, opcoes = {}]) => opcoes.method === 'POST' && url.endsWith(trecho),
  );
}

/** Valor (dd) do rótulo (dt) dentro de um elemento. */
function valorDe(container, rotulo) {
  return within(container).getByText(rotulo, { selector: 'dt' }).nextElementSibling;
}

// ---------------------------------------------------------------------------
// Regras puras: perfis, destinatários e validações
// ---------------------------------------------------------------------------

describe('Psicólogo escolar — perfis e permissões no front (matriz da Seção 4)', () => {
  it('rótulo "Psicólogo escolar" no perfil e no destinatário', () => {
    expect(rotuloPerfil('PSICOLOGO')).toBe('Psicólogo escolar');
    expect(rotuloDestinatario('PSICOLOGO')).toBe('Psicólogo escolar');
    expect(DESTINATARIOS.map((d) => d.valor)).toEqual([
      'TUTOR',
      'PSICOLOGO',
      'EQUIPE_PEDAGOGICA',
      'GESTAO',
    ]);
  });

  it('registra, consulta e comunica; não encaminha, não gera relatórios nem gerencia cadastros', () => {
    expect(podeRegistrarOcorrencia('PSICOLOGO')).toBe(true);
    expect(podeConsultarOcorrencias('PSICOLOGO')).toBe(true);
    expect(podeRegistrarComunicacao('PSICOLOGO')).toBe(true);
    expect(podeEncaminharOcorrencia('PSICOLOGO')).toBe(false);
    expect(podeGerarRelatorios('PSICOLOGO')).toBe(false);
    expect(podeGerenciarCategorias('PSICOLOGO')).toBe(false);
    expect(podeGerenciarUsuarios('PSICOLOGO')).toBe(false);
    expect(podeGerenciarTurmas('PSICOLOGO')).toBe(false);
    expect(podeGerenciarEstudantes('PSICOLOGO')).toBe(false);
    expect(podeFiltrarPorProfissional('PSICOLOGO')).toBe(false);
  });

  it('não registra providência nem encerra (RN22): nunca é o responsável pelo acompanhamento', () => {
    const psicologo = { id: 40, perfil: 'PSICOLOGO' };
    expect(podeAtualizarOcorrencia(psicologo, detalhe())).toBe(false);
    expect(podeAtualizarOcorrencia(psicologo, detalhe({ status: 'ABERTO' }))).toBe(false);
  });

  it('Tutor e Psicólogo escolar exigem usuário; só o Psicólogo exige justificativa', () => {
    expect(['TUTOR', 'PSICOLOGO', 'EQUIPE_PEDAGOGICA', 'GESTAO'].filter(destinatarioExigeUsuario))
      .toEqual(['TUTOR', 'PSICOLOGO']);
    expect(['TUTOR', 'PSICOLOGO', 'EQUIPE_PEDAGOGICA', 'GESTAO'].filter(destinatarioExigeJustificativa))
      .toEqual(['PSICOLOGO']);
  });

  it('separa os psicólogos ativos e não os oferece como responsáveis (RN15, RN23)', () => {
    const porTipo = separarUsuariosPorDestinatario(USUARIOS_GESTAO);
    expect(porTipo.PSICOLOGO).toEqual([
      { id: 40, nome: 'Psicóloga Fictícia' },
      { id: 42, nome: 'Psicólogo Fictício Dois' },
    ]);
    const responsaveis = agruparResponsaveis(USUARIOS_GESTAO, []);
    const ids = [
      ...responsaveis.tutoresSugeridos,
      ...responsaveis.outrosTutores,
      ...responsaveis.pedagogicos,
      ...responsaveis.gestao,
    ].map((u) => u.id);
    expect(ids).toEqual([11, 20, 1]);
  });

  it('justificativa oculta só no encaminhamento ao psicólogo com observacao null (RN24)', () => {
    expect(TEXTO_JUSTIFICATIVA_RESTRITA).toBe(AVISO);
    expect(justificativaOculta({ destinatarioPerfil: 'PSICOLOGO', observacao: null })).toBe(true);
    expect(justificativaOculta({ destinatarioPerfil: 'PSICOLOGO', observacao: 'Texto fictício' })).toBe(false);
    expect(justificativaOculta({ destinatarioPerfil: 'GESTAO', observacao: null })).toBe(false);
  });
});

describe('Psicólogo escolar — validação no cliente', () => {
  const DADOS = {
    turmaId: '1',
    categoriaId: '5',
    descricao: 'Descrição fictícia.',
    dataHora: '2026-10-30T08:00',
    local: 'Pátio',
    demaisEnvolvidos: '',
    testemunhas: '',
    providenciasImediatas: '',
    observacoes: '',
  };
  const ESTUDANTES_SELECIONADOS = [{ id: 1 }];
  const agoraMs = AGORA.getTime();

  function linha(campos) {
    return { chave: 1, destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: '', observacao: '', ...campos };
  }

  it('registro: sem psicólogo e sem justificativa, os dois erros na mesma linha', () => {
    const { erros, errosDestinatarios } = validarRegistro(DADOS, ESTUDANTES_SELECIONADOS, [linha()], agoraMs);
    expect(erros).toEqual({});
    expect(errosDestinatarios).toEqual({
      1: { destinatarioUsuarioId: MENSAGEM_PSICOLOGO_OBRIGATORIO, observacao: MENSAGEM_JUSTIFICATIVA_OBRIGATORIA },
    });
    expect(MENSAGEM_PSICOLOGO_OBRIGATORIO).toBe(MSG_PSICOLOGO);
    expect(MENSAGEM_JUSTIFICATIVA_OBRIGATORIA).toBe(MSG_JUSTIFICATIVA);
  });

  it('registro: justificativa só com espaços conta como vazia; acima de 5000 caracteres é recusada', () => {
    const soEspacos = validarRegistro(
      DADOS, ESTUDANTES_SELECIONADOS, [linha({ destinatarioUsuarioId: '40', observacao: '   \n ' })], agoraMs,
    );
    expect(soEspacos.errosDestinatarios).toEqual({ 1: { observacao: MENSAGEM_JUSTIFICATIVA_OBRIGATORIA } });

    const longa = validarRegistro(
      DADOS, ESTUDANTES_SELECIONADOS, [linha({ destinatarioUsuarioId: '40', observacao: 'x'.repeat(5001) })], agoraMs,
    );
    expect(longa.errosDestinatarios).toEqual({ 1: { observacao: MENSAGEM_JUSTIFICATIVA_LONGA } });
  });

  it('registro: válido com psicólogo e justificativa; repetir o mesmo psicólogo é recusado', () => {
    const valida = linha({ destinatarioUsuarioId: '40', observacao: JUSTIFICATIVA });
    expect(validarRegistro(DADOS, ESTUDANTES_SELECIONADOS, [valida], agoraMs).errosDestinatarios).toEqual({});

    const repetida = { ...valida, chave: 2 };
    const { errosDestinatarios } = validarRegistro(DADOS, ESTUDANTES_SELECIONADOS, [valida, repetida], agoraMs);
    expect(errosDestinatarios).toEqual({
      2: { destinatarioUsuarioId: 'Este destinatário repete o destinatário 1. Remova um deles.' },
    });
  });

  it('registro: o corpo leva o psicólogo e a justificativa sem espaços nas pontas', () => {
    const corpo = montarEnvio(DADOS, ESTUDANTES_SELECIONADOS, [
      linha({ destinatarioUsuarioId: '40', observacao: `  ${JUSTIFICATIVA}  ` }),
    ]);
    expect(corpo.encaminhamentos).toEqual([
      { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 40, observacao: JUSTIFICATIVA },
    ]);
  });

  it('encaminhar: mesmas regras, e o responsável continua obrigatório em "Aberto" (RN15)', () => {
    const base = { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: '', responsavelAcompanhamentoId: '', observacao: ' ' };
    expect(validarEncaminhamento(base, 'ABERTO')).toEqual({
      destinatarioUsuarioId: MENSAGEM_PSICOLOGO_OBRIGATORIO,
      responsavelAcompanhamentoId:
        'Escolha o responsável pelo acompanhamento. Ele é obrigatório quando a ocorrência está "Aberto".',
      observacao: MENSAGEM_JUSTIFICATIVA_OBRIGATORIA,
    });
    const valido = { ...base, destinatarioUsuarioId: '40', observacao: JUSTIFICATIVA };
    expect(validarEncaminhamento(valido, 'EM_ACOMPANHAMENTO')).toEqual({});
    expect(montarEnvioEncaminhamento(valido)).toEqual({
      destinatarioPerfil: 'PSICOLOGO',
      destinatarioUsuarioId: 40,
      observacao: JUSTIFICATIVA,
    });
  });

  it('outros destinatários continuam com a observação opcional', () => {
    const base = { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: '', responsavelAcompanhamentoId: '', observacao: '' };
    expect(validarEncaminhamento(base, 'EM_ACOMPANHAMENTO')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

describe('Psicólogo escolar — telas (#154)', () => {
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

  describe('menu do perfil Psicólogo escolar', () => {
    it('mostra só Início, Ocorrências, Registrar ocorrência e Alterar minha senha', async () => {
      sessao('PSICOLOGO');
      renderizarApp('/');
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual([
        'Início',
        'Ocorrências',
        'Registrar ocorrência',
      ]);
      expect(screen.getByRole('link', { name: 'Alterar minha senha' })).toBeInTheDocument();
      // Rótulo do perfil no cabeçalho e na página inicial.
      expect(screen.getByText('· Psicólogo escolar', { exact: false, selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText('Psicólogo escolar', { selector: 'strong' })).toBeInTheDocument();
    });

    it.each(['/usuarios', '/turmas', '/estudantes', '/categorias', '/relatorios'])(
      '%s mostra "Acesso não permitido" para o psicólogo',
      (rota) => {
        sessao('PSICOLOGO');
        renderizarApp(rota);
        expect(screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' })).toBeInTheDocument();
      },
    );
  });

  describe('registro de ocorrência com destinatário "Psicólogo escolar"', () => {
    async function abrirRegistro(perfil = 'PROFESSOR') {
      sessao(perfil);
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
    }

    async function preencherFato() {
      await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
      await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
      await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
      await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia do fato.');
      await usuario.type(screen.getByLabelText('Local'), 'Pátio');
    }

    function grupo() {
      return screen.getByRole('group', { name: 'Destinatário 1' });
    }

    it('lista só os psicólogos ativos e mostra a justificativa com orientação e aviso', async () => {
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      await abrirRegistro('PROFESSOR');

      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');

      const seletor = within(grupo()).getByLabelText('Psicólogo escolar que vai receber');
      expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Selecione o psicólogo escolar',
        'Psicóloga Fictícia',
        'Psicólogo Fictício Dois',
      ]);
      expect(seletor).toHaveAccessibleDescription(expect.stringContaining('Obrigatório.'));

      const justificativa = within(grupo()).getByLabelText('Justificativa para o psicólogo escolar');
      expect(justificativa).toHaveAttribute('aria-required', 'true');
      expect(justificativa).toHaveAttribute('maxlength', '5000');
      // RN06: orientação de redação; RN24: quem pode ler o texto.
      expect(justificativa).toHaveAccessibleDescription(expect.stringContaining('de forma objetiva'));
      expect(justificativa).toHaveAccessibleDescription(expect.stringContaining(AVISO));
      expect(within(grupo()).queryByLabelText('Observação para o destinatário (opcional)')).not.toBeInTheDocument();
    });

    it('a Gestão também vê só os psicólogos ativos (lista completa filtrada)', async () => {
      mockarApi({ usuarios: USUARIOS_GESTAO });
      await abrirRegistro('GESTAO');
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      const seletor = within(grupo()).getByLabelText('Psicólogo escolar que vai receber');
      expect(within(seletor).queryByRole('option', { name: 'Psicólogo Fictício Desativado' })).toBeNull();
    });

    it('sem psicólogo e sem justificativa: bloqueia o envio com mensagens claras e foco no primeiro erro', async () => {
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      await abrirRegistro();
      await preencherFato();
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.type(within(grupo()).getByLabelText('Justificativa para o psicólogo escolar'), '   ');

      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      expect(screen.getByText(MSG_REVISAR)).toBeInTheDocument();
      expect(within(grupo()).getByText(MSG_PSICOLOGO)).toBeInTheDocument();
      expect(within(grupo()).getByText(MSG_JUSTIFICATIVA)).toBeInTheDocument();
      expect(within(grupo()).getByLabelText('Psicólogo escolar que vai receber')).toHaveFocus();
      expect(within(grupo()).getByLabelText('Justificativa para o psicólogo escolar')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(posts('/ocorrencias')).toHaveLength(0);
    });

    it('trocar o tipo do destinatário limpa o erro da justificativa', async () => {
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      await abrirRegistro();
      await preencherFato();
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
      expect(within(grupo()).getByText(MSG_JUSTIFICATIVA)).toBeInTheDocument();

      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Gestão');
      expect(within(grupo()).queryByText(MSG_JUSTIFICATIVA)).not.toBeInTheDocument();
      expect(within(grupo()).getByLabelText('Observação para o destinatário (opcional)')).toBeInTheDocument();
    });

    it('com psicólogo e justificativa: envia o corpo exato e leva ao detalhe', async () => {
      const corpos = [];
      mockarApi({
        usuarios: USUARIOS_REDUZIDOS,
        aoRegistrar: (corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, { id: 12 });
        },
      });
      await abrirRegistro();
      await preencherFato();
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(grupo()).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicóloga Fictícia',
      );
      await usuario.type(
        within(grupo()).getByLabelText('Justificativa para o psicólogo escolar'),
        `  ${JUSTIFICATIVA}  `,
      );

      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      await waitFor(() => expect(corpos).toHaveLength(1));
      expect(corpos[0].encaminhamentos).toEqual([
        { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 40, observacao: JUSTIFICATIVA },
      ]);
      expect(await screen.findByText('Ocorrência nº 12 registrada com sucesso.')).toBeInTheDocument();
    });

    it('o próprio psicólogo registra ocorrência (UC01)', async () => {
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      await abrirRegistro('PSICOLOGO');
      expect(screen.getByRole('heading', { level: 1, name: 'Registrar ocorrência' })).toBeInTheDocument();
      expect(screen.getByLabelText('Turma da ocorrência')).toBeInTheDocument();
    });

    it('400 da API sobre a justificativa aparece como veio', async () => {
      const mensagem = 'Informe a justificativa do encaminhamento ao psicólogo escolar.';
      mockarApi({
        usuarios: USUARIOS_REDUZIDOS,
        aoRegistrar: () => respostaFalsa(400, { erro: mensagem }),
      });
      await abrirRegistro();
      await preencherFato();
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(grupo()).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicóloga Fictícia',
      );
      await usuario.type(within(grupo()).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(mensagem);
    });
  });

  describe('diálogo "Encaminhar" com destinatário "Psicólogo escolar"', () => {
    async function abrirDialogo({ perfil = 'GESTAO', status = 'ABERTO', ...api } = {}) {
      sessao(perfil);
      mockarApi({
        obterDetalhe: () => respostaFalsa(200, detalhe({ status, encaminhamentos: [ENCAMINHAMENTO_EQUIPE] })),
        ...api,
      });
      renderizarApp('/ocorrencias/12');
      await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      await within(dialogo).findByLabelText('Encaminhar para');
      return dialogo;
    }

    it('oferece o psicólogo como destinatário, mas não como responsável (RN15, RN23)', async () => {
      const dialogo = await abrirDialogo();
      await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');

      const seletor = within(dialogo).getByLabelText('Psicólogo escolar que vai receber');
      expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Selecione o psicólogo escolar',
        'Psicóloga Fictícia',
        'Psicólogo Fictício Dois',
      ]);
      const responsavel = within(dialogo).getByLabelText('Responsável pelo acompanhamento');
      const nomes = within(responsavel).getAllByRole('option').map((o) => o.textContent);
      expect(nomes).not.toContain('Psicóloga Fictícia');
      expect(nomes).not.toContain('Psicólogo Fictício Dois');

      const justificativa = within(dialogo).getByLabelText('Justificativa para o psicólogo escolar');
      expect(justificativa).toHaveAccessibleDescription(expect.stringContaining(AVISO));
      expect(justificativa).toHaveAccessibleDescription(expect.stringContaining('de forma objetiva'));
    });

    it('o Pedagógico também encaminha ao psicólogo', async () => {
      const dialogo = await abrirDialogo({ perfil: 'PEDAGOGICO', usuarios: USUARIOS_REDUZIDOS });
      expect(
        within(within(dialogo).getByLabelText('Encaminhar para')).getByRole('option', { name: 'Psicólogo escolar' }),
      ).toBeInTheDocument();
    });

    it('sem psicólogo e sem justificativa: não envia e foca o primeiro erro', async () => {
      const dialogo = await abrirDialogo({ status: 'EM_ACOMPANHAMENTO' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

      expect(within(dialogo).getByText(MSG_PSICOLOGO)).toBeInTheDocument();
      expect(within(dialogo).getByText(MSG_JUSTIFICATIVA)).toBeInTheDocument();
      expect(within(dialogo).getByLabelText('Psicólogo escolar que vai receber')).toHaveFocus();
      expect(posts('/encaminhamentos')).toHaveLength(0);
    });

    it('com psicólogo, justificativa e responsável: envia o corpo exato', async () => {
      const corpos = [];
      const dialogo = await abrirDialogo({
        aoEncaminhar: (corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, detalhe());
        },
      });
      await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(dialogo).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicólogo Fictício Dois',
      );
      await usuario.selectOptions(
        within(dialogo).getByLabelText('Responsável pelo acompanhamento'),
        'Pedagoga Fictícia',
      );
      await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

      await waitFor(() => expect(corpos).toHaveLength(1));
      expect(corpos[0]).toEqual({
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuarioId: 42,
        observacao: JUSTIFICATIVA,
        responsavelAcompanhamentoId: 20,
      });
      expect(await screen.findByText('Encaminhamento registrado.')).toBeInTheDocument();
    });
  });

  describe('detalhe da ocorrência', () => {
    it('o psicólogo vê só "Registrar comunicação" (sem encaminhar, providência e encerramento)', async () => {
      sessao('PSICOLOGO', 40);
      mockarApi({ usuarios: USUARIOS_REDUZIDOS });
      renderizarApp('/ocorrencias/12');
      const acoes = await screen.findByRole('region', { name: 'Ações sobre a ocorrência' });
      expect(within(acoes).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Registrar comunicação',
      ]);
    });

    it('o psicólogo destinatário lê a justificativa', async () => {
      sessao('PSICOLOGO', 40);
      mockarApi();
      renderizarApp('/ocorrencias/12');
      const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
      expect(valorDe(secao, 'Destinatário')).toHaveTextContent('Psicólogo escolar — Psicóloga Fictícia');
      expect(valorDe(secao, 'Justificativa')).toHaveTextContent(JUSTIFICATIVA);
      expect(within(secao).queryByText(AVISO)).not.toBeInTheDocument();
    });

    it.each(['TUTOR', 'PEDAGOGICO', 'PROFESSOR', 'TECNICO_ADMINISTRATIVO', 'PSICOLOGO'])(
      '%s sem permissão (observacao null) vê o aviso fixo no lugar da justificativa (RN24)',
      async (perfil) => {
        sessao(perfil);
        mockarApi({
          obterDetalhe: () =>
            respostaFalsa(200, detalhe({
              encaminhamentos: [{ ...ENCAMINHAMENTO_PSICOLOGO, observacao: null }, ENCAMINHAMENTO_EQUIPE],
            })),
        });
        renderizarApp('/ocorrencias/12');
        const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
        const itens = within(secao).getAllByRole('listitem');
        // O fato do encaminhamento continua visível; só o texto é trocado pelo aviso.
        expect(valorDe(itens[0], 'Destinatário')).toHaveTextContent('Psicólogo escolar — Psicóloga Fictícia');
        expect(valorDe(itens[0], 'Justificativa')).toHaveTextContent(AVISO);
        expect(within(itens[0]).queryByText('Não informado')).not.toBeInTheDocument();
        // Nos demais destinatários, a observação vazia continua "Não informado".
        expect(valorDe(itens[1], 'Observação')).toHaveTextContent('Não informado');
      },
    );
  });

  describe('gestão de usuários', () => {
    it('a lista mostra o rótulo "Psicólogo escolar" e o cadastro oferece o perfil', async () => {
      sessao('GESTAO', 1);
      fetch.mockImplementation(async (url, opcoes = {}) => {
        if (url === `${URL_API}/usuarios` && opcoes.method === 'GET') {
          return respostaFalsa(200, [
            { id: 40, nome: 'Psicóloga Fictícia', email: 'psi@exemplo.test', perfil: 'PSICOLOGO', status: 'ATIVO' },
          ]);
        }
        throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
      });
      renderizarApp('/usuarios');
      expect(await screen.findByText('Psicóloga Fictícia')).toBeInTheDocument();
      expect(screen.getAllByText('Psicólogo escolar').length).toBeGreaterThan(0);
      expect(screen.getByRole('option', { name: 'Psicólogo escolar' })).toHaveValue('PSICOLOGO');
    });
  });

  // -------------------------------------------------------------------------
  // Complementos do QA (#154): lacunas da matriz de critérios de aceite.
  // -------------------------------------------------------------------------
  describe('QA #154 — rotas permitidas ao psicólogo', () => {
    it('abre "Alterar minha senha" sem "Acesso não permitido"', () => {
      sessao('PSICOLOGO');
      renderizarApp('/conta/senha');
      expect(screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Acesso não permitido' })).not.toBeInTheDocument();
    });

    it('abre a lista de ocorrências sem "Acesso não permitido"', async () => {
      sessao('PSICOLOGO');
      fetch.mockImplementation(async (url, opcoes = {}) => {
        if (opcoes.method === 'GET' && /\/ocorrencias(\?.*)?$/.test(url)) {
          return respostaFalsa(200, { itens: [], total: 0, pagina: 1, tamanhoPagina: 20 });
        }
        if (opcoes.method === 'GET') return respostaFalsa(200, []);
        throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
      });
      renderizarApp('/ocorrencias');
      expect(await screen.findByRole('heading', { level: 1, name: 'Ocorrências' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Acesso não permitido' })).not.toBeInTheDocument();
    });
  });

  describe('QA #154 — registro: outros destinatários continuam como antes', () => {
    function grupo(n = 1) {
      return screen.getByRole('group', { name: `Destinatário ${n}` });
    }

    it.each(['Tutor', 'Equipe pedagógica', 'Gestão'])(
      '%s: observação opcional, sem orientação nem aviso da justificativa',
      async (rotulo) => {
        mockarApi({ usuarios: USUARIOS_REDUZIDOS });
        sessao('PROFESSOR');
        renderizarApp('/ocorrencias/nova');
        await screen.findByRole('button', { name: 'Registrar ocorrência' });
        await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), rotulo);
        expect(within(grupo()).getByLabelText('Observação para o destinatário (opcional)')).not.toHaveAttribute(
          'aria-required',
        );
        expect(within(grupo()).queryByLabelText('Justificativa para o psicólogo escolar')).not.toBeInTheDocument();
        expect(within(grupo()).queryByText(AVISO)).not.toBeInTheDocument();
        expect(within(grupo()).queryByText(/de acolhimento, sem opiniões/)).not.toBeInTheDocument();
      },
    );

    it('nenhum psicólogo ativo: a ajuda explica e manda escolher outro destinatário', async () => {
      mockarApi({ usuarios: USUARIOS_REDUZIDOS.filter((u) => u.perfil !== 'PSICOLOGO') });
      sessao('PROFESSOR');
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      await usuario.selectOptions(within(grupo()).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      const seletor = within(grupo()).getByLabelText('Psicólogo escolar que vai receber');
      expect(within(seletor).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Selecione o psicólogo escolar',
      ]);
      expect(seletor).toHaveAccessibleDescription(
        'Obrigatório. Nenhum psicólogo escolar ativo cadastrado: escolha outro destinatário.',
      );
    });

    it('psicólogo + Gestão (toda a equipe, sem observação): corpo exato do POST /ocorrencias', async () => {
      const corpos = [];
      mockarApi({
        usuarios: USUARIOS_REDUZIDOS,
        aoRegistrar: (corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, { id: 12 });
        },
      });
      sessao('TUTOR', 11);
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
      await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
      await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
      await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia do fato.');
      await usuario.type(screen.getByLabelText('Local'), 'Pátio');

      await usuario.selectOptions(within(grupo(1)).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(grupo(1)).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicólogo Fictício Dois',
      );
      await usuario.type(within(grupo(1)).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
      await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
      await usuario.selectOptions(within(grupo(2)).getByLabelText('Encaminhar para'), 'Gestão');

      await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));

      await waitFor(() => expect(corpos).toHaveLength(1));
      expect(corpos[0]).toEqual({
        dataHora: expect.any(String),
        local: 'Pátio',
        turmaId: 1,
        categoriaId: 5,
        descricao: 'Descrição fictícia do fato.',
        estudanteIds: [1],
        demaisEnvolvidos: null,
        testemunhas: null,
        providenciasImediatas: null,
        observacoes: null,
        encaminhamentos: [
          { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 42, observacao: JUSTIFICATIVA },
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null },
        ],
      });
    });
  });

  describe('QA #154 — diálogo "Encaminhar" pelo Pedagógico (lista reduzida)', () => {
    async function abrirComoPedagogico({ status, aoEncaminhar }) {
      sessao('PEDAGOGICO', 20);
      mockarApi({
        usuarios: USUARIOS_REDUZIDOS,
        obterDetalhe: () => respostaFalsa(200, detalhe({ status, encaminhamentos: [ENCAMINHAMENTO_EQUIPE] })),
        aoEncaminhar,
      });
      renderizarApp('/ocorrencias/12');
      await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
      await within(dialogo).findByLabelText('Encaminhar para');
      return dialogo;
    }

    it('"Aberto": o psicólogo não aparece entre os responsáveis (lista reduzida com perfil PSICOLOGO)', async () => {
      const dialogo = await abrirComoPedagogico({ status: 'ABERTO' });
      const responsavel = within(dialogo).getByLabelText('Responsável pelo acompanhamento');
      const nomes = within(responsavel).getAllByRole('option').map((o) => o.textContent);
      expect(nomes).toEqual(expect.arrayContaining(['Tutor Fictício A', 'Pedagoga Fictícia', 'Gestora Fictícia']));
      expect(nomes).not.toContain('Psicóloga Fictícia');
      expect(nomes).not.toContain('Psicólogo Fictício Dois');
    });

    it('"Em acompanhamento": corpo exato sem responsavelAcompanhamentoId e a resposta com observacao null mostra o aviso', async () => {
      const corpos = [];
      const dialogo = await abrirComoPedagogico({
        status: 'EM_ACOMPANHAMENTO',
        aoEncaminhar: (corpo) => {
          corpos.push(corpo);
          // RN24: a resposta 201 também segue a regra (aqui, como se outra
          // pessoa tivesse registrado o encaminhamento ao psicólogo).
          return respostaFalsa(
            201,
            detalhe({ encaminhamentos: [ENCAMINHAMENTO_EQUIPE, { ...ENCAMINHAMENTO_PSICOLOGO, observacao: null }] }),
          );
        },
      });
      await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(dialogo).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicóloga Fictícia',
      );
      await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), `  ${JUSTIFICATIVA} `);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

      await waitFor(() => expect(corpos).toHaveLength(1));
      expect(corpos[0]).toEqual({
        destinatarioPerfil: 'PSICOLOGO',
        destinatarioUsuarioId: 40,
        observacao: JUSTIFICATIVA,
      });
      expect(await screen.findByText('Encaminhamento registrado.')).toBeInTheDocument();
      const secao = screen.getByRole('region', { name: 'Encaminhamentos' });
      const itens = within(secao).getAllByRole('listitem');
      expect(valorDe(itens[1], 'Justificativa')).toHaveTextContent(AVISO);
    });

    it('justificativa só com espaços no diálogo: não envia', async () => {
      const dialogo = await abrirComoPedagogico({ status: 'EM_ACOMPANHAMENTO' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
      await usuario.selectOptions(
        within(dialogo).getByLabelText('Psicólogo escolar que vai receber'),
        'Psicóloga Fictícia',
      );
      await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), '    ');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));
      expect(within(dialogo).getByText(MSG_JUSTIFICATIVA)).toBeInTheDocument();
      expect(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar')).toHaveFocus();
      expect(posts('/encaminhamentos')).toHaveLength(0);
    });
  });

  describe('QA #154 — detalhe: quem pode ler e destinatários antigos', () => {
    it.each(['GESTAO', 'PEDAGOGICO', 'PROFESSOR'])(
      '%s com a observacao na resposta (pode ler) vê o texto, sem o aviso',
      async (perfil) => {
        sessao(perfil);
        mockarApi();
        renderizarApp('/ocorrencias/12');
        const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
        expect(valorDe(secao, 'Justificativa')).toHaveTextContent(JUSTIFICATIVA);
        expect(within(secao).queryByText(AVISO)).not.toBeInTheDocument();
      },
    );

    it('Tutor, Equipe e Gestão com observação: rótulo "Observação", texto visível e sem aviso', async () => {
      sessao('TUTOR', 11);
      const outros = [
        { ...ENCAMINHAMENTO_EQUIPE, id: 301, destinatarioPerfil: 'TUTOR', destinatarioUsuario: { id: 11, nome: 'Tutor Fictício A' }, observacao: 'Observação fictícia ao tutor.' },
        { ...ENCAMINHAMENTO_EQUIPE, id: 302, observacao: 'Observação fictícia à equipe.' },
        { ...ENCAMINHAMENTO_EQUIPE, id: 303, destinatarioPerfil: 'GESTAO', observacao: 'Observação fictícia à gestão.' },
      ];
      mockarApi({ obterDetalhe: () => respostaFalsa(200, detalhe({ encaminhamentos: outros })) });
      renderizarApp('/ocorrencias/12');
      const secao = await screen.findByRole('region', { name: 'Encaminhamentos' });
      const itens = within(secao).getAllByRole('listitem');
      expect(valorDe(itens[0], 'Observação')).toHaveTextContent('Observação fictícia ao tutor.');
      expect(valorDe(itens[1], 'Observação')).toHaveTextContent('Observação fictícia à equipe.');
      expect(valorDe(itens[2], 'Observação')).toHaveTextContent('Observação fictícia à gestão.');
      expect(within(secao).queryByText('Justificativa', { selector: 'dt' })).not.toBeInTheDocument();
      expect(within(secao).queryByText(AVISO)).not.toBeInTheDocument();
    });

    it('psicólogo destinatário com a ocorrência "Aberto": também só "Registrar comunicação"', async () => {
      sessao('PSICOLOGO', 40);
      mockarApi({ obterDetalhe: () => respostaFalsa(200, detalhe({ status: 'ABERTO' })) });
      renderizarApp('/ocorrencias/12');
      const acoes = await screen.findByRole('region', { name: 'Ações sobre a ocorrência' });
      expect(within(acoes).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Registrar comunicação',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Ajuste aprovado na revisão (#154): trocar o tipo de destinatário saindo do
  // Psicólogo escolar ou entrando nele apaga a justificativa/observação, com
  // confirmação quando há texto (RN24: a justificativa não vira observação comum).
  // -------------------------------------------------------------------------
  describe('troca de destinatário apaga a justificativa/observação (RN24)', () => {
    const PERGUNTA_JUSTIFICATIVA = 'A justificativa digitada será apagada. Deseja continuar?';
    const PERGUNTA_OBSERVACAO = 'A observação digitada será apagada. Deseja continuar?';
    const CONFIRMAR = 'Sim, apagar e trocar';
    const CANCELAR = 'Não, manter como está';

    describe('no registro da ocorrência', () => {
      function grupo() {
        return screen.getByRole('group', { name: 'Destinatário 1' });
      }
      const tipo = () => within(grupo()).getByLabelText('Encaminhar para');
      const justificativa = () => within(grupo()).getByLabelText('Justificativa para o psicólogo escolar');
      const observacao = () => within(grupo()).getByLabelText('Observação para o destinatário (opcional)');

      async function abrir(corpos) {
        mockarApi({
          usuarios: USUARIOS_REDUZIDOS,
          aoRegistrar: (corpo) => {
            corpos?.push(corpo);
            return respostaFalsa(201, { id: 12 });
          },
        });
        sessao('PROFESSOR');
        renderizarApp('/ocorrencias/nova');
        await screen.findByRole('button', { name: 'Registrar ocorrência' });
      }

      async function escreverJustificativa() {
        await usuario.selectOptions(tipo(), 'Psicólogo escolar');
        await usuario.selectOptions(
          within(grupo()).getByLabelText('Psicólogo escolar que vai receber'),
          'Psicóloga Fictícia',
        );
        await usuario.type(justificativa(), JUSTIFICATIVA);
      }

      it('justificativa → Gestão e confirmar: o campo fica vazio e o corpo leva observacao null', async () => {
        const corpos = [];
        await abrir(corpos);
        await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
        await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
        await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
        await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia do fato.');
        await usuario.type(screen.getByLabelText('Local'), 'Pátio');
        await escreverJustificativa();

        await usuario.selectOptions(tipo(), 'Gestão');

        // Antes de confirmar, nada mudou: o tipo e o texto continuam.
        const confirmacao = within(grupo()).getByRole('group', { name: PERGUNTA_JUSTIFICATIVA });
        expect(within(confirmacao).getByRole('button', { name: CANCELAR })).toHaveFocus();
        expect(tipo()).toHaveValue('PSICOLOGO');
        expect(justificativa()).toHaveValue(JUSTIFICATIVA);

        await usuario.click(within(confirmacao).getByRole('button', { name: CONFIRMAR }));

        expect(within(grupo()).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipo()).toHaveValue('GESTAO');
        expect(tipo()).toHaveFocus();
        expect(observacao()).toHaveValue('');
        expect(within(grupo()).queryByText(JUSTIFICATIVA)).not.toBeInTheDocument();

        await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0].encaminhamentos).toEqual([
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null },
        ]);
      });

      it('cancelar: o tipo, o psicólogo escolhido e a justificativa ficam como estavam', async () => {
        await abrir();
        await escreverJustificativa();
        await usuario.selectOptions(tipo(), 'Equipe pedagógica');
        await usuario.click(within(grupo()).getByRole('button', { name: CANCELAR }));

        expect(within(grupo()).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipo()).toHaveValue('PSICOLOGO');
        expect(tipo()).toHaveFocus();
        expect(within(grupo()).getByLabelText('Psicólogo escolar que vai receber')).toHaveValue('40');
        expect(justificativa()).toHaveValue(JUSTIFICATIVA);
      });

      it('Esc na confirmação também cancela', async () => {
        await abrir();
        await escreverJustificativa();
        await usuario.selectOptions(tipo(), 'Tutor');
        await usuario.keyboard('{Escape}');
        expect(within(grupo()).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipo()).toHaveValue('PSICOLOGO');
        expect(justificativa()).toHaveValue(JUSTIFICATIVA);
      });

      it('observação para a Gestão → Psicólogo escolar: pede confirmação e limpa o campo', async () => {
        await abrir();
        await usuario.selectOptions(tipo(), 'Gestão');
        await usuario.type(observacao(), 'Observação fictícia para a gestão.');

        await usuario.selectOptions(tipo(), 'Psicólogo escolar');
        const confirmacao = within(grupo()).getByRole('group', { name: PERGUNTA_OBSERVACAO });
        expect(tipo()).toHaveValue('GESTAO');

        await usuario.click(within(confirmacao).getByRole('button', { name: CONFIRMAR }));
        expect(tipo()).toHaveValue('PSICOLOGO');
        expect(justificativa()).toHaveValue('');
      });

      it.each([
        ['vazia', ''],
        ['só com espaços', '   '],
      ])('justificativa %s: troca sem confirmação e o campo fica vazio', async (_caso, texto) => {
        await abrir();
        await usuario.selectOptions(tipo(), 'Psicólogo escolar');
        if (texto) await usuario.type(justificativa(), texto);
        await usuario.selectOptions(tipo(), 'Gestão');
        expect(within(grupo()).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipo()).toHaveValue('GESTAO');
        expect(observacao()).toHaveValue('');
      });

      it('entre Tutor, Equipe pedagógica e Gestão a observação é mantida, sem confirmação', async () => {
        await abrir();
        await usuario.selectOptions(tipo(), 'Tutor');
        await usuario.type(observacao(), 'Observação fictícia.');
        await usuario.selectOptions(tipo(), 'Equipe pedagógica');
        await usuario.selectOptions(tipo(), 'Gestão');
        expect(screen.queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();
        expect(observacao()).toHaveValue('Observação fictícia.');
      });
    });

    describe('no diálogo "Encaminhar"', () => {
      async function abrirDialogo(aoEncaminhar) {
        sessao('GESTAO', 1);
        mockarApi({
          obterDetalhe: () =>
            respostaFalsa(200, detalhe({ status: 'EM_ACOMPANHAMENTO', encaminhamentos: [ENCAMINHAMENTO_EQUIPE] })),
          aoEncaminhar,
        });
        renderizarApp('/ocorrencias/12');
        await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
        const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
        await within(dialogo).findByLabelText('Encaminhar para');
        return dialogo;
      }

      async function escreverJustificativa(dialogo) {
        await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
        await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
      }

      it('justificativa → Gestão e confirmar: o campo fica vazio e o corpo leva observacao null', async () => {
        const corpos = [];
        const dialogo = await abrirDialogo((corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, detalhe());
        });
        await escreverJustificativa(dialogo);
        const tipo = within(dialogo).getByLabelText('Encaminhar para');

        await usuario.selectOptions(tipo, 'Gestão');
        const confirmacao = within(dialogo).getByRole('group', { name: PERGUNTA_JUSTIFICATIVA });
        expect(within(confirmacao).getByRole('button', { name: CANCELAR })).toHaveFocus();
        expect(tipo).toHaveValue('PSICOLOGO');

        await usuario.click(within(confirmacao).getByRole('button', { name: CONFIRMAR }));
        expect(tipo).toHaveValue('GESTAO');
        expect(tipo).toHaveFocus();
        expect(within(dialogo).getByLabelText('Observação (opcional)')).toHaveValue('');

        await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0]).toEqual({ destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null });
      });

      it('cancelar (ou Esc): nada muda e o diálogo continua aberto', async () => {
        const dialogo = await abrirDialogo();
        await escreverJustificativa(dialogo);
        const tipo = within(dialogo).getByLabelText('Encaminhar para');

        await usuario.selectOptions(tipo, 'Tutor');
        await usuario.click(within(dialogo).getByRole('button', { name: CANCELAR }));
        expect(tipo).toHaveValue('PSICOLOGO');
        expect(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue(JUSTIFICATIVA);

        await usuario.selectOptions(tipo, 'Gestão');
        await usuario.keyboard('{Escape}');
        expect(screen.getByRole('dialog', { name: 'Encaminhar ocorrência' })).toBeInTheDocument();
        expect(within(dialogo).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipo).toHaveValue('PSICOLOGO');
        expect(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue(JUSTIFICATIVA);
      });

      it('observação para a Gestão → Psicólogo escolar: pede confirmação e limpa o campo', async () => {
        const dialogo = await abrirDialogo();
        const tipo = within(dialogo).getByLabelText('Encaminhar para');
        await usuario.selectOptions(tipo, 'Gestão');
        await usuario.type(within(dialogo).getByLabelText('Observação (opcional)'), 'Observação fictícia.');

        await usuario.selectOptions(tipo, 'Psicólogo escolar');
        const confirmacao = within(dialogo).getByRole('group', { name: PERGUNTA_OBSERVACAO });
        await usuario.click(within(confirmacao).getByRole('button', { name: CONFIRMAR }));
        expect(tipo).toHaveValue('PSICOLOGO');
        expect(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue('');
      });

      it('campo vazio: troca sem confirmação', async () => {
        const dialogo = await abrirDialogo();
        const tipo = within(dialogo).getByLabelText('Encaminhar para');
        await usuario.selectOptions(tipo, 'Psicólogo escolar');
        await usuario.selectOptions(tipo, 'Equipe pedagógica');
        expect(within(dialogo).queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();
        expect(tipo).toHaveValue('EQUIPE_PEDAGOGICA');
        expect(within(dialogo).getByLabelText('Observação (opcional)')).toHaveValue('');
      });
    });

    // QA #154: casos de borda da confirmação de troca.
    describe('QA #154 — casos de borda no registro', () => {
      const grupoN = (n) => screen.getByRole('group', { name: `Destinatário ${n}` });
      const tipoN = (n) => within(grupoN(n)).getByLabelText('Encaminhar para');

      async function abrirComFato(corpos) {
        mockarApi({
          usuarios: USUARIOS_REDUZIDOS,
          aoRegistrar: (corpo) => {
            corpos?.push(corpo);
            return respostaFalsa(201, { id: 12 });
          },
        });
        sessao('PROFESSOR');
        renderizarApp('/ocorrencias/nova');
        await screen.findByRole('button', { name: 'Registrar ocorrência' });
        await usuario.selectOptions(screen.getByLabelText('Turma da ocorrência'), ROTULO_6A);
        await usuario.click(await screen.findByRole('checkbox', { name: 'Estudante Fictício A' }));
        await usuario.selectOptions(screen.getByLabelText('Categoria'), 'Categoria Fictícia X');
        await usuario.type(screen.getByLabelText('Descrição do fato'), 'Descrição fictícia do fato.');
        await usuario.type(screen.getByLabelText('Local'), 'Pátio');
      }

      async function psicologoComJustificativa(n, nome = 'Psicóloga Fictícia') {
        await usuario.selectOptions(tipoN(n), 'Psicólogo escolar');
        await usuario.selectOptions(within(grupoN(n)).getByLabelText('Psicólogo escolar que vai receber'), nome);
        await usuario.type(within(grupoN(n)).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
      }

      it('trocar de um psicólogo para outro mantém a justificativa, sem confirmação', async () => {
        const corpos = [];
        await abrirComFato(corpos);
        await psicologoComJustificativa(1);
        await usuario.selectOptions(
          within(grupoN(1)).getByLabelText('Psicólogo escolar que vai receber'),
          'Psicólogo Fictício Dois',
        );
        expect(screen.queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();
        expect(within(grupoN(1)).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue(JUSTIFICATIVA);

        await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0].encaminhamentos).toEqual([
          { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 42, observacao: JUSTIFICATIVA },
        ]);
      });

      it('remover a linha com a confirmação aberta e adicionar outra: a nova linha vem limpa e sem confirmação', async () => {
        await abrirComFato();
        await psicologoComJustificativa(1);
        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
        await usuario.selectOptions(tipoN(2), 'Gestão');
        await usuario.selectOptions(tipoN(1), 'Gestão');
        expect(within(grupoN(1)).getByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).toBeInTheDocument();

        await usuario.click(screen.getByRole('button', { name: 'Remover destinatário 1' }));
        expect(screen.queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(screen.queryByText(JUSTIFICATIVA)).not.toBeInTheDocument();

        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
        expect(tipoN(2)).toHaveValue('');
        expect(screen.queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        await usuario.selectOptions(tipoN(2), 'Psicólogo escolar');
        expect(within(grupoN(2)).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue('');
      });

      it('vários destinatários: a confirmação vale só para a linha trocada, e o corpo sai certo', async () => {
        const corpos = [];
        await abrirComFato(corpos);
        await psicologoComJustificativa(1);
        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
        await usuario.selectOptions(tipoN(2), 'Gestão');
        await usuario.type(
          within(grupoN(2)).getByLabelText('Observação para o destinatário (opcional)'),
          'Observação fictícia à gestão.',
        );
        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
        await psicologoComJustificativa(3, 'Psicólogo Fictício Dois');

        // Linha 2: Gestão → Equipe mantém a observação, sem confirmação.
        await usuario.selectOptions(tipoN(2), 'Equipe pedagógica');
        expect(screen.queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();

        // Linha 3: Psicólogo → Gestão pede confirmação só na linha 3.
        await usuario.selectOptions(tipoN(3), 'Gestão');
        expect(within(grupoN(3)).getByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).toBeInTheDocument();
        expect(within(grupoN(1)).queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        await usuario.click(within(grupoN(3)).getByRole('button', { name: CONFIRMAR }));

        await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0].encaminhamentos).toEqual([
          { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 40, observacao: JUSTIFICATIVA },
          { destinatarioPerfil: 'EQUIPE_PEDAGOGICA', destinatarioUsuarioId: null, observacao: 'Observação fictícia à gestão.' },
          { destinatarioPerfil: 'GESTAO', destinatarioUsuarioId: null, observacao: null },
        ]);
      });

      it('confirmação aberta numa linha e troca de tipo em outra: a primeira fecha sem mudar nada', async () => {
        await abrirComFato();
        await psicologoComJustificativa(1);
        await usuario.click(screen.getByRole('button', { name: 'Adicionar destinatário' }));
        await usuario.selectOptions(tipoN(1), 'Tutor');
        expect(within(grupoN(1)).getByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).toBeInTheDocument();

        await usuario.selectOptions(tipoN(2), 'Gestão');
        expect(screen.queryByRole('group', { name: PERGUNTA_JUSTIFICATIVA })).not.toBeInTheDocument();
        expect(tipoN(1)).toHaveValue('PSICOLOGO');
        expect(within(grupoN(1)).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue(JUSTIFICATIVA);
      });

      it('cancelar e depois enviar: vai o psicólogo com a justificativa', async () => {
        const corpos = [];
        await abrirComFato(corpos);
        await psicologoComJustificativa(1);
        await usuario.selectOptions(tipoN(1), 'Gestão');
        await usuario.click(within(grupoN(1)).getByRole('button', { name: CANCELAR }));
        await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0].encaminhamentos).toEqual([
          { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 40, observacao: JUSTIFICATIVA },
        ]);
      });

      it('enviar com a confirmação ainda aberta: vale o tipo atual (psicólogo), a justificativa não vai para a Gestão', async () => {
        const corpos = [];
        await abrirComFato(corpos);
        await psicologoComJustificativa(1);
        await usuario.selectOptions(tipoN(1), 'Gestão');
        await usuario.click(screen.getByRole('button', { name: 'Registrar ocorrência' }));
        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0].encaminhamentos).toEqual([
          { destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 40, observacao: JUSTIFICATIVA },
        ]);
      });
    });

    describe('QA #154 — casos de borda no diálogo "Encaminhar"', () => {
      async function abrirDialogo(aoEncaminhar) {
        sessao('GESTAO', 1);
        mockarApi({
          obterDetalhe: () =>
            respostaFalsa(200, detalhe({ status: 'EM_ACOMPANHAMENTO', encaminhamentos: [ENCAMINHAMENTO_EQUIPE] })),
          aoEncaminhar,
        });
        renderizarApp('/ocorrencias/12');
        await usuario.click(await screen.findByRole('button', { name: 'Encaminhar' }));
        const dialogo = await screen.findByRole('dialog', { name: 'Encaminhar ocorrência' });
        await within(dialogo).findByLabelText('Encaminhar para');
        return dialogo;
      }

      it('justificativa só com espaços: troca sem confirmação e o campo fica vazio', async () => {
        const dialogo = await abrirDialogo();
        const tipo = within(dialogo).getByLabelText('Encaminhar para');
        await usuario.selectOptions(tipo, 'Psicólogo escolar');
        await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), '   ');
        await usuario.selectOptions(tipo, 'Gestão');
        expect(within(dialogo).queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();
        expect(within(dialogo).getByLabelText('Observação (opcional)')).toHaveValue('');
      });

      it('trocar de psicólogo mantém a justificativa; cancelar a troca de tipo e enviar leva o psicólogo novo', async () => {
        const corpos = [];
        const dialogo = await abrirDialogo((corpo) => {
          corpos.push(corpo);
          return respostaFalsa(201, detalhe());
        });
        const tipo = within(dialogo).getByLabelText('Encaminhar para');
        await usuario.selectOptions(tipo, 'Psicólogo escolar');
        const seletor = () => within(dialogo).getByLabelText('Psicólogo escolar que vai receber');
        await usuario.selectOptions(seletor(), 'Psicóloga Fictícia');
        await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
        await usuario.selectOptions(seletor(), 'Psicólogo Fictício Dois');
        expect(within(dialogo).queryByRole('button', { name: CONFIRMAR })).not.toBeInTheDocument();

        await usuario.selectOptions(tipo, 'Tutor');
        await usuario.click(within(dialogo).getByRole('button', { name: CANCELAR }));
        await usuario.click(within(dialogo).getByRole('button', { name: 'Encaminhar' }));

        await waitFor(() => expect(corpos).toHaveLength(1));
        expect(corpos[0]).toEqual({ destinatarioPerfil: 'PSICOLOGO', destinatarioUsuarioId: 42, observacao: JUSTIFICATIVA });
      });

      it('Esc na confirmação não fecha o diálogo nem apaga a justificativa', async () => {
        const dialogo = await abrirDialogo();
        await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Psicólogo escolar');
        await usuario.type(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar'), JUSTIFICATIVA);
        await usuario.selectOptions(within(dialogo).getByLabelText('Encaminhar para'), 'Gestão');
        await usuario.keyboard('{Escape}');
        expect(screen.getByRole('dialog', { name: 'Encaminhar ocorrência' })).toBeInTheDocument();
        expect(within(dialogo).getByLabelText('Justificativa para o psicólogo escolar')).toHaveValue(JUSTIFICATIVA);
      });
    });
  });

  describe('página /privacidade', () => {
    it('QA #154: a frase de quem lê a justificativa não inclui a Equipe Pedagógica (RN24)', () => {
      const frase = POLITICA_PRIVACIDADE.secoes
        .flatMap((s) => s.blocos.flatMap((b) => (typeof b === 'string' ? [b] : b.lista)))
        .map((t) => t.replace(/\*\*/g, ''))
        .find((t) => t.startsWith('A justificativa do encaminhamento ao psicólogo escolar aparece só para'));
      const quemLe = frase.split('.')[0];
      expect(quemLe).toContain('psicólogo escolar que recebeu o encaminhamento');
      expect(quemLe).toContain('Gestão');
      expect(quemLe).toContain('quem fez o encaminhamento');
      expect(quemLe).not.toMatch(/Pedag/);
      // A segunda frase não é absoluta: quem fez o encaminhamento lê a própria justificativa.
      expect(frase).toContain(
        'A Equipe Pedagógica e os demais usuários que veem a ocorrência sabem que ela foi encaminhada ao psicólogo, mas só leem a justificativa dos encaminhamentos que eles mesmos fizeram.',
      );
      expect(frase).not.toContain('não leem a justificativa');
    });

    it('cada documento tem a própria data de revisão (Política 24/11/2026; Termos 13/11/2026)', () => {
      expect(POLITICA_PRIVACIDADE.nota).toBe(NOTA_VERSAO_POLITICA_PRIVACIDADE);
      expect(TERMOS_USO.nota).toBe(NOTA_VERSAO_TERMOS_USO);
      expect(NOTA_VERSAO_POLITICA_PRIVACIDADE).toContain('(versão provisória revisada em 24/11/2026)');
      expect(NOTA_VERSAO_TERMOS_USO).toContain('(versão provisória revisada em 13/11/2026)');
    });

    it('as páginas mostram a data de cada documento', () => {
      const { unmount } = renderizarApp('/privacidade');
      expect(document.body.textContent).toContain('revisada em 24/11/2026');
      unmount();
      renderizarApp('/termos');
      expect(document.body.textContent).toContain('revisada em 13/11/2026');
      expect(document.body.textContent).not.toContain('24/11/2026');
    });

    function textoDaPolitica() {
      return POLITICA_PRIVACIDADE.secoes
        .flatMap((s) => s.blocos.flatMap((b) => (typeof b === 'string' ? [b] : b.lista)))
        .join('\n')
        .replace(/\*\*/g, '');
    }

    it('inclui o perfil, a justificativa como dado sensível e quem pode lê-la (sem a Equipe Pedagógica)', () => {
      const texto = textoDaPolitica();
      expect(texto).toContain('Professor, Tutor, Psicólogo escolar ou Técnico-administrativo');
      expect(texto).toContain('no encaminhamento ao psicólogo escolar, a justificativa');
      expect(texto).toContain('Psicólogo escolar: as ocorrências que registrou e as encaminhadas a ele.');
      expect(texto).toContain(
        'A justificativa do encaminhamento ao psicólogo escolar aparece só para o psicólogo escolar que recebeu o encaminhamento, para a Gestão e para quem fez o encaminhamento.',
      );
      expect(texto).toContain(
        'A Equipe Pedagógica e os demais usuários que veem a ocorrência sabem que ela foi encaminhada ao psicólogo, mas só leem a justificativa dos encaminhamentos que eles mesmos fizeram.',
      );
    });

    it('a página continua com o aviso de texto provisório e mostra o novo trecho', () => {
      renderizarApp('/privacidade');
      expect(screen.getByText('Texto provisório — a validar com a escola.')).toBeInTheDocument();
      expect(document.body.textContent).toContain('Psicólogo escolar: as ocorrências que registrou');
    });
  });
});
