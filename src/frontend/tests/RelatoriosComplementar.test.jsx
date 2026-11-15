// Testes complementares do QA — Issue #89 (página "Relatórios").
// Cobrem lacunas dos testes do dev: mensagens 400 REAIS do back-end (#88,
// services/periodo.js e services/relatorios.js), rótulo de turma no formato
// real da API ("nome — etapa (ano)"), estado "Gerando..." sem envio duplo,
// limpeza do erro após nova geração bem-sucedida e marcação de impressão no
// DOM (menu dentro do cabeçalho, alerta de erro fora da impressão).
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';

// Mensagens reais dos 400 do GET /relatorios (origin/developer, #88).
const MENSAGENS_400_REAIS = [
  'Informe dataInicio no formato AAAA-MM-DD.',
  'Informe dataFim no formato AAAA-MM-DD.',
  'Informe dataInicio como uma data válida no formato AAAA-MM-DD.',
  'Informe dataFim como uma data válida no formato AAAA-MM-DD.',
  'A dataInicio não pode ser posterior à dataFim.',
  'Informe tipo com um destes valores: periodo, turma, categoria.',
];

// Resposta no formato exato da API real: rótulo de turma = `${nome} — ${etapa} (${ano_letivo})`.
const RESPOSTA_TURMA_REAL = {
  tipo: 'turma',
  dataInicio: '2026-03-01',
  dataFim: '2026-06-30',
  total: 5,
  linhas: [
    { id: 2, rotulo: '6º A — Ensino Fundamental - Anos Finais (2026)', quantidade: 2 },
    { id: 7, rotulo: '10º B — Ensino Médio (2026)', quantidade: 3 },
  ],
};

const RESPOSTA_CATEGORIA_REAL = {
  tipo: 'categoria',
  dataInicio: '2026-03-01',
  dataFim: '2026-06-30',
  total: 4,
  linhas: [
    { id: 1, rotulo: 'Categoria Fictícia Atraso', quantidade: 1 },
    { id: 3, rotulo: 'Categoria Fictícia Conduta', quantidade: 3 },
  ],
};

function mockarRelatorios(aoGerar) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const endereco = new URL(url);
    if (`${endereco.origin}${endereco.pathname}` === `${URL_API}/relatorios` && opcoes.method === 'GET') {
      return aoGerar(Object.fromEntries(endereco.searchParams));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

const chamadasRelatorio = () =>
  fetch.mock.calls.filter(([url]) => String(url).startsWith(`${URL_API}/relatorios`));

async function preencherEGerar(usuario, { tipo, dataInicio = '2026-03-01', dataFim = '2026-06-30' } = {}) {
  if (tipo) await usuario.selectOptions(screen.getByLabelText('Tipo de relatório'), tipo);
  fireEvent.change(screen.getByLabelText('De'), { target: { value: dataInicio } });
  fireEvent.change(screen.getByLabelText('Até'), { target: { value: dataFim } });
  await usuario.click(screen.getByRole('button', { name: 'Gerar relatório' }));
}

function celulasDaTabela() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .map((linha) => [...linha.querySelectorAll('th, td')].map((c) => c.textContent));
}

describe('Relatórios — complementar do QA (#89)', () => {
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

  describe('400 com as mensagens reais do back-end (#88)', () => {
    it.each(MENSAGENS_400_REAIS)('mostra "%s" e não mostra tabela', async (mensagem) => {
      mockarRelatorios(() => respostaFalsa(400, { erro: mensagem }));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario);

      expect(await screen.findByRole('alert')).toHaveTextContent(mensagem);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument();
    });

    it('400 sem campo `erro` mostra a mensagem genérica (sem detalhe técnico)', async () => {
      mockarRelatorios(() => respostaFalsa(400, {}));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível gerar o relatório agora. Tente novamente em instantes.',
      );
    });

    it('o alerta de erro some quando a geração seguinte dá certo', async () => {
      let chamada = 0;
      mockarRelatorios(() => {
        chamada += 1;
        return chamada === 1
          ? respostaFalsa(400, { erro: MENSAGENS_400_REAIS[4] })
          : respostaFalsa(200, RESPOSTA_CATEGORIA_REAL);
      });
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'categoria' });
      await screen.findByRole('alert');
      await usuario.click(screen.getByRole('button', { name: 'Gerar relatório' }));

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('formato real da resposta', () => {
    it('"Por turma" mostra o rótulo real "nome — etapa (ano)", na ordem da API, com total', async () => {
      mockarRelatorios(() => respostaFalsa(200, RESPOSTA_TURMA_REAL));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'turma' });
      await screen.findByRole('table');

      expect(screen.getByText('Período: 01/03/2026 a 30/06/2026')).toBeInTheDocument();
      expect(celulasDaTabela()).toEqual([
        ['Turma', 'Quantidade'],
        ['6º A — Ensino Fundamental - Anos Finais (2026)', '2'],
        ['10º B — Ensino Médio (2026)', '3'],
        ['Total', '5'],
      ]);
    });

    it('o cabeçalho usa o período devolvido pela API, mesmo que o formulário mude depois', async () => {
      mockarRelatorios(() => respostaFalsa(200, RESPOSTA_CATEGORIA_REAL));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'categoria' });
      await screen.findByRole('table');
      fireEvent.change(screen.getByLabelText('De'), { target: { value: '2025-01-01' } });

      expect(screen.getByText('Período: 01/03/2026 a 30/06/2026')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Por categoria' })).toBeInTheDocument();
    });
  });

  describe('envio', () => {
    it('durante a geração o botão mostra "Gerando..." e fica desabilitado (sem envio duplo)', async () => {
      let liberar;
      mockarRelatorios(
        () =>
          new Promise((resolver) => {
            liberar = () => resolver(respostaFalsa(200, RESPOSTA_CATEGORIA_REAL));
          }),
      );
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'categoria' });

      const botao = await screen.findByRole('button', { name: 'Gerando...' });
      expect(botao).toBeDisabled();
      expect(screen.getByRole('form', { name: 'Gerar relatório' })).toHaveAttribute('aria-busy', 'true');
      await usuario.click(botao);
      expect(chamadasRelatorio()).toHaveLength(1);

      liberar();
      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Gerar relatório' })).toBeEnabled();
    });

    it('sair da página com a geração pendente não quebra a aplicação', async () => {
      let liberar;
      mockarRelatorios(
        () =>
          new Promise((resolver) => {
            liberar = () => resolver(respostaFalsa(200, RESPOSTA_CATEGORIA_REAL));
          }),
      );
      const erroConsole = vi.spyOn(console, 'error');
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'categoria' });
      await screen.findByRole('button', { name: 'Gerando...' });
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      await usuario.click(within(menu).getByRole('link', { name: 'Início' }));
      liberar();

      await waitFor(() =>
        expect(screen.queryByRole('heading', { level: 1, name: 'Relatórios' })).not.toBeInTheDocument(),
      );
      expect(erroConsole).not.toHaveBeenCalled();
    });

    it('a query leva só tipo, dataInicio e dataFim (nada de formato de exportação)', async () => {
      mockarRelatorios(() => respostaFalsa(200, RESPOSTA_TURMA_REAL));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'turma' });
      await screen.findByRole('table');

      const [url, opcoes] = chamadasRelatorio()[0];
      expect([...new URL(url).searchParams.keys()].sort()).toEqual(['dataFim', 'dataInicio', 'tipo']);
      expect(opcoes.method).toBe('GET');
    });
  });

  describe('impressão no DOM', () => {
    it('menu fica dentro de .layout__cabecalho e o rodapé é .layout__rodape (ocultos na impressão)', () => {
      renderizarApp('/relatorios');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(menu.closest('.layout__cabecalho')).not.toBeNull();
      expect(screen.getByRole('contentinfo')).toHaveClass('layout__rodape');
      expect(screen.getByRole('banner')).toHaveClass('layout__cabecalho');
    });

    it('o alerta de erro é marcado para não imprimir', async () => {
      mockarRelatorios(() => respostaFalsa(500, {}));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario);

      expect(await screen.findByRole('alert')).toHaveClass('nao-imprimir');
    });

    it('"Total do período" com ocorrências também tem o botão "Imprimir"', async () => {
      const imprimir = vi.fn();
      vi.stubGlobal('print', imprimir);
      mockarRelatorios(() =>
        respostaFalsa(200, { tipo: 'periodo', dataInicio: '2026-03-01', dataFim: '2026-06-30', total: 9, linhas: [] }),
      );
      renderizarApp('/relatorios');

      await preencherEGerar(usuario);
      await usuario.click(await screen.findByRole('button', { name: 'Imprimir' }));

      expect(imprimir).toHaveBeenCalledTimes(1);
      expect(celulasDaTabela()).toEqual([
        ['Período', 'Quantidade'],
        ['Total', '9'],
      ]);
    });
  });

  describe('403 do back-end (proteção real — RF14)', () => {
    it('Pedagógico com 403 do back-end vê "Acesso não permitido para o seu perfil."', async () => {
      sessionStorage.clear();
      gravarSessaoFicticia({ usuario: { id: 5, nome: 'Clara Pedagoga Fictícia', perfil: 'PEDAGOGICO' } });
      mockarRelatorios(() => respostaFalsa(403, { erro: 'Acesso negado para este perfil.' }));
      renderizarApp('/relatorios');

      await preencherEGerar(usuario, { tipo: 'turma' });

      expect(await screen.findByRole('alert')).toHaveTextContent('Acesso não permitido para o seu perfil.');
    });
  });
});
