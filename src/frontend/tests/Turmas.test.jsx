// Fluxos da Issue #41 — tela de turmas: listagem (com ano letivo), cadastro,
// edição e acesso por perfil (API mockada, sem rede).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHAVE_SESSAO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
// Textos do contrato do back-end (Issue #40).
const MSG_DUPLICADA =
  'Já existe uma turma cadastrada com este nome e esta etapa neste ano letivo.';
const MSG_CONCORRENCIA = 'A turma foi alterada por outra operação ao mesmo tempo. Tente novamente.';
const MSG_ANO_INVALIDO_API = 'Informe anoLetivo como número inteiro de 4 dígitos (ex.: 2026).';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

// Relógio fixo (só o Date): nenhum teste depende da data real (#129).
// 23/11/2026 10:00 em São Paulo.
const AGORA = new Date('2026-11-23T13:00:00.000Z');
const ANO_ATUAL = 2026;

// Já na ordem do GET /turmas: ano desc, etapa, nome.
const TURMAS_FICTICIAS = [
  { id: 3, nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2026 },
  { id: 2, nome: '1º B', etapa: 'Ensino Médio', anoLetivo: 2026 },
  { id: 1, nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2025 },
];

/**
 * GET /turmas devolve `lista` (array ou função chamada a cada GET);
 * POST /turmas chama `aoCriar(corpo)`; PUT /turmas/{id} chama `aoAtualizar(id, corpo)`.
 */
function mockarApi({ lista = TURMAS_FICTICIAS, aoCriar, aoAtualizar } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (url === `${URL_API}/turmas` && opcoes.method === 'GET') {
      return typeof lista === 'function' ? lista() : respostaFalsa(200, lista);
    }
    if (url === `${URL_API}/turmas` && opcoes.method === 'POST' && aoCriar) {
      return aoCriar(JSON.parse(opcoes.body));
    }
    const put = url.match(/\/turmas\/(\d+)$/);
    if (put && opcoes.method === 'PUT' && aoAtualizar) {
      return aoAtualizar(Number(put[1]), JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadas(metodo) {
  return fetch.mock.calls.filter(([, opcoes]) => opcoes?.method === metodo);
}

/** Linhas da tabela como texto "nome | etapa | ano". */
function linhasNaTabela() {
  const linhas = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  return linhas.map((linha) =>
    within(linha)
      .getAllByRole('cell')
      .slice(0, 3)
      .map((celula) => celula.textContent)
      .join(' | '),
  );
}

async function abrirPagina() {
  renderizarApp('/turmas');
  await screen.findByRole('table');
}

function formularioCadastro() {
  const secao = screen.getByRole('region', { name: 'Cadastrar turma' });
  return {
    nome: within(secao).getByLabelText('Nome'),
    etapa: within(secao).getByLabelText('Etapa'),
    ano: within(secao).getByLabelText('Ano letivo'),
    cadastrar: within(secao).getByRole('button', { name: 'Cadastrar turma' }),
  };
}

describe('Tela de turmas (#41)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar fetch/env: nenhuma chamada pendente vaza.
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('acesso por perfil (RN01, matriz da Seção 4)', () => {
    it('Gestão vê o item "Turmas" no menu e chega à página', async () => {
      gravarSessaoFicticia();
      mockarApi();
      renderizarApp('/');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Turmas' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Turmas' })).toBeInTheDocument();
      expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it.each(['PROFESSOR', 'TUTOR', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'])(
      '%s não vê o item de menu nem a página, e a API não é chamada',
      (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        renderizarApp('/turmas');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        expect(within(menu).queryByRole('link', { name: 'Turmas' })).not.toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Ano letivo')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Voltar para o início' })).toHaveAttribute(
          'href',
          '/',
        );
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('sem sessão, /turmas leva ao login', () => {
      renderizarApp('/turmas');

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('listagem', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('exibe nome, etapa, ano letivo e "Editar", sem botão de excluir (RN21)', async () => {
      mockarApi();
      await abrirPagina();

      const tabela = screen.getByRole('table');
      const cabecalhos = within(tabela).getAllByRole('columnheader').map((th) => th.textContent);
      expect(cabecalhos).toEqual(['Nome', 'Etapa', 'Ano letivo', 'Ações']);
      expect(linhasNaTabela()).toEqual([
        '1º A | Ensino Médio | 2026',
        '1º B | Ensino Médio | 2026',
        '1º A | Ensino Médio | 2025',
      ]);
      expect(
        within(tabela).getByRole('button', { name: 'Editar a turma 1º A (Ensino Médio, 2025)' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /excluir|remover|apagar|inativar/i })).not.toBeInTheDocument();

      const [url, opcoes] = fetch.mock.calls[0];
      expect(url).toBe(`${URL_API}/turmas`);
      expect(opcoes.method).toBe('GET');
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('mostra aviso de lista vazia', async () => {
      mockarApi({ lista: [] });
      renderizarApp('/turmas');

      expect(await screen.findByText('Nenhuma turma cadastrada até o momento.')).toBeInTheDocument();
    });

    it('em erro, mostra mensagem amigável e "Tentar novamente" recarrega a lista', async () => {
      let tentativa = 0;
      mockarApi({
        lista: () => {
          tentativa += 1;
          return tentativa === 1
            ? respostaFalsa(500, { erro: 'Erro interno do servidor.' })
            : respostaFalsa(200, TURMAS_FICTICIAS);
        },
      });
      renderizarApp('/turmas');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível carregar a lista de turmas agora.');
      expect(alerta.textContent).not.toMatch(/500|interno/i);

      await usuario.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(tentativa).toBe(2);
    });

    it('sem conexão, mostra mensagem fixa amigável', async () => {
      fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      renderizarApp('/turmas');

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
    });

    it('401 na listagem volta ao login com aviso (fluxo central de sessão)', async () => {
      mockarApi({
        lista: () => respostaFalsa(401, { erro: 'Não autenticado. Faça login novamente.' }),
      });
      renderizarApp('/turmas');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Entrar no Sisto' }),
      ).toBeInTheDocument();
      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    });
  });

  describe('cadastro', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('sugere o ano atual no campo "Ano letivo"', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      expect(c.ano).toHaveValue(ANO_ATUAL);
      expect(c.nome).toHaveValue('');
      expect(c.etapa).toHaveValue('');
    });

    it('em 31/12 às 22h em São Paulo (já 01/01 em UTC), ainda sugere o ano que termina', async () => {
      vi.setSystemTime(new Date('2027-01-01T01:00:00.000Z'));
      gravarSessaoFicticia(); // sessão válida no novo horário
      mockarApi();
      await abrirPagina();

      expect(formularioCadastro().ano).toHaveValue(2026);
    });

    it('a partir de 01/01 à 0h em São Paulo, sugere o ano novo', async () => {
      vi.setSystemTime(new Date('2027-01-01T03:00:00.000Z'));
      gravarSessaoFicticia(); // sessão válida no novo horário
      mockarApi();
      await abrirPagina();

      expect(formularioCadastro().ano).toHaveValue(2027);
    });

    it('cria a turma com ano letivo como número, atualiza a lista em ordem e confirma, sem novo GET', async () => {
      mockarApi({
        aoCriar: (corpo) => respostaFalsa(201, { id: 4, ...corpo }),
      });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '  2º A  ');
      await usuario.type(c.etapa, ' Ensino Médio ');
      await usuario.clear(c.ano);
      await usuario.type(c.ano, '2026');
      await usuario.click(c.cadastrar);

      expect(
        await screen.findByText('Turma 2º A (Ensino Médio, 2026) cadastrada com sucesso.'),
      ).toBeInTheDocument();
      expect(linhasNaTabela()).toEqual([
        '1º A | Ensino Médio | 2026',
        '1º B | Ensino Médio | 2026',
        '2º A | Ensino Médio | 2026',
        '1º A | Ensino Médio | 2025',
      ]);

      const [[, opcoes]] = chamadas('POST');
      const corpo = JSON.parse(opcoes.body);
      expect(corpo).toEqual({ nome: '2º A', etapa: 'Ensino Médio', anoLetivo: 2026 });
      expect(typeof corpo.anoLetivo).toBe('number');
      expect(chamadas('GET')).toHaveLength(1);
      // Formulário limpo para o próximo cadastro, com o ano atual sugerido de novo.
      expect(c.nome).toHaveValue('');
      expect(c.etapa).toHaveValue('');
      expect(c.ano).toHaveValue(ANO_ATUAL);
    });

    it('campos vazios mostram erro em cada campo, focam o primeiro e não chamam a API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.clear(c.ano);
      await usuario.click(c.cadastrar);

      expect(screen.getByText('Informe o nome da turma.')).toBeInTheDocument();
      expect(screen.getByText('Informe a etapa da turma.')).toBeInTheDocument();
      expect(screen.getByText('Informe o ano letivo.')).toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'true');
      expect(c.etapa).toHaveAttribute('aria-invalid', 'true');
      expect(c.ano).toHaveAttribute('aria-invalid', 'true');
      expect(c.nome).toHaveFocus();
      expect(chamadas('POST')).toHaveLength(0);
    });

    it('ano letivo fora de 1000 a 9999 mostra mensagem clara e não chama a API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.clear(c.ano);
      await usuario.type(c.ano, '999');
      await usuario.click(c.cadastrar);

      expect(
        screen.getByText(/Informe o ano letivo com 4 algarismos, entre 1000 e 9999/),
      ).toBeInTheDocument();
      expect(c.ano).toHaveAttribute('aria-invalid', 'true');
      expect(c.ano).toHaveFocus();
      expect(chamadas('POST')).toHaveLength(0);
    });

    it('limita nome e etapa aos tamanhos aceitos pela API', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      expect(c.nome).toHaveAttribute('maxLength', '150');
      expect(c.etapa).toHaveAttribute('maxLength', '150');
      expect(c.ano).toHaveAttribute('min', '1000');
      expect(c.ano).toHaveAttribute('max', '9999');
    });

    it('409 de turma repetida mostra a mensagem do servidor e marca os três campos', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'TURMA_DUPLICADA' }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '1º a');
      await usuario.type(c.etapa, 'ensino médio');
      await usuario.clear(c.ano);
      await usuario.type(c.ano, '2026');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_DUPLICADA);
      for (const campo of [c.nome, c.etapa, c.ano]) {
        expect(campo).toHaveAttribute('aria-invalid', 'true');
        expect(campo.getAttribute('aria-describedby')).toContain('turma-conflito');
      }
      expect(c.nome).toHaveFocus();
      expect(c.nome).toHaveValue('1º a');
      expect(linhasNaTabela()).toHaveLength(3);
    });

    it('400 mostra a mensagem do servidor', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(400, { erro: MSG_ANO_INVALIDO_API }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_ANO_INVALIDO_API);
    });

    it('403 mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
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
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(c.nome).toHaveValue('3º C');
      expect(c.etapa).toHaveValue('Ensino Médio');
    });
  });

  describe('erro do campo some ao corrigir (cadastro)', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('o erro de um campo some só quando aquele campo é alterado', async () => {
      mockarApi();
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.click(c.cadastrar);
      expect(screen.getByText('Informe o nome da turma.')).toBeInTheDocument();
      expect(screen.getByText('Informe a etapa da turma.')).toBeInTheDocument();

      await usuario.type(c.nome, '3');

      expect(screen.queryByText('Informe o nome da turma.')).not.toBeInTheDocument();
      expect(c.nome).toHaveAttribute('aria-invalid', 'false');
      expect(c.nome.getAttribute('aria-describedby')).toBe('turma-nome-ajuda');
      // O erro da etapa continua até a etapa ser alterada.
      expect(screen.getByText('Informe a etapa da turma.')).toBeInTheDocument();
      expect(c.etapa).toHaveAttribute('aria-invalid', 'true');

      await usuario.type(c.etapa, 'E');
      expect(screen.queryByText('Informe a etapa da turma.')).not.toBeInTheDocument();
      expect(c.etapa).toHaveAttribute('aria-invalid', 'false');
    });

    it('o aviso de turma repetida (409) some ao alterar qualquer um dos três campos', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'TURMA_DUPLICADA' }) });
      await abrirPagina();

      const c = formularioCadastro();
      await usuario.type(c.nome, '1º A');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);
      expect(await screen.findByText(MSG_DUPLICADA)).toBeInTheDocument();

      await usuario.clear(c.ano);
      await usuario.type(c.ano, '2027');

      expect(screen.queryByText(MSG_DUPLICADA)).not.toBeInTheDocument();
      for (const campo of [c.nome, c.etapa, c.ano]) {
        expect(campo).toHaveAttribute('aria-invalid', 'false');
      }
    });
  });

  describe('edição', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    async function abrirEdicao(rotulo) {
      await abrirPagina();
      await usuario.click(screen.getByRole('button', { name: `Editar a turma ${rotulo}` }));
      return screen.getByRole('dialog', { name: 'Editar turma' });
    }

    it('abre o diálogo pré-preenchido, envia os três campos no PUT, atualiza a lista e confirma', async () => {
      mockarApi({
        aoAtualizar: (id, corpo) => respostaFalsa(200, { id, ...corpo }),
      });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      const nome = within(dialogo).getByLabelText('Nome');
      const etapa = within(dialogo).getByLabelText('Etapa');
      const ano = within(dialogo).getByLabelText('Ano letivo');
      expect(nome).toHaveValue('1º B');
      expect(etapa).toHaveValue('Ensino Médio');
      expect(ano).toHaveValue(2026);
      expect(nome).toHaveFocus();

      await usuario.clear(nome);
      await usuario.type(nome, '1º C');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(
        await screen.findByText('Turma 1º C (Ensino Médio, 2026) atualizada com sucesso.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(linhasNaTabela()).toEqual([
        '1º A | Ensino Médio | 2026',
        '1º C | Ensino Médio | 2026',
        '1º A | Ensino Médio | 2025',
      ]);

      const [[url, opcoes]] = chamadas('PUT');
      expect(url).toBe(`${URL_API}/turmas/2`);
      const corpo = JSON.parse(opcoes.body);
      expect(corpo).toEqual({ nome: '1º C', etapa: 'Ensino Médio', anoLetivo: 2026 });
      expect(typeof corpo.anoLetivo).toBe('number');
      expect(chamadas('GET')).toHaveLength(1);
    });

    it('alterar só o ano letivo reordena a lista', async () => {
      mockarApi({
        aoAtualizar: (id, corpo) => respostaFalsa(200, { id, ...corpo }),
      });
      const dialogo = await abrirEdicao('1º A (Ensino Médio, 2025)');

      const ano = within(dialogo).getByLabelText('Ano letivo');
      await usuario.clear(ano);
      await usuario.type(ano, '2027');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(
        await screen.findByText('Turma 1º A (Ensino Médio, 2027) atualizada com sucesso.'),
      ).toBeInTheDocument();
      expect(linhasNaTabela()[0]).toBe('1º A | Ensino Médio | 2027');
      const [[, opcoes]] = chamadas('PUT');
      expect(JSON.parse(opcoes.body)).toEqual({ nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2027 });
    });

    it('sem alterações, avisa e não chama a API', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(within(dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('409 de turma repetida mostra mensagem clara e mantém o diálogo aberto', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'TURMA_DUPLICADA' }) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      const nome = within(dialogo).getByLabelText('Nome');
      await usuario.clear(nome);
      await usuario.type(nome, '1º A');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_DUPLICADA);
      expect(nome).toHaveAttribute('aria-invalid', 'true');
      expect(nome).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'Editar turma' })).toBeInTheDocument();
      expect(linhasNaTabela()).toHaveLength(3);
      // 409 de duplicidade não recarrega a lista.
      expect(chamadas('GET')).toHaveLength(1);

      await usuario.type(within(dialogo).getByLabelText('Etapa'), ' integral');
      expect(within(dialogo).queryByText(MSG_DUPLICADA)).not.toBeInTheDocument();
      expect(nome).toHaveAttribute('aria-invalid', 'false');
    });

    it('erro do campo some assim que o usuário altera o campo (edição)', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      const etapa = within(dialogo).getByLabelText('Etapa');
      await usuario.clear(etapa);
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));
      expect(within(dialogo).getByText('Informe a etapa da turma.')).toBeInTheDocument();
      expect(etapa).toHaveFocus();

      await usuario.type(etapa, 'E');
      expect(within(dialogo).queryByText('Informe a etapa da turma.')).not.toBeInTheDocument();
      expect(etapa).toHaveAttribute('aria-invalid', 'false');
      expect(chamadas('PUT')).toHaveLength(0);
    });

    it('409 de alteração simultânea mostra aviso geral e recarrega a lista', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_CONCORRENCIA, codigo: 'CONFLITO_CONCORRENTE' }) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' tarde');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_CONCORRENCIA);
      expect(within(dialogo).getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'false');
      await waitFor(() => expect(chamadas('GET')).toHaveLength(2));
    });

    it('400 na edição mostra a mensagem do servidor', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(400, { erro: MSG_ANO_INVALIDO_API }) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' tarde');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_ANO_INVALIDO_API);
    });

    it('403 na edição mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' tarde');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('sem conexão na edição mostra mensagem amigável e mantém o diálogo', async () => {
      mockarApi({
        aoAtualizar: () => {
          throw new TypeError('Failed to fetch');
        },
      });
      const dialogo = await abrirEdicao('1º B (Ensino Médio, 2026)');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' tarde');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
      expect(within(dialogo).getByLabelText('Nome')).toHaveValue('1º B tarde');
    });

    it('"Cancelar" fecha sem salvar e devolve o foco ao botão "Editar"', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      const dialogo = await abrirEdicao('1º A (Ensino Médio, 2025)');

      await usuario.type(within(dialogo).getByLabelText('Nome'), ' alterado');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(chamadas('PUT')).toHaveLength(0);
      expect(
        screen.getByRole('button', { name: 'Editar a turma 1º A (Ensino Médio, 2025)' }),
      ).toHaveFocus();
    });
  });
});
