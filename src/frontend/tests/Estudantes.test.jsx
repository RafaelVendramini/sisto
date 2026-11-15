// Fluxos da Issue #43 — tela de estudantes com vínculo ao professor tutor:
// acesso por perfil, lista com turma e tutor (tutor bloqueado/desativado
// sinalizado), filtro por turma, cadastro, edição, troca de turma,
// desvínculo do tutor e mensagens de erro (API mockada, sem rede).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
// Textos do contrato do back-end (Issue #42).
const MSG_CODIGO_DUPLICADO = 'Já existe um estudante cadastrado com este código escolar.';
const MSG_CONCORRENCIA =
  'O estudante foi alterado por outra operação ao mesmo tempo. Tente novamente.';
const MSG_TUTOR_INVALIDO =
  'O tutor informado precisa ser um usuário com perfil Tutor e status ativo.';
const MSG_TURMA_INEXISTENTE = 'A turma informada não existe.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_6A = { id: 1, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_7B = { id: 2, nome: '7º B', etapa: ETAPA, anoLetivo: 2026 };
const ROTULO_6A = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_7B = '7º B — Ensino Fundamental - Anos Finais (2026)';
const TURMAS_FICTICIAS = [TURMA_6A, TURMA_7B];

const USUARIOS_FICTICIOS = [
  { id: 1, nome: 'Gestora Fictícia', email: 'gestora@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 13, nome: 'Professor Fictício', email: 'prof@exemplo.test', perfil: 'PROFESSOR', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício Ativo', email: 'tutor1@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
  { id: 11, nome: 'Tutora Fictícia Bloqueada', email: 'tutor2@exemplo.test', perfil: 'TUTOR', status: 'BLOQUEADO' },
  { id: 12, nome: 'Tutor Fictício Desativado', email: 'tutor3@exemplo.test', perfil: 'TUTOR', status: 'DESATIVADO' },
  { id: 14, nome: 'Tutora Fictícia Dois', email: 'tutor4@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];

function tutor(id) {
  const { nome, email, status } = USUARIOS_FICTICIOS.find((u) => u.id === id);
  return { id, nome, email, status };
}

// Já na ordem do GET /estudantes (por nome).
const ESTUDANTES_FICTICIOS = [
  { id: 1, nomeCompleto: 'Estudante Fictício 01', codigoEscolar: 'TESTE-0001', turma: TURMA_6A, tutor: tutor(10) },
  { id: 2, nomeCompleto: 'Estudante Fictício 02', codigoEscolar: null, turma: TURMA_7B, tutor: tutor(11) },
  { id: 3, nomeCompleto: 'Estudante Fictício 03', codigoEscolar: 'TESTE-0003', turma: TURMA_6A, tutor: tutor(12) },
  { id: 4, nomeCompleto: 'Estudante Fictício 04', codigoEscolar: null, turma: TURMA_7B, tutor: null },
];

/** Monta a resposta do POST/PUT a partir do corpo enviado (como o back-end faz). */
function respostaDoCorpo(id, corpo) {
  return {
    id,
    nomeCompleto: corpo.nomeCompleto,
    codigoEscolar: corpo.codigoEscolar,
    turma: TURMAS_FICTICIAS.find((t) => t.id === corpo.turmaId),
    tutor: corpo.tutorId == null ? null : tutor(corpo.tutorId),
  };
}

/**
 * GET /turmas, GET /usuarios e GET /estudantes[?turmaId=] respondem com os
 * dados fictícios; POST /estudantes chama `aoCriar(corpo)`; PUT chama
 * `aoAtualizar(id, corpo)`. `estudantes` pode ser função (chamada a cada GET).
 */
function mockarApi({
  estudantes = ESTUDANTES_FICTICIOS,
  turmas = () => respostaFalsa(200, TURMAS_FICTICIAS),
  aoCriar,
  aoAtualizar,
} = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) return turmas();
    if (opcoes.method === 'GET' && url === `${URL_API}/usuarios`) {
      return respostaFalsa(200, USUARIOS_FICTICIOS);
    }
    const get = url.match(/\/estudantes(?:\?turmaId=(\d+))?$/);
    if (opcoes.method === 'GET' && get) {
      if (typeof estudantes === 'function') return estudantes(get[1]);
      const lista = get[1]
        ? estudantes.filter((e) => e.turma.id === Number(get[1]))
        : estudantes;
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

function getsDeEstudantes() {
  return chamadas('GET')
    .map(([url]) => url)
    .filter((url) => url.startsWith(`${URL_API}/estudantes`));
}

/** Linhas da tabela como texto "nome | código | turma | tutor". */
function linhasNaTabela() {
  const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return linhas.map((linha) =>
    within(linha)
      .getAllByRole('cell')
      .slice(0, 4)
      .map((celula) => celula.textContent)
      .join(' | '),
  );
}

function nomesNaTabela() {
  return linhasNaTabela().map((linha) => linha.split(' | ')[0]);
}

async function abrirPagina() {
  renderizarApp('/estudantes');
  await screen.findByRole('table');
  // Espera o formulário (turmas e tutores carregados).
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

function textosDasOpcoes(select) {
  return within(select)
    .getAllByRole('option')
    .map((opcao) => opcao.textContent);
}

describe('Tela de estudantes (#43)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('acesso por perfil (RN01, matriz da Seção 4)', () => {
    it('Gestão vê "Estudantes" no menu, na ordem combinada, e chega à página', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Início',
        'Ocorrências',
        'Registrar ocorrência',
        'Usuários',
        'Turmas',
        'Estudantes',
        'Categorias',
        'Relatórios',
      ]);
      await usuario.click(within(menu).getByRole('link', { name: 'Estudantes' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Estudantes' })).toBeInTheDocument();
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      '%s não vê o item de menu nem a página, e a API não é chamada',
      (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        renderizarApp('/estudantes');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        expect(within(menu).queryByRole('link', { name: 'Estudantes' })).not.toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Nome completo')).not.toBeInTheDocument();
        expect(fetch).not.toHaveBeenCalled();
      },
    );
  });

  describe('listagem', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('mostra nome, código, turma e tutor, com "Editar" e sem botão de excluir (RN21)', async () => {
      mockarApi();
      await abrirPagina();

      const tabela = screen.getByRole('table');
      expect(within(tabela).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
        'Nome completo',
        'Código escolar',
        'Turma',
        'Tutor',
        'Ações',
      ]);
      expect(linhasNaTabela()).toEqual([
        `Estudante Fictício 01 | TESTE-0001 | ${ROTULO_6A} | Tutor Fictício Ativo`,
        `Estudante Fictício 02 | Não informado | ${ROTULO_7B} | Tutora Fictícia Bloqueada Tutor bloqueado`,
        `Estudante Fictício 03 | TESTE-0003 | ${ROTULO_6A} | Tutor Fictício Desativado Tutor desativado`,
        `Estudante Fictício 04 | Não informado | ${ROTULO_7B} | Sem tutor`,
      ]);
      expect(
        within(tabela).getByRole('button', { name: 'Editar Estudante Fictício 01' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /excluir|remover|apagar/i }),
      ).not.toBeInTheDocument();
      expect(getsDeEstudantes()).toEqual([`${URL_API}/estudantes`]);
    });

    it('sinaliza o tutor bloqueado ou desativado (RN13), mas não o ativo', async () => {
      mockarApi();
      await abrirPagina();

      const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
      expect(within(linhas[0]).queryByText(/Tutor (bloqueado|desativado)/)).not.toBeInTheDocument();
      expect(within(linhas[1]).getByText('Tutor bloqueado')).toHaveClass('selo', 'selo--bloqueado');
      expect(within(linhas[2]).getByText('Tutor desativado')).toHaveClass(
        'selo',
        'selo--desativado',
      );
    });

    it('mostra aviso de lista vazia', async () => {
      mockarApi({ estudantes: [] });
      renderizarApp('/estudantes');

      expect(
        await screen.findByText('Nenhum estudante cadastrado até o momento.'),
      ).toBeInTheDocument();
    });

    it('em erro, mostra mensagem amigável e "Tentar novamente" recarrega a lista', async () => {
      let tentativa = 0;
      mockarApi({
        estudantes: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(500, { erro: 'Erro interno do servidor.' })
            : respostaFalsa(200, ESTUDANTES_FICTICIOS);
        },
      });
      renderizarApp('/estudantes');

      const secao = screen.getByRole('region', { name: 'Estudantes cadastrados' });
      const alerta = await within(secao).findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar a lista de estudantes agora.');
      expect(alerta.textContent).not.toMatch(/500|interno/i);

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(tentativa).toBe(2);
    });

    it('sem conexão, mostra mensagem fixa amigável', async () => {
      fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      renderizarApp('/estudantes');

      const secao = screen.getByRole('region', { name: 'Estudantes cadastrados' });
      expect(await within(secao).findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      const cadastro = screen.getByRole('region', { name: 'Cadastrar estudante' });
      expect(await within(cadastro).findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
    });

    it('falha ao carregar turmas e tutores mostra aviso no cadastro e "Tentar novamente" recarrega', async () => {
      let tentativa = 0;
      mockarApi({
        turmas: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(500, { erro: 'Erro interno do servidor.' })
            : respostaFalsa(200, TURMAS_FICTICIAS);
        },
      });
      renderizarApp('/estudantes');

      const cadastro = screen.getByRole('region', { name: 'Cadastrar estudante' });
      const alerta = await within(cadastro).findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar as turmas e os tutores agora.');

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      expect(
        await within(cadastro).findByRole('button', { name: 'Cadastrar estudante' }),
      ).toBeInTheDocument();
    });

    it('sem turmas cadastradas, orienta a cadastrar uma turma antes', async () => {
      mockarApi({ estudantes: [], turmas: () => respostaFalsa(200, []) });
      renderizarApp('/estudantes');

      const cadastro = screen.getByRole('region', { name: 'Cadastrar estudante' });
      expect(await within(cadastro).findByText(/Nenhuma turma cadastrada/)).toBeInTheDocument();
      expect(within(cadastro).getByRole('link', { name: 'Turmas' })).toHaveAttribute(
        'href',
        '/turmas',
      );
      expect(within(cadastro).queryByLabelText('Nome completo')).not.toBeInTheDocument();
    });
  });

  describe('filtro por turma', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('lista as turmas com etapa e ano, filtra com ?turmaId= e volta a "Todas as turmas"', async () => {
      mockarApi();
      await abrirPagina();

      const filtro = screen.getByLabelText('Filtrar por turma');
      expect(textosDasOpcoes(filtro)).toEqual(['Todas as turmas', ROTULO_6A, ROTULO_7B]);

      await usuario.selectOptions(filtro, ROTULO_6A);
      await waitFor(() =>
        expect(nomesNaTabela()).toEqual(['Estudante Fictício 01', 'Estudante Fictício 03']),
      );
      expect(getsDeEstudantes().at(-1)).toBe(`${URL_API}/estudantes?turmaId=1`);

      await usuario.selectOptions(filtro, 'Todas as turmas');
      await waitFor(() => expect(nomesNaTabela()).toHaveLength(4));
      expect(getsDeEstudantes().at(-1)).toBe(`${URL_API}/estudantes`);
    });

    it('turma sem estudantes mostra aviso próprio', async () => {
      mockarApi({
        estudantes: (turmaId) =>
          respostaFalsa(200, turmaId ? [] : ESTUDANTES_FICTICIOS),
      });
      await abrirPagina();

      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_7B);
      expect(
        await screen.findByText('Nenhum estudante cadastrado nesta turma.'),
      ).toBeInTheDocument();
    });
  });

  describe('cadastro', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('o seletor de tutor lista só tutores ativos, com "Sem tutor" (RN13)', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      expect(textosDasOpcoes(c.tutor)).toEqual([
        'Sem tutor',
        'Tutor Fictício Ativo',
        'Tutora Fictícia Dois',
      ]);
      expect(c.tutor).toHaveValue('');
      expect(textosDasOpcoes(c.turma)).toEqual(['Selecione a turma', ROTULO_6A, ROTULO_7B]);
    });

    it('cria o estudante com ids numéricos, insere na lista em ordem e confirma, sem novo GET', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(5, corpo)) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '  Estudante Fictício 00  ');
      await usuario.type(c.codigo, ' Teste-0005 ');
      await usuario.selectOptions(c.turma, ROTULO_7B);
      await usuario.selectOptions(c.tutor, 'Tutora Fictícia Dois');
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByText('Estudante Estudante Fictício 00 cadastrado com sucesso.'),
      ).toBeInTheDocument();
      expect(nomesNaTabela()).toEqual([
        'Estudante Fictício 00',
        'Estudante Fictício 01',
        'Estudante Fictício 02',
        'Estudante Fictício 03',
        'Estudante Fictício 04',
      ]);
      expect(linhasNaTabela()[0]).toBe(
        `Estudante Fictício 00 | Teste-0005 | ${ROTULO_7B} | Tutora Fictícia Dois`,
      );

      const [[, opcoes]] = chamadas('POST');
      // Código escolar sem espaços nas pontas e SEM mudar maiúsculas/minúsculas.
      expect(JSON.parse(opcoes.body)).toEqual({
        nomeCompleto: 'Estudante Fictício 00',
        codigoEscolar: 'Teste-0005',
        turmaId: 2,
        tutorId: 14,
      });
      expect(getsDeEstudantes()).toHaveLength(1);
      expect(c.nome).toHaveValue('');
      expect(c.codigo).toHaveValue('');
      expect(c.turma).toHaveValue('');
      expect(c.tutor).toHaveValue('');
      expect(c.nome).toHaveFocus();
    });

    it('sem código e "Sem tutor" envia codigoEscolar e tutorId como null', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(5, corpo)) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 05');
      await usuario.type(c.codigo, '   ');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByText('Estudante Estudante Fictício 05 cadastrado com sucesso.'),
      ).toBeInTheDocument();
      const [[, opcoes]] = chamadas('POST');
      expect(JSON.parse(opcoes.body)).toEqual({
        nomeCompleto: 'Estudante Fictício 05',
        codigoEscolar: null,
        turmaId: 1,
        tutorId: null,
      });
      expect(linhasNaTabela().at(-1)).toBe(
        `Estudante Fictício 05 | Não informado | ${ROTULO_6A} | Sem tutor`,
      );
    });

    it('com filtro em outra turma, o estudante criado não entra na lista e a mensagem explica', async () => {
      mockarApi({ aoCriar: (corpo) => respostaFalsa(201, respostaDoCorpo(5, corpo)) });
      await abrirPagina();
      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_6A);
      await waitFor(() => expect(nomesNaTabela()).toHaveLength(2));

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 00');
      await usuario.selectOptions(c.turma, ROTULO_7B);
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByText(
          `Estudante Estudante Fictício 00 cadastrado com sucesso. Ele está na turma ${ROTULO_7B} e não aparece com o filtro atual.`,
        ),
      ).toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Estudante Fictício 01', 'Estudante Fictício 03']);
    });

    it('campos obrigatórios vazios mostram erro, focam o primeiro e não chamam a API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.click(c.cadastrar);

      expect(screen.getByText('Informe o nome completo do estudante.')).toBeInTheDocument();
      expect(screen.getByText('Selecione a turma do estudante.')).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');
      expect(c.turma).toHaveAttribute('aria-invalid', 'true');
      expect(c.codigo).toHaveAttribute('aria-invalid', 'false');
      expect(c.nome).toHaveFocus();
      expect(chamadas('POST')).toHaveLength(0);

      // O erro de cada campo some só quando aquele campo é alterado.
      await usuario.type(c.nome, 'E');
      expect(screen.queryByText('Informe o nome completo do estudante.')).not.toBeInTheDocument();
      expect(screen.getByText('Selecione a turma do estudante.')).toBeInTheDocument();
      await usuario.selectOptions(c.turma, ROTULO_6A);
      expect(screen.queryByText('Selecione a turma do estudante.')).not.toBeInTheDocument();
      expect(c.turma).toHaveAttribute('aria-invalid', 'false');
    });

    it('limita nome e código aos tamanhos aceitos pela API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      expect(c.nome).toHaveAttribute('maxLength', '150');
      expect(c.codigo).toHaveAttribute('maxLength', '150');
    });

    it('409 de código repetido marca o campo "Código escolar" e o aviso some ao alterá-lo', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(409, { erro: MSG_CODIGO_DUPLICADO }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 06');
      await usuario.type(c.codigo, 'TESTE-0001');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_CODIGO_DUPLICADO);
      expect(c.codigo).toHaveAttribute('aria-invalid', 'true');
      expect(c.codigo.getAttribute('aria-describedby')).toContain('estudante-conflito');
      expect(c.nome).toHaveAttribute('aria-invalid', 'false');
      expect(c.codigo).toHaveFocus();
      expect(c.nome).toHaveValue('Estudante Fictício 06');
      expect(nomesNaTabela()).toHaveLength(4);

      await usuario.type(c.codigo, 'X');
      expect(screen.queryByText(MSG_CODIGO_DUPLICADO)).not.toBeInTheDocument();
      expect(c.codigo).toHaveAttribute('aria-invalid', 'false');
    });

    it('400 (ex.: tutor deixou de ser ativo) mostra a mensagem do servidor', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(400, { erro: MSG_TUTOR_INVALIDO }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 06');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.selectOptions(c.tutor, 'Tutor Fictício Ativo');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_TUTOR_INVALIDO);
    });

    it('403 mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 06');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão ao cadastrar mostra mensagem amigável e mantém o que foi digitado', async () => {
      mockarApi({
        aoCriar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, 'Estudante Fictício 06');
      await usuario.type(c.codigo, 'TESTE-0006');
      await usuario.selectOptions(c.turma, ROTULO_6A);
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(c.nome).toHaveValue('Estudante Fictício 06');
      expect(c.codigo).toHaveValue('TESTE-0006');
      expect(c.turma).toHaveValue('1');
    });
  });

  describe('edição', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    async function abrirEdicao(nome) {
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: `Editar ${nome}` }));
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

    function corpoDoPut() {
      const [[, opcoes]] = chamadas('PUT');
      return JSON.parse(opcoes.body);
    }

    it('abre pré-preenchido e salvar envia os quatro campos, atualizando a lista sem novo GET', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 01');

      expect(d.nome).toHaveValue('Estudante Fictício 01');
      expect(d.codigo).toHaveValue('TESTE-0001');
      expect(d.turma).toHaveValue('1');
      expect(d.tutor).toHaveValue('10');
      expect(d.nome).toHaveFocus();

      await usuario.clear(d.nome);
      await usuario.type(d.nome, 'Estudante Fictício 09');
      await usuario.click(d.salvar);

      expect(
        await screen.findByText('Estudante Estudante Fictício 09 atualizado com sucesso.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(corpoDoPut()).toEqual({
        nomeCompleto: 'Estudante Fictício 09',
        codigoEscolar: 'TESTE-0001',
        turmaId: 1,
        tutorId: 10,
      });
      expect(chamadas('PUT')[0][0]).toBe(`${URL_API}/estudantes/1`);
      // Reordenado por nome.
      expect(nomesNaTabela().at(-1)).toBe('Estudante Fictício 09');
      expect(getsDeEstudantes()).toHaveLength(1);
    });

    it('tutor atual bloqueado aparece selecionado e sinalizado; os outros são só ativos', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 02');

      expect(textosDasOpcoes(d.tutor)).toEqual([
        'Sem tutor',
        'Tutora Fictícia Bloqueada (bloqueado)',
        'Tutor Fictício Ativo',
        'Tutora Fictícia Dois',
      ]);
      expect(d.tutor).toHaveValue('11');
      expect(textosDasOpcoes(d.tutor)).not.toContain('Tutor Fictício Desativado (desativado)');

      // Salvar outro campo não desvincula o tutor sem querer: reenvia o mesmo tutor.
      await usuario.type(d.codigo, 'TESTE-0002');
      await usuario.click(d.salvar);
      await screen.findByText('Estudante Estudante Fictício 02 atualizado com sucesso.');
      expect(corpoDoPut()).toEqual({
        nomeCompleto: 'Estudante Fictício 02',
        codigoEscolar: 'TESTE-0002',
        turmaId: 2,
        tutorId: 11,
      });
    });

    it('tutor atual desativado também aparece sinalizado no seletor', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const d = await abrirEdicao('Estudante Fictício 03');

      expect(d.tutor).toHaveValue('12');
      expect(within(d.tutor).getByRole('option', { selected: true })).toHaveTextContent(
        'Tutor Fictício Desativado (desativado)',
      );
    });

    it('troca o tutor bloqueado por um ativo', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.selectOptions(d.tutor, 'Tutor Fictício Ativo');
      await usuario.click(d.salvar);

      await screen.findByText('Estudante Estudante Fictício 02 atualizado com sucesso.');
      expect(corpoDoPut().tutorId).toBe(10);
      expect(linhasNaTabela()[1]).toBe(
        `Estudante Fictício 02 | Não informado | ${ROTULO_7B} | Tutor Fictício Ativo`,
      );
    });

    it('"Sem tutor" desvincula: envia tutorId null', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 01');

      await usuario.selectOptions(d.tutor, 'Sem tutor');
      await usuario.click(d.salvar);

      await screen.findByText('Estudante Estudante Fictício 01 atualizado com sucesso.');
      expect(corpoDoPut()).toEqual({
        nomeCompleto: 'Estudante Fictício 01',
        codigoEscolar: 'TESTE-0001',
        turmaId: 1,
        tutorId: null,
      });
      expect(linhasNaTabela()[0]).toBe(
        `Estudante Fictício 01 | TESTE-0001 | ${ROTULO_6A} | Sem tutor`,
      );
    });

    it('apagar o código escolar envia codigoEscolar null', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 01');

      await usuario.clear(d.codigo);
      await usuario.click(d.salvar);

      await screen.findByText('Estudante Estudante Fictício 01 atualizado com sucesso.');
      expect(corpoDoPut()).toEqual({
        nomeCompleto: 'Estudante Fictício 01',
        codigoEscolar: null,
        turmaId: 1,
        tutorId: 10,
      });
      expect(linhasNaTabela()[0]).toContain('| Não informado |');
    });

    it('mudar só maiúsculas/minúsculas do código conta como alteração e é enviado como digitado', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 01');

      await usuario.clear(d.codigo);
      await usuario.type(d.codigo, 'teste-0001');
      await usuario.click(d.salvar);

      await screen.findByText('Estudante Estudante Fictício 01 atualizado com sucesso.');
      expect(corpoDoPut().codigoEscolar).toBe('teste-0001');
    });

    it('troca de turma sem filtro: envia turmaId numérico e a linha mostra a nova turma', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      const d = await abrirEdicao('Estudante Fictício 01');

      await usuario.selectOptions(d.turma, ROTULO_7B);
      await usuario.click(d.salvar);

      await screen.findByText('Estudante Estudante Fictício 01 atualizado com sucesso.');
      expect(corpoDoPut().turmaId).toBe(2);
      expect(linhasNaTabela()[0]).toBe(
        `Estudante Fictício 01 | TESTE-0001 | ${ROTULO_7B} | Tutor Fictício Ativo`,
      );
    });

    it('troca de turma com filtro ativo: o estudante sai da lista filtrada e o foco vai para o título da lista', async () => {
      mockarApi({ aoAtualizar: (id, corpo) => respostaFalsa(200, respostaDoCorpo(id, corpo)) });
      await abrirPagina();
      await usuario.selectOptions(screen.getByLabelText('Filtrar por turma'), ROTULO_6A);
      await waitFor(() => expect(nomesNaTabela()).toHaveLength(2));

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício 03' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar estudante' });
      await usuario.selectOptions(within(dialogo).getByLabelText('Turma'), ROTULO_7B);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(
        await screen.findByText(
          `Estudante Estudante Fictício 03 atualizado com sucesso. Ele está na turma ${ROTULO_7B} e não aparece com o filtro atual.`,
        ),
      ).toBeInTheDocument();
      expect(nomesNaTabela()).toEqual(['Estudante Fictício 01']);
      expect(screen.getByRole('heading', { name: 'Estudantes cadastrados' })).toHaveFocus();
    });

    it('sem alterações, avisa e não chama a API', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.click(d.salvar);

      expect(within(d.dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('409 de código repetido marca o campo, mantém o diálogo e não recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_CODIGO_DUPLICADO }) });
      const d = await abrirEdicao('Estudante Fictício 04');

      await usuario.type(d.codigo, 'TESTE-0001');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(MSG_CODIGO_DUPLICADO);
      expect(d.codigo).toHaveAttribute('aria-invalid', 'true');
      expect(d.codigo).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'Editar estudante' })).toBeInTheDocument();
      expect(getsDeEstudantes()).toHaveLength(1);
    });

    it('409 de alteração simultânea mostra aviso geral e recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_CONCORRENCIA }) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.type(d.nome, ' A');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA);
      expect(d.codigo).toHaveAttribute('aria-invalid', 'false');
      await waitFor(() => expect(getsDeEstudantes()).toHaveLength(2));
    });

    it('404 mostra a mensagem do servidor e recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(404, { erro: 'Estudante não encontrado.' }) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.type(d.nome, ' A');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(
        'Estudante não encontrado.',
      );
      await waitFor(() => expect(getsDeEstudantes()).toHaveLength(2));
    });

    it('400 na edição mostra a mensagem do servidor', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(400, { erro: MSG_TURMA_INEXISTENTE }) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.selectOptions(d.turma, ROTULO_6A);
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(MSG_TURMA_INEXISTENTE);
    });

    it('403 na edição mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.type(d.nome, ' A');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão na edição mostra mensagem amigável e mantém o diálogo', async () => {
      mockarApi({
        aoAtualizar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      const d = await abrirEdicao('Estudante Fictício 02');

      await usuario.type(d.nome, ' A');
      await usuario.click(d.salvar);

      expect(await within(d.dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(d.nome).toHaveValue('Estudante Fictício 02 A');
    });

    it('"Cancelar" fecha sem salvar e devolve o foco ao botão "Editar"', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const d = await abrirEdicao('Estudante Fictício 04');

      await usuario.type(d.nome, ' alterado');
      await usuario.click(within(d.dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chamadas('PUT')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Editar Estudante Fictício 04' })).toHaveFocus();
    });
  });
});
