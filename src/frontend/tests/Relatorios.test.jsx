// Fluxos da Issue #89 — página "Relatórios" (UC05, RF13, RF14, RN01, RNF01,
// RNF02): três tipos de relatório, validação do período antes do envio,
// resultado vazio, erros da API, acesso por perfil, impressão pelo navegador
// e ausência de exportação. API mockada (contrato da Issue #88), sem rede.
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import userEvent from '@testing-library/user-event';
import {
  CHAVE_SESSAO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
} from './utilitarios.jsx';
import {
  formatarDataRelatorio,
  validarFiltroRelatorio,
} from '../src/services/mensagensRelatorios.js';
import {
  PERFIS_RELATORIOS,
  podeGerarRelatorios,
} from '../src/services/perfis.js';

const URL_API = 'http://api.exemplo.test';
const AVISO_SESSAO = 'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_SEM_CONEXAO =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
const MSG_VAZIO = 'Nenhuma ocorrência no período.';

const PEDAGOGICO = { id: 5, nome: 'Clara Pedagoga Fictícia', perfil: 'PEDAGOGICO' };

// Respostas fictícias no formato do contrato da #88.
const RESPOSTA_PERIODO = {
  tipo: 'periodo',
  dataInicio: '2026-10-01',
  dataFim: '2026-10-31',
  total: 7,
  linhas: [],
};
const RESPOSTA_TURMA = {
  tipo: 'turma',
  dataInicio: '2026-10-01',
  dataFim: '2026-10-31',
  total: 7,
  linhas: [
    { id: 1, rotulo: '6º A - Ensino Fundamental - Anos Finais - 2026', quantidade: 4 },
    { id: 2, rotulo: '7º B - Ensino Fundamental - Anos Finais - 2026', quantidade: 3 },
  ],
};
const RESPOSTA_CATEGORIA = {
  tipo: 'categoria',
  dataInicio: '2026-10-01',
  dataFim: '2026-10-31',
  total: 7,
  linhas: [
    { id: 3, rotulo: 'Categoria Fictícia A', quantidade: 5 },
    { id: 4, rotulo: 'Categoria Fictícia B', quantidade: 2 },
  ],
};

/** GET /relatorios?… chama `aoGerar(params)`; qualquer outra chamada falha. */
function mockarApi(aoGerar) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const endereco = new URL(url);
    if (
      `${endereco.origin}${endereco.pathname}` === `${URL_API}/relatorios` &&
      opcoes.method === 'GET'
    ) {
      return aoGerar(Object.fromEntries(endereco.searchParams));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function chamadasRelatorio() {
  return fetch.mock.calls.filter(([url]) => String(url).startsWith(`${URL_API}/relatorios`));
}

function campos() {
  return {
    tipo: screen.getByLabelText('Tipo de relatório'),
    de: screen.getByLabelText('De'),
    ate: screen.getByLabelText('Até'),
    gerar: screen.getByRole('button', { name: 'Gerar relatório' }),
  };
}

/** Preenche o formulário (datas via change: o jsdom não tem seletor de data). */
async function preencher(usuario, { tipo, dataInicio = '', dataFim = '' }) {
  const { tipo: seletor, de, ate } = campos();
  if (tipo) await usuario.selectOptions(seletor, tipo);
  fireEvent.change(de, { target: { value: dataInicio } });
  fireEvent.change(ate, { target: { value: dataFim } });
}

function linhasDaTabela() {
  const tabela = screen.getByRole('table');
  return within(tabela)
    .getAllByRole('row')
    .map((linha) => [...linha.querySelectorAll('th, td')].map((celula) => celula.textContent));
}

describe('Página "Relatórios" (#89)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    // Desmonta antes de restaurar fetch/env: nenhuma chamada pendente vaza.
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('acesso por perfil (RN01, RF14)', () => {
    it('Gestão vê o item "Relatórios" no menu e chega à página com o título da aba', async () => {
      gravarSessaoFicticia();
      renderizarApp('/');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Relatórios' }));

      expect(screen.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe('Relatórios · Sisto'));
      // Abrir a página não chama a API: o relatório só é gerado pelo botão.
      expect(fetch).not.toHaveBeenCalled();
    });

    it('Pedagógico vê o item "Relatórios" e acessa a página', () => {
      gravarSessaoFicticia({ usuario: PEDAGOGICO });
      renderizarApp('/relatorios');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Relatórios' })).toHaveAttribute(
        'href',
        '/relatorios',
      );
      expect(screen.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeInTheDocument();
    });

    it.each(['PROFESSOR', 'TUTOR', 'TECNICO_ADMINISTRATIVO'])(
      '%s não vê o item de menu e recebe "Acesso não permitido" pela URL',
      async (perfil) => {
        gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
        renderizarApp('/relatorios');

        const menu = screen.getByRole('navigation', { name: 'Menu principal' });
        expect(within(menu).queryByRole('link', { name: 'Relatórios' })).not.toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
        ).toBeInTheDocument();
        expect(screen.queryByLabelText('Tipo de relatório')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Voltar para o início' })).toHaveAttribute(
          'href',
          '/',
        );
        await waitFor(() => expect(document.title).toBe('Acesso não permitido · Sisto'));
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('sem sessão, /relatorios leva ao login', () => {
      renderizarApp('/relatorios');

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('a constante de perfis libera só Gestão e Pedagógico', () => {
      expect([...PERFIS_RELATORIOS]).toEqual(['GESTAO', 'PEDAGOGICO']);
      expect(podeGerarRelatorios('GESTAO')).toBe(true);
      expect(podeGerarRelatorios('PEDAGOGICO')).toBe(true);
      expect(podeGerarRelatorios('PROFESSOR')).toBe(false);
      expect(podeGerarRelatorios('TUTOR')).toBe(false);
      expect(podeGerarRelatorios('TECNICO_ADMINISTRATIVO')).toBe(false);
      expect(podeGerarRelatorios(undefined)).toBe(false);
    });
  });

  describe('formulário', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    it('tem rótulos, os três tipos com os nomes da tela e "Total do período" como padrão', () => {
      renderizarApp('/relatorios');
      const { tipo, de, ate } = campos();

      expect(within(tipo).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
        'Total do período',
        'Por turma',
        'Por categoria',
      ]);
      expect(tipo).toHaveValue('periodo');
      expect(de).toHaveAttribute('type', 'date');
      expect(ate).toHaveAttribute('type', 'date');
    });

    it('sem exportação nem gráficos: nenhuma opção de PDF, planilha, CSV ou download', () => {
      renderizarApp('/relatorios');

      const botoes = screen.getAllByRole('button').map((botao) => botao.textContent);
      expect(botoes.join(' ')).not.toMatch(/export|pdf|planilha|csv|excel|baixar|download/i);
      expect(screen.queryByText(/exportar|pdf|planilha|csv|gráfico/i)).not.toBeInTheDocument();
      expect(document.querySelector('a[download], canvas, svg[role="img"]')).toBeNull();
    });
  });

  describe('validação antes do envio', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
      renderizarApp('/relatorios');
    });

    it('período vazio: mensagens nos dois campos, foco em "De" e nenhuma chamada', async () => {
      await usuario.click(campos().gerar);

      expect(screen.getByText('Informe a data inicial do período.')).toBeInTheDocument();
      expect(screen.getByText('Informe a data final do período.')).toBeInTheDocument();
      expect(campos().de).toHaveAttribute('aria-invalid', 'true');
      expect(campos().ate).toHaveAttribute('aria-invalid', 'true');
      expect(campos().de).toHaveFocus();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('só a data final faltando: mensagem no "Até" e nenhuma chamada', async () => {
      await preencher(usuario, { dataInicio: '2026-10-01' });
      await usuario.click(campos().gerar);

      expect(screen.queryByText('Informe a data inicial do período.')).not.toBeInTheDocument();
      expect(screen.getByText('Informe a data final do período.')).toBeInTheDocument();
      expect(campos().ate).toHaveFocus();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('início posterior ao fim: mensagem clara e nenhuma chamada', async () => {
      await preencher(usuario, { dataInicio: '2026-10-31', dataFim: '2026-10-01' });
      await usuario.click(campos().gerar);

      expect(
        screen.getByText('A data final não pode ser anterior à data inicial.'),
      ).toBeInTheDocument();
      expect(campos().ate).toHaveAttribute('aria-invalid', 'true');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('corrigir o campo remove a mensagem dele', async () => {
      await usuario.click(campos().gerar);
      fireEvent.change(campos().de, { target: { value: '2026-10-01' } });

      expect(screen.queryByText('Informe a data inicial do período.')).not.toBeInTheDocument();
      expect(campos().de).toHaveAttribute('aria-invalid', 'false');
      expect(screen.getByText('Informe a data final do período.')).toBeInTheDocument();
    });

    it('início igual ao fim é aceito (um dia só)', async () => {
      mockarApi(() => respostaFalsa(200, { ...RESPOSTA_PERIODO, dataInicio: '2026-10-15', dataFim: '2026-10-15' }));
      await preencher(usuario, { dataInicio: '2026-10-15', dataFim: '2026-10-15' });
      await usuario.click(campos().gerar);

      expect(await screen.findByText('Período: 15/10/2026 a 15/10/2026')).toBeInTheDocument();
      expect(chamadasRelatorio()).toHaveLength(1);
    });
  });

  describe('os três tipos de relatório', () => {
    it('"Total do período": envia tipo e datas, mostra cabeçalho em dd/mm/aaaa e só o total', async () => {
      gravarSessaoFicticia();
      const aoGerar = vi.fn(() => respostaFalsa(200, RESPOSTA_PERIODO));
      mockarApi(aoGerar);
      renderizarApp('/relatorios');

      await preencher(usuario, { dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Total do período' }),
      ).toBeInTheDocument();
      expect(aoGerar).toHaveBeenCalledWith({
        tipo: 'periodo',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      expect(screen.getByText('Período: 01/10/2026 a 31/10/2026')).toBeInTheDocument();
      expect(linhasDaTabela()).toEqual([
        ['Período', 'Quantidade'],
        ['Total', '7'],
      ]);
      // Chamada autenticada com o token da sessão.
      const [, opcoes] = chamadasRelatorio()[0];
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('"Por turma" (Gestão): uma linha por turma e a linha de total', async () => {
      gravarSessaoFicticia();
      const aoGerar = vi.fn(() => respostaFalsa(200, RESPOSTA_TURMA));
      mockarApi(aoGerar);
      renderizarApp('/relatorios');

      await preencher(usuario, {
        tipo: 'turma',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      await usuario.click(campos().gerar);

      expect(await screen.findByRole('heading', { level: 2, name: 'Por turma' })).toBeInTheDocument();
      expect(aoGerar).toHaveBeenCalledWith({
        tipo: 'turma',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      expect(screen.getByText('Período: 01/10/2026 a 31/10/2026')).toBeInTheDocument();
      expect(linhasDaTabela()).toEqual([
        ['Turma', 'Quantidade'],
        ['6º A - Ensino Fundamental - Anos Finais - 2026', '4'],
        ['7º B - Ensino Fundamental - Anos Finais - 2026', '3'],
        ['Total', '7'],
      ]);
    });

    it('"Por categoria" (Pedagógico): uma linha por categoria e a linha de total', async () => {
      gravarSessaoFicticia({ usuario: PEDAGOGICO });
      const aoGerar = vi.fn(() => respostaFalsa(200, RESPOSTA_CATEGORIA));
      mockarApi(aoGerar);
      renderizarApp('/relatorios');

      await preencher(usuario, {
        tipo: 'categoria',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      await usuario.click(campos().gerar);

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Por categoria' }),
      ).toBeInTheDocument();
      expect(aoGerar).toHaveBeenCalledWith({
        tipo: 'categoria',
        dataInicio: '2026-10-01',
        dataFim: '2026-10-31',
      });
      expect(linhasDaTabela()).toEqual([
        ['Categoria', 'Quantidade'],
        ['Categoria Fictícia A', '5'],
        ['Categoria Fictícia B', '2'],
        ['Total', '7'],
      ]);
    });

    it('exibe as linhas na ordem recebida da API (ordem natural: 6º A antes de 10º A)', async () => {
      gravarSessaoFicticia();
      mockarApi(() =>
        respostaFalsa(200, {
          ...RESPOSTA_TURMA,
          total: 3,
          linhas: [
            { id: 1, rotulo: '6º A - Ensino Fundamental - Anos Finais - 2026', quantidade: 1 },
            { id: 9, rotulo: '10º A - Ensino Médio - 2026', quantidade: 2 },
          ],
        }),
      );
      renderizarApp('/relatorios');

      await preencher(usuario, { tipo: 'turma', dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);
      await screen.findByRole('table');

      expect(linhasDaTabela().map((linha) => linha[0])).toEqual([
        'Turma',
        '6º A - Ensino Fundamental - Anos Finais - 2026',
        '10º A - Ensino Médio - 2026',
        'Total',
      ]);
    });

    it('gerar de novo com outro tipo substitui o resultado anterior', async () => {
      gravarSessaoFicticia();
      mockarApi(({ tipo }) =>
        respostaFalsa(200, tipo === 'turma' ? RESPOSTA_TURMA : RESPOSTA_CATEGORIA),
      );
      renderizarApp('/relatorios');

      await preencher(usuario, { tipo: 'turma', dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);
      await screen.findByRole('heading', { level: 2, name: 'Por turma' });

      await usuario.selectOptions(campos().tipo, 'categoria');
      await usuario.click(campos().gerar);

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Por categoria' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Por turma' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('table')).toHaveLength(1);
    });
  });

  describe('resultado vazio', () => {
    it.each([
      ['periodo', { ...RESPOSTA_PERIODO, total: 0 }],
      ['turma', { ...RESPOSTA_TURMA, total: 0, linhas: [] }],
      ['categoria', { ...RESPOSTA_CATEGORIA, total: 0, linhas: [] }],
    ])('tipo %s sem ocorrências mostra "Nenhuma ocorrência no período."', async (tipo, resposta) => {
      gravarSessaoFicticia();
      mockarApi(() => respostaFalsa(200, resposta));
      renderizarApp('/relatorios');

      await preencher(usuario, { tipo, dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);

      expect(await screen.findByText(MSG_VAZIO)).toBeInTheDocument();
      expect(screen.getByText('Período: 01/10/2026 a 31/10/2026')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
    });
  });

  describe('erros da API', () => {
    beforeEach(() => {
      gravarSessaoFicticia();
    });

    async function gerar() {
      renderizarApp('/relatorios');
      await preencher(usuario, { dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);
    }

    it('400 mostra a mensagem do back-end', async () => {
      mockarApi(() =>
        respostaFalsa(400, { erro: 'A data inicial não pode ser posterior à data final.' }),
      );
      await gerar();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'A data inicial não pode ser posterior à data final.',
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('403 mostra "Acesso não permitido para o seu perfil."', async () => {
      mockarApi(() => respostaFalsa(403, { erro: 'Acesso negado.' }));
      await gerar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_PERMISSAO);
    });

    it('500 mostra mensagem genérica, sem detalhe técnico', async () => {
      mockarApi(() => respostaFalsa(500, { erro: 'PrismaClientKnownRequestError' }));
      await gerar();

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(
        'Não foi possível gerar o relatório agora. Tente novamente em instantes.',
      );
      expect(alerta).not.toHaveTextContent(/prisma/i);
    });

    it('sem conexão mostra a mensagem de conexão', async () => {
      fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      await gerar();

      expect(await screen.findByRole('alert')).toHaveTextContent(MSG_SEM_CONEXAO);
    });

    it('erro depois de um resultado esconde a tabela anterior', async () => {
      let primeira = true;
      mockarApi(() => {
        if (primeira) {
          primeira = false;
          return respostaFalsa(200, RESPOSTA_PERIODO);
        }
        return respostaFalsa(500, {});
      });
      await gerar();
      await screen.findByRole('table');

      await usuario.click(campos().gerar);

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('401 volta ao login com aviso e descarta a sessão', async () => {
      mockarApi(() => respostaFalsa(401, { erro: 'Não autenticado.' }));
      await gerar();

      expect(await screen.findByText(AVISO_SESSAO)).toBeInTheDocument();
      expect(sessionStorage.getItem(CHAVE_SESSAO)).toBeNull();
    });
  });

  describe('impressão (RF13)', () => {
    it('o botão "Imprimir" chama a impressão do navegador', async () => {
      gravarSessaoFicticia();
      mockarApi(() => respostaFalsa(200, RESPOSTA_TURMA));
      const imprimir = vi.fn();
      vi.stubGlobal('print', imprimir);
      renderizarApp('/relatorios');

      // Antes de gerar o relatório não há o que imprimir.
      expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();

      await preencher(usuario, { tipo: 'turma', dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);
      await usuario.click(await screen.findByRole('button', { name: 'Imprimir' }));

      expect(imprimir).toHaveBeenCalledTimes(1);
      // Imprimir não chama a API de novo.
      expect(chamadasRelatorio()).toHaveLength(1);
    });

    it('formulário, texto de orientação e botão ficam marcados para não imprimir', async () => {
      gravarSessaoFicticia();
      mockarApi(() => respostaFalsa(200, RESPOSTA_PERIODO));
      renderizarApp('/relatorios');

      await preencher(usuario, { dataInicio: '2026-10-01', dataFim: '2026-10-31' });
      await usuario.click(campos().gerar);
      const botao = await screen.findByRole('button', { name: 'Imprimir' });

      expect(screen.getByRole('form', { name: 'Gerar relatório' })).toHaveClass('nao-imprimir');
      expect(botao).toHaveClass('nao-imprimir');
      // Título, período e tabela continuam na impressão.
      expect(screen.getByRole('heading', { level: 1, name: 'Relatórios' })).not.toHaveClass(
        'nao-imprimir',
      );
      expect(screen.getByText('Período: 01/10/2026 a 31/10/2026').closest('.nao-imprimir')).toBeNull();
      expect(screen.getByRole('table').closest('.nao-imprimir')).toBeNull();
    });

    it('o CSS de impressão esconde cabeçalho, rodapé e o que é marcado "nao-imprimir"', () => {
      const css = readFileSync(
        join(import.meta.dirname, '..', 'src', 'styles', 'global.css'),
        'utf8',
      ).replace(/\r\n/g, '\n');
      const inicio = css.indexOf('@media print');
      expect(inicio).toBeGreaterThan(-1);
      const blocoPrint = css.slice(inicio);
      const regraOculta = blocoPrint.match(/([^{}]+)\{\s*display:\s*none\s*!important;/);
      expect(regraOculta).not.toBeNull();
      const seletores = regraOculta[1].split(',').map((s) => s.trim());
      expect(seletores).toEqual(
        expect.arrayContaining(['.layout__cabecalho', '.layout__rodape', '.nao-imprimir']),
      );
    });
  });
});

describe('services/mensagensRelatorios (#89)', () => {
  it('formata AAAA-MM-DD em dd/mm/aaaa sem mudar o dia', () => {
    expect(formatarDataRelatorio('2026-01-01')).toBe('01/01/2026');
    expect(formatarDataRelatorio('2026-12-31')).toBe('31/12/2026');
  });

  it('valida datas obrigatórias, datas inexistentes e início posterior ao fim', () => {
    expect(validarFiltroRelatorio({ dataInicio: '', dataFim: '' })).toEqual({
      dataInicio: 'Informe a data inicial do período.',
      dataFim: 'Informe a data final do período.',
    });
    expect(validarFiltroRelatorio({ dataInicio: '2026-02-30', dataFim: '2026-03-01' })).toEqual({
      dataInicio: 'Informe uma data inicial válida.',
    });
    expect(validarFiltroRelatorio({ dataInicio: '2026-03-02', dataFim: '2026-03-01' })).toEqual({
      dataFim: 'A data final não pode ser anterior à data inicial.',
    });
    expect(validarFiltroRelatorio({ dataInicio: '2026-03-01', dataFim: '2026-03-01' })).toEqual({});
  });
});
