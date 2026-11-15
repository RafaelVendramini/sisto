// Testes complementares do QA — Issue #43 (tela de estudantes).
// Cobrem: corrida de respostas no filtro, filtro após cadastro/edição na mesma
// turma, falha de GET /usuarios (só Gestão), tutor bloqueado na edição
// (desvincular, voltar a ele, opções não vazam para o cadastro), tipos do
// payload, duplo envio, 500 genérico, nada de estudante em storage/console,
// marcação responsiva e funções puras de mensagensEstudantes/estudantes.
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';
import {
  codigoParaEnvio,
  ehCodigoDuplicado,
  idParaEnvio,
  listaPodeEstarDesatualizada,
  mensagemErroEstudante,
  rotuloOpcaoTutor,
  sinalizacaoTutor,
  validarEstudante,
  MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE,
  MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
} from '../src/services/mensagensEstudantes.js';

const URL_API = 'http://api.exemplo.test';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const TURMAS = [TURMA_6A, TURMA_7B];

const USUARIOS = [
  { id: 1, nome: 'Gestora Fictícia', email: 'gestora@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício Ativo', email: 't1@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 11, nome: 'Tutora Fictícia Bloqueada', email: 't2@exemplo.test', perfil: 'TUTOR', status: 'BLOQUEADO' },
  { id: 14, nome: 'Tutora Fictícia Dois', email: 't4@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];

function tutor(id) {
  const { nome, email, status } = USUARIOS.find((u) => u.id === id);
  return { id, nome, email, status };
}

const ESTUDANTES = [
  { id: 1, nomeCompleto: 'Estudante Fictício 01', codigoEscolar: 'QA-0001', turma: TURMA_6A, tutor: tutor(10) },
  { id: 2, nomeCompleto: 'Estudante Fictício 02', codigoEscolar: null, turma: TURMA_7B, tutor: tutor(11) },
  { id: 3, nomeCompleto: 'Estudante Fictício 03', codigoEscolar: 'QA-0003', turma: TURMA_6A, tutor: null },
];

function respostaDoCorpo(id, corpo) {
  return {
    id,
    nomeCompleto: corpo.nomeCompleto,
    codigoEscolar: corpo.codigoEscolar,
    turma: TURMAS.find((t) => t.id === corpo.turmaId),
    tutor: corpo.tutorId == null ? null : tutor(corpo.tutorId),
  };
}

function mockarApi({
  estudantes = ESTUDANTES,
  usuarios = () => respostaFalsa(200, USUARIOS),
  aoCriar,
  aoAtualizar,
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) return respostaFalsa(200, TURMAS);
    if (opcoes.method === 'GET' && url === `${URL_API}/usuarios`) return usuarios();
    const get = url.match(/\/estudantes(?:\?turmaId=(\d+))?$/);
    if (opcoes.method === 'GET' && get) {
      if (typeof estudantes === 'function') return estudantes(get[1]);
      const lista = get[1] ? estudantes.filter((e) => e.turma.id === Number(get[1])) : estudantes;
      return respostaFalsa(200, lista);
    }
    if (url === `${URL_API}/estudantes` && opcoes.method === 'POST' && aoCriar) {
      return aoCriar(JSON.parse(opcoes.body));
    }
    const put = url.match(/\/estudantes\/(\d+)$/);
    if (put && opcoes.method === 'PUT' && aoAtualizar) {
      return aoAtualizar(Number(put[1]), JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadas(metodo) {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === metodo);
}

function nomesNaTabela() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((linha) => within(linha).getAllByRole('cell')[0].textContent);
}

function textosDasOpcoes(select) {
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent);
}

async function abrirPagina() {
  renderizarApp('/estudantes');
  await screen.findByRole('table');
  await screen.findByRole('button', { name: 'Cadastrar estudante' });
}

function formularioCadastro() {
  const secao = screen.getByRole('region', { name: 'Cadastrar estudante' });
  return {
    nome: within(secao).getByLabelText('Nome completo'),
    codigo: within(secao).getByLabelText('Código escolar (opcional)'),
    turma: within(secao).getByLabelText('Turma'),
    tutor: within(secao).getByLabelText('Professor tutor (opcional)'),
    cadastrar: within(secao).getByRole('button', { name: 'Cadastrar estudante' }),
  };
}

function dialogoEdicao() {
  const dialogo = screen.getByRole('dialog', { name: 'Editar estudante' });
  return {
    dialogo,
    nome: within(dialogo).getByLabelText('Nome completo'),
    codigo: within(dialogo).getByLabelText('Código escolar (opcional)'),
    turma: within(dialogo).getByLabelText('Turma'),
    tutor: within(dialogo).getByLabelText('Professor tutor (opcional)'),
    salvar: within(dialogo).getByRole('button', { name: 'Salvar alterações' }),
  };
}

/** Promessa controlada pelo teste. */
function adiada() {
  let resolver;
  const promessa = new Promise((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe('Tela de estudantes — complementares do QA (#43)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
    gravarSessaoFicticia();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('filtro por turma (c)', () => {
    it('corrida: resposta antiga (6º A) chegando depois da nova (7º B) não sobrescreve a lista', async () => {
      const lenta = adiada();
      mockarApi({
        estudantes: (turmaId) => {
          if (turmaId === '1') return lenta.promessa;
          const lista = turmaId ? ESTUDANTES.filter((e) => e.turma.id === Number(turmaId)) : ESTUDANTES;
          return respostaFalsa(200, lista);
        },
      });
      await abrirPagina();

      const filtro = screen.getByLabelText('Filtrar por turma');
      await usuario.selectOptions(filtro, ROTULO_6A);
      await usuario.selectOptions(filtro, ROTULO_7B);
      await waitFor(() => expect(nomesNaTabela()).toEqual(['Estudante Fictício 02']));

      // Agora a resposta antiga (6º A) chega.
      lenta.resolver(respostaFalsa(200, ESTUDANTES.filter((e) => e.turma.id === 1)));
      await new Promise((r) => setTimeout(r, 20));
      expect(nomesNaTabela()).toEqual(['Estudante Fictício 02']);
      expect(screen.queryByText('Carregando estudantes...')).not.toBeInTheDocument();
    });

    it('corrida: erro da consulta antiga não aparece sobre a lista nova', async () => {
      const lenta = adiada();
      mockarApi({
        estudantes: (turmaId) => {
          if (turmaId === '1') return lenta.promessa;
          const lista = turmaId ? ESTUDANTES.filter((e) => e.turma.id === Number(turmaId)) : ESTUDANTES;
          return respostaFalsa(200, lista);
        },
      });
      await abrirPagina();

      const filtro = screen.getByLabelText('Filtrar por turma');
      await usuario.selectOptions(filtro, ROTULO_6A);
      await usuario.selectOptions(filtro, ROTULO_7B);
      await waitFor(() => expect(nomesNaTabela()).toEqual(['Estudante Fictício 02']));

      lenta.resolver(respostaFalsa(500, { erro: 'Erro interno do servidor.' }));
      await new Promise((r) => setTimeout(r, 20));
      const secao = screen.getByRole('region', { name: 'Estudantes cadastrados' });
      expect(within(secao).queryByRole('alert')).not.toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Estudante Fictício 02']);
    });

    it('cadastro na mesma turma do filtro: o estudante entra na lista filtrada, sem aviso de filtro', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(9, corpo)) });
      await abrirPagina();
      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_6A);
      await waitFor(() => expect(nomesNaTabela()).toHaveLength(2));

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      const msg = await screen.findByText(/Estudante Estudante Fictício 00 cadastrado com sucesso\./);
      expect(msg.textContent).not.toMatch(/filtro atual/);
      expect(nomesNaTabela()).toEqual([
        'Estudante Fictício 00',
        'Estudante Fictício 01',
        'Estudante Fictício 03',
      ]);
    });

    it('edição mantendo a turma do filtro: a linha é atualizada no lugar', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      await abrirPagina();
      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_6A);
      await waitFor(() => expect(nomesNaTabela()).toHaveLength(2));

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 03' }));
      const d = dialogoEdicao();
      await usuario.selectOptions(d.tutor, 'Tutora Fictícia Dois');
      await usuario.click(d.salvar);

      const msg = await screen.findByText(/Estudante Estudante Fictício 03 atualizado com sucesso\./);
      expect(msg.textContent).not.toMatch(/filtro atual/);
      expect(nomesNaTabela()).toEqual(['Estudante Fictício 01', 'Estudante Fictício 03']);
      expect(screen.getByRole('button', { name: 'Editar Estudante Fictício 03' })).toHaveFocus();
    });

    it('trocar o filtro limpa a mensagem de confirmação anterior', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(9, corpo)) });
      await abrirPagina();
      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrado com sucesso/);

      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_7B);
      expect(screen.queryByText(/cadastrado com sucesso/)).not.toBeInTheDocument();
    });
  });

  describe('falha de GET /usuarios (d)', () => {
    it('403 em /usuarios: lista carrega, cadastro mostra aviso e "Tentar novamente"', async () => {
      mockarApi({ usuarios: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      renderizarApp('/estudantes');

      await screen.findByRole('table');
      const cadastro = screen.getByRole('region', { name: 'Cadastrar estudante' });
      const alerta = await within(cadastro).findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
      expect(within(alerta).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
      expect(within(cadastro).queryByLabelText('Nome completo')).not.toBeInTheDocument();
      expect(nomesNaTabela()).toHaveLength(3);
    });

    it('comportamento atual: com /usuarios falhando, o filtro por turma também some (turmas descartadas)', async () => {
      mockarApi({ usuarios: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }) });
      renderizarApp('/estudantes');
      await screen.findByRole('table');
      await within(screen.getByRole('region', { name: 'Cadastrar estudante' })).findByRole('alert');

      // Achado não bloqueante: GET /turmas respondeu 200, mas o Promise.all
      // descarta as turmas e o filtro não aparece.
      expect(screen.queryByLabelText('Filtrar por turma')).not.toBeInTheDocument();
    });

    it('com /usuarios falhando, a edição mantém turma e tutor atuais (bloqueado) e envia os 4 campos', async () => {
      mockarApi({
        usuarios: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }),
        aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)),
      });
      renderizarApp('/estudantes');
      await screen.findByRole('table');
      await within(screen.getByRole('region', { name: 'Cadastrar estudante' })).findByRole('alert');

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 02' }));
      const d = dialogoEdicao();
      expect(d.turma).toHaveValue('2');
      expect(d.tutor).toHaveValue('11');
      expect(textosDasOpcoes(d.tutor)).toEqual(['Sem tutor', 'Tutora Fictícia Bloqueada (bloqueado)']);

      await usuario.type(d.nome, ' B');
      await usuario.click(d.salvar);
      await screen.findByText(/atualizado com sucesso/);
      expect(JSON.parse(chamadas('PUT')[0][1].body)).toEqual({
        nomeCompleto: 'Estudante Fictício 02 B',
        codigoEscolar: null,
        turmaId: 2,
        tutorId: 11,
      });
    });

    it('após falha, "Tentar novamente" recarrega turmas e tutores e mostra o filtro', async () => {
      let tentativa = 0;
      mockarApi({
        usuarios: () => {
          tentativa += 1;
          return tentativa === 1 ? respostaFalsa(500, {}) : respostaFalsa(200, USUARIOS);
        },
      });
      renderizarApp('/estudantes');
      const cadastro = screen.getByRole('region', { name: 'Cadastrar estudante' });
      const alerta = await within(cadastro).findByRole('alert');
      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));

      expect(await screen.findByLabelText('Filtrar por turma')).toBeInTheDocument();
      expect(textosDasOpcoes(formularioCadastro().tutor)).toEqual([
        'Sem tutor',
        'Tutor Fictício Ativo',
        'Tutora Fictícia Dois',
      ]);
    });
  });

  describe('tutor bloqueado na edição (b, RN13)', () => {
    it('desvincular o tutor bloqueado ("Sem tutor") envia tutorId null', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 02' }));
      const d = dialogoEdicao();

      await usuario.selectOptions(d.tutor, 'Sem tutor');
      await usuario.click(d.salvar);
      await screen.findByText(/atualizado com sucesso/);

      const corpo = JSON.parse(chamadas('PUT')[0][1].body);
      expect(corpo).toEqual({
        nomeCompleto: 'Estudante Fictício 02',
        codigoEscolar: null,
        turmaId: 2,
        tutorId: null,
      });
      expect(Object.keys(corpo).sort()).toEqual(['codigoEscolar', 'nomeCompleto', 'turmaId', 'tutorId']);
    });

    it('trocar para ativo e voltar ao bloqueado conta como "sem alteração"', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 02' }));
      const d = dialogoEdicao();

      await usuario.selectOptions(d.tutor, 'Tutor Fictício Ativo');
      await usuario.selectOptions(d.tutor, 'Tutora Fictícia Bloqueada (bloqueado)');
      await usuario.click(d.salvar);

      expect(within(d.dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('a opção do tutor bloqueado mostrada na edição não vaza para o seletor do cadastro', async () => {
      mockarApi();
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 02' }));
      await usuario.click(
        within(dialogoEdicao().dialogo).getByRole('button', { name: 'Cancelar' }),
      );

      expect(textosDasOpcoes(formularioCadastro().tutor)).toEqual([
        'Sem tutor',
        'Tutor Fictício Ativo',
        'Tutora Fictícia Dois',
      ]);
    });
  });

  describe('payload e envio (a)', () => {
    it('POST: turmaId e tutorId são number e o corpo tem exatamente os 4 campos', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(9, corpo)) });
      await abrirPagina();
      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_7B);
      await usuario.selectOptions(c.tutor, 'Tutor Fictício Ativo');
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrado com sucesso/);

      const [[url, opcoes]] = chamadas('POST');
      expect(url).toBe(`${URL_API}/estudantes`);
      expect(opcoes.headers['Content-Type']).toBe('application/json');
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
      const corpo = JSON.parse(opcoes.body);
      expect(Object.keys(corpo).sort()).toEqual(['codigoEscolar', 'nomeCompleto', 'turmaId', 'tutorId']);
      expect(typeof corpo.turmaId).toBe('number');
      expect(typeof corpo.tutorId).toBe('number');
      expect(corpo.codigoEscolar).toBeNull();
    });

    it('PUT: corpo com os 4 campos mesmo quando só o nome muda (sem tutor e sem código)', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 03' }));
      const d = dialogoEdicao();
      await usuario.clear(d.codigo);
      await usuario.type(d.nome, ' X');
      await usuario.click(d.salvar);
      await screen.findByText(/atualizado com sucesso/);

      const corpo = JSON.parse(chamadas('PUT')[0][1].body);
      expect(corpo).toEqual({
        nomeCompleto: 'Estudante Fictício 03 X',
        codigoEscolar: null,
        turmaId: 1,
        tutorId: null,
      });
      expect('tutorId' in corpo && 'codigoEscolar' in corpo).toBe(true);
    });

    it('só espaços acrescentados ao nome contam como "sem alteração"', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 01' }));
      const d = dialogoEdicao();
      await usuario.type(d.nome, '   ');
      await usuario.click(d.salvar);

      expect(within(d.dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('duplo envio no cadastro gera um único POST', async () => {
      const pendente = adiada();
      mockarApi({ aoCriar: () => pendente.promessa });
      await abrirPagina();
      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_6A);

      fireEvent.submit(c.cadastrar.closest('form'));
      fireEvent.submit(c.cadastrar.closest('form'));
      await usuario.click(c.cadastrar);
      expect(chamadas('POST')).toHaveLength(1);
      expect(c.cadastrar).toHaveTextContent('Cadastrando...');

      pendente.resolver(
        respostaFalsa(201, respostaDoCorpo(9, { nomeCompleto: 'Estudante Fictício 00', codigoEscolar: null, turmaId: 1, tutorId: null })),
      );
      await screen.findByText(/cadastrado com sucesso/);
      expect(chamadas('POST')).toHaveLength(1);
    });

    it('duplo envio na edição gera um único PUT e "Cancelar"/Esc não fecham durante o envio', async () => {
      const pendente = adiada();
      mockarApi({ aoAtualizar: () => pendente.promessa });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 01' }));
      const d = dialogoEdicao();
      await usuario.type(d.nome, ' X');

      fireEvent.submit(d.salvar.closest('form'));
      fireEvent.submit(d.salvar.closest('form'));
      expect(chamadas('PUT')).toHaveLength(1);
      await usuario.click(within(d.dialogo).getByRole('button', { name: 'Cancelar' }));
      await usuario.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Editar estudante' })).toBeInTheDocument();

      pendente.resolver(
        respostaFalsa(200, respostaDoCorpo(1, { nomeCompleto: 'Estudante Fictício 01 X', codigoEscolar: 'QA-0001', turmaId: 1, tutorId: 10 })),
      );
      await screen.findByText(/atualizado com sucesso/);
      expect(chamadas('PUT')).toHaveLength(1);
    });

    it('500 no cadastro mostra mensagem genérica sem detalhes técnicos', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }) });
      await abrirPagina();
      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível cadastrar o estudante agora. Tente novamente em instantes.',
      );
      expect(alerta.textContent).not.toMatch(/500|interno/i);
    });

    it('409 de código repetido na edição: só o 409 não-concorrente marca o campo', async () => {
      mockarApi({
        aoAtualizar: () => respostaFalsa(409, {
          erro: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
          codigo: 'CODIGO_ESCOLAR_DUPLICADO',
        }),
      });
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 03' }));
      const d = dialogoEdicao();
      await usuario.clear(d.codigo);
      await usuario.type(d.codigo, 'QA-0001');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(
        MENSAGEM_CODIGO_ESCOLAR_DUPLICADO,
      );
      expect(d.codigo).toHaveAttribute('aria-invalid', 'true');
      expect(d.codigo).toHaveValue('QA-0001');
    });
  });

  describe('privacidade (e, RN05/LGPD)', () => {
    it('nenhum dado de estudante vai para localStorage, sessionStorage ou console', async () => {
      const espias = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      mockarApi({
        aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(9, corpo)),
        aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)),
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício Privado');
      await usuario.type(c.codigo, 'QA-PRIV-9');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrado com sucesso/);

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 01' }));
      const d = dialogoEdicao();
      await usuario.type(d.nome, ' Y');
      await usuario.click(d.salvar);
      await screen.findByText(/atualizado com sucesso/);

      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_7B);
      await waitFor(() => expect(nomesNaTabela()).toEqual(['Estudante Fictício 02']));

      const conteudoStorage = [localStorage, sessionStorage]
        .flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`))
        .join('\n');
      expect(conteudoStorage).not.toMatch(/Estudante Fictício|QA-0001|QA-PRIV-9|turmaId/);
      expect(Object.keys(localStorage)).toEqual([]);
      expect(Object.keys(sessionStorage)).toEqual(['sisto.sessao']);

      const saidaConsole = espias
        .flatMap((e) => e.mock.calls)
        .map((args) => args.map(String).join(' '))
        .join('\n');
      expect(saidaConsole).not.toMatch(/Estudante Fictício|QA-0001|QA-PRIV-9/);
    });
  });

  describe('responsividade (RNF01) — marcação usada pelo CSS de cartões', () => {
    it('todas as células têm data-rotulo e a tabela usa a classe responsiva', async () => {
      mockarApi();
      await abrirPagina();
      const tabela = screen.getByRole('table');
      expect(tabela).toHaveClass('tabela-usuarios', 'tabela-estudantes');
      const celulas = within(tabela).getAllByRole('cell');
      expect(celulas).toHaveLength(ESTUDANTES.length * 5);
      for (const celula of celulas) {
        expect(celula.getAttribute('data-rotulo')).toBeTruthy();
      }
    });
  });
});

describe('services/mensagensEstudantes e services/estudantes — funções puras', () => {
  it('idParaEnvio aceita só inteiros positivos em texto', () => {
    expect(idParaEnvio('1')).toBe(1);
    expect(idParaEnvio(' 12 ')).toBe(12);
    for (const valor of ['', '0', '01', '-1', '1.5', '1e3', 'abc', null, undefined]) {
      expect(idParaEnvio(valor)).toBeNull();
    }
  });

  it('codigoParaEnvio: vazio/espaços → null; preserva maiúsculas/minúsculas; NFC', () => {
    expect(codigoParaEnvio('   ')).toBeNull();
    expect(codigoParaEnvio('')).toBeNull();
    expect(codigoParaEnvio(' aBc-1 ')).toBe('aBc-1');
    expect(codigoParaEnvio('José')).toBe('José');
  });

  it('validarEstudante: limites de 150 após trim e turma obrigatória', () => {
    const ok = validarEstudante({ nomeCompleto: `  ${'a'.repeat(150)}  `, codigoEscolar: 'b'.repeat(150), turmaId: '1' });
    expect(ok).toEqual({});
    const erros = validarEstudante({ nomeCompleto: 'a'.repeat(151), codigoEscolar: 'b'.repeat(151), turmaId: '' });
    expect(Object.keys(erros).sort()).toEqual(['codigoEscolar', 'nomeCompleto', 'turmaId']);
    expect(validarEstudante({ nomeCompleto: '   ', codigoEscolar: '', turmaId: '2' })).toEqual({
      nomeCompleto: 'Informe o nome completo do estudante.',
    });
  });

  it('409: duplicidade x alteração simultânea', () => {
    expect(ehCodigoDuplicado({ status: 409, message: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO })).toBe(true);
    expect(ehCodigoDuplicado({ status: 409, message: MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE })).toBe(false);
    expect(ehCodigoDuplicado({ status: 400, message: 'x' })).toBe(false);
    expect(listaPodeEstarDesatualizada({ status: 409, message: MENSAGEM_ALTERACAO_SIMULTANEA_ESTUDANTE })).toBe(true);
    expect(listaPodeEstarDesatualizada({ status: 404 })).toBe(true);
    expect(listaPodeEstarDesatualizada({ status: 409, message: MENSAGEM_CODIGO_ESCOLAR_DUPLICADO })).toBe(false);
  });

  it('mensagemErroEstudante: 403, sem conexão, servidor e genéricas', () => {
    expect(mensagemErroEstudante({ status: 403, message: 'qualquer', doServidor: true }, 'criar')).toBe(MSG_SEM_PERMISSAO);
    expect(mensagemErroEstudante({ status: 0 }, 'editar')).toBe(MSG_SEM_CONEXAO);
    expect(mensagemErroEstudante({ status: 400, message: 'Msg do servidor.', doServidor: true }, 'criar')).toBe('Msg do servidor.');
    expect(mensagemErroEstudante({ status: 404 }, 'editar')).toMatch(/Estudante não encontrado/);
    expect(mensagemErroEstudante({ status: 500, message: 'stack', doServidor: true }, 'editar')).toBe(
      'Não foi possível salvar a alteração agora. Tente novamente em instantes.',
    );
  });

  it('sinalização do tutor (RN13)', () => {
    expect(sinalizacaoTutor({ status: 'ATIVO' })).toBe('');
    expect(sinalizacaoTutor({ status: 'BLOQUEADO' })).toBe('bloqueado');
    expect(sinalizacaoTutor({ status: 'DESATIVADO' })).toBe('desativado');
    expect(sinalizacaoTutor(null)).toBe('');
    expect(rotuloOpcaoTutor({ nome: 'Tutor Fictício', status: 'DESATIVADO' })).toBe('Tutor Fictício (desativado)');
    expect(rotuloOpcaoTutor({ nome: 'Tutor Fictício', status: 'ATIVO' })).toBe('Tutor Fictício');
  });

  describe('services/estudantes', () => {
    beforeEach(() => {
      sessionStorage.clear();
      vi.stubEnv('VITE_API_URL', URL_API);
      vi.stubGlobal('fetch', vi.fn(async () => respostaFalsa(200, {})));
      gravarSessaoFicticia();
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('criar/atualizar completam codigoEscolar e tutorId ausentes com null', async () => {
      const { criarEstudante, atualizarEstudante } = await import('../src/services/estudantes.js');
      await criarEstudante({ nomeCompleto: 'Estudante Fictício', turmaId: 1 });
      await atualizarEstudante(7, { nomeCompleto: 'Estudante Fictício', turmaId: 2 });
      const [[, post], [urlPut, put]] = fetch.mock.calls;
      expect(JSON.parse(post.body)).toEqual({ nomeCompleto: 'Estudante Fictício', codigoEscolar: null, turmaId: 1, tutorId: null });
      expect(urlPut).toBe(`${URL_API}/estudantes/7`);
      expect(put.method).toBe('PUT');
      expect(JSON.parse(put.body)).toEqual({ nomeCompleto: 'Estudante Fictício', codigoEscolar: null, turmaId: 2, tutorId: null });
    });

    it('listarEstudantes monta ?turmaId= e devolve [] se a resposta não for lista', async () => {
      const { listarEstudantes } = await import('../src/services/estudantes.js');
      expect(await listarEstudantes({ turmaId: 3 })).toEqual([]);
      await listarEstudantes();
      await listarEstudantes({ turmaId: '' });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        `${URL_API}/estudantes?turmaId=3`,
        `${URL_API}/estudantes`,
        `${URL_API}/estudantes`,
      ]);
    });
  });
});
