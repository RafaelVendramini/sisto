// Fluxos da Issue #134 (SSD 1.13, Seção 10 — Front-end): turmas filtradas
// pelo ano letivo atual (horário de São Paulo — RN17) no registro de
// ocorrência e na tela de estudantes, com a opção "Mostrar turmas de anos
// anteriores"; a turma antiga já selecionada continua visível. A API
// (GET /turmas) não muda: o filtro é só no front-end.
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OpcaoTurmasAnteriores from '../src/components/OpcaoTurmasAnteriores.jsx';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';
import {
  anoLetivoAtual,
  filtrarTurmasPorAnoLetivo,
  temTurmasAnteriores,
} from '../src/services/turmasAnoLetivo.js';

const URL_API = 'http://api.exemplo.test';
const ROTULO_CAIXA = 'Mostrar turmas de anos anteriores';

// 23/11/2026 10:00 em São Paulo (UTC-03:00): ano letivo atual 2026.
const AGORA = new Date('2026-11-23T13:00:00.000Z');
// 31/12/2026 22:00 em São Paulo = 01/01/2027 01:00 UTC: ainda é 2026.
const VESPERA_ANO_NOVO = new Date('2027-01-01T01:00:00.000Z');
// 01/01/2027 00:30 em São Paulo = 01/01/2027 03:30 UTC: já é 2027.
const ANO_NOVO = new Date('2027-01-01T03:30:00.000Z');

const ETAPA = 'Ensino Fundamental - Anos Finais';
const TURMA_2027 = { id: 3, nome: '7º A', etapa: ETAPA, anoLetivo: 2027 };
const TURMA_2026 = { id: 2, nome: '6º A', etapa: ETAPA, anoLetivo: 2026 };
const TURMA_2025 = { id: 1, nome: '5º A', etapa: ETAPA, anoLetivo: 2025 };
// Ordem do GET /turmas: ano letivo mais recente primeiro.
const TURMAS_FICTICIAS = [TURMA_2027, TURMA_2026, TURMA_2025];
const ROTULO_2027 = '7º A — Ensino Fundamental - Anos Finais (2027)';
const ROTULO_2026 = '6º A — Ensino Fundamental - Anos Finais (2026)';
const ROTULO_2025 = '5º A — Ensino Fundamental - Anos Finais (2025)';

const USUARIOS_FICTICIOS = [
  { id: 1, nome: 'Gestora Fictícia', email: 'g@exemplo.test', perfil: 'GESTAO', status: 'ATIVO' },
  { id: 10, nome: 'Tutor Fictício A', email: 't1@exemplo.test', perfil: 'TUTOR', status: 'ATIVO' },
];

const ESTUDANTES_FICTICIOS = [
  { id: 1, nomeCompleto: 'Estudante Fictício Antigo', codigoEscolar: null, turma: TURMA_2025, tutor: null },
  { id: 2, nomeCompleto: 'Estudante Fictício Atual', codigoEscolar: null, turma: TURMA_2026, tutor: null },
];

function mockarApi({ aoAtualizarEstudante, turmas = TURMAS_FICTICIAS } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && url === `${URL_API}/turmas`) {
      return respostaFalsa(200, turmas);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/categorias`) {
      return respostaFalsa(200, [{ id: 5, nome: 'Categoria Fictícia X', descricao: null }]);
    }
    if (opcoes.method === 'GET' && url === `${URL_API}/usuarios`) {
      return respostaFalsa(200, USUARIOS_FICTICIOS);
    }
    const get = url.match(/\/estudantes(?:\?turmaId=(\d+))?$/);
    if (opcoes.method === 'GET' && get) {
      const lista = get[1]
        ? ESTUDANTES_FICTICIOS.filter((e) => e.turma.id === Number(get[1]))
        : ESTUDANTES_FICTICIOS;
      return respostaFalsa(200, lista);
    }
    const put = url.match(/\/estudantes\/(\d+)$/);
    if (opcoes.method === 'PUT' && put && aoAtualizarEstudante) {
      return aoAtualizarEstudante(Number(put[1]), JSON.parse(opcoes.body));
    }
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

/** Textos das opções de um select, sem a opção vazia. */
function opcoes(select) {
  return within(select)
    .getAllByRole('option')
    .filter((opcao) => opcao.value !== '')
    .map((opcao) => opcao.textContent);
}

describe('Ano letivo atual no horário de São Paulo (RN17)', () => {
  it('usa a data de São Paulo, e não a de UTC, perto da virada do ano', () => {
    expect(anoLetivoAtual(AGORA.getTime())).toBe(2026);
    // 31/12 às 22h em São Paulo, já 01/01 em UTC: o ano ainda é o anterior.
    expect(anoLetivoAtual(VESPERA_ANO_NOVO.getTime())).toBe(2026);
    // 31/12 às 23h59 em São Paulo.
    expect(anoLetivoAtual(new Date('2027-01-01T02:59:59.000Z').getTime())).toBe(2026);
    // 01/01 à 0h em São Paulo.
    expect(anoLetivoAtual(new Date('2027-01-01T03:00:00.000Z').getTime())).toBe(2027);
  });

  it('sem argumento, usa o relógio atual (simulado)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(VESPERA_ANO_NOVO);
      expect(anoLetivoAtual()).toBe(2026);
      vi.setSystemTime(ANO_NOVO);
      expect(anoLetivoAtual()).toBe(2027);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('filtrarTurmasPorAnoLetivo', () => {
  it('por padrão, mantém só o ano atual e os seguintes, na ordem recebida', () => {
    expect(filtrarTurmasPorAnoLetivo(TURMAS_FICTICIAS, { anoAtual: 2026 })).toEqual([
      TURMA_2027,
      TURMA_2026,
    ]);
  });

  it('com mostrarAnteriores, devolve todas', () => {
    expect(
      filtrarTurmasPorAnoLetivo(TURMAS_FICTICIAS, { anoAtual: 2026, mostrarAnteriores: true }),
    ).toEqual(TURMAS_FICTICIAS);
  });

  it('mantém as turmas antigas de idsMantidos (id em texto ou número) e ignora vazios', () => {
    expect(
      filtrarTurmasPorAnoLetivo(TURMAS_FICTICIAS, { anoAtual: 2026, idsMantidos: ['1'] }),
    ).toEqual(TURMAS_FICTICIAS);
    expect(
      filtrarTurmasPorAnoLetivo(TURMAS_FICTICIAS, { anoAtual: 2026, idsMantidos: [1] }),
    ).toEqual(TURMAS_FICTICIAS);
    expect(
      filtrarTurmasPorAnoLetivo(TURMAS_FICTICIAS, { anoAtual: 2026, idsMantidos: ['', null, undefined] }),
    ).toEqual([TURMA_2027, TURMA_2026]);
  });

  it('lista ausente vira lista vazia; temTurmasAnteriores indica se há anos anteriores', () => {
    expect(filtrarTurmasPorAnoLetivo(undefined, { anoAtual: 2026 })).toEqual([]);
    expect(temTurmasAnteriores(TURMAS_FICTICIAS, 2026)).toBe(true);
    expect(temTurmasAnteriores([TURMA_2026, TURMA_2027], 2026)).toBe(false);
  });
});

describe('OpcaoTurmasAnteriores — só leitura durante o envio', () => {
  afterEach(() => {
    cleanup();
  });

  it('com somenteLeitura, fica aria-disabled, continua focável e não muda', async () => {
    const aoAlterar = vi.fn();
    render(
      <OpcaoTurmasAnteriores id="teste-caixa" marcado={false} aoAlterar={aoAlterar} anoAtual={2026} somenteLeitura />,
    );
    const caixa = screen.getByRole('checkbox', { name: ROTULO_CAIXA });
    expect(caixa).toHaveAttribute('aria-disabled', 'true');
    expect(caixa).toBeEnabled();

    await userEvent.setup().click(caixa);
    expect(aoAlterar).not.toHaveBeenCalled();
  });

  it('sem somenteLeitura, não tem aria-disabled e avisa a alteração', async () => {
    const aoAlterar = vi.fn();
    render(<OpcaoTurmasAnteriores id="teste-caixa" marcado={false} aoAlterar={aoAlterar} anoAtual={2026} />);
    const caixa = screen.getByRole('checkbox', { name: ROTULO_CAIXA });
    expect(caixa).not.toHaveAttribute('aria-disabled');

    await userEvent.setup().click(caixa);
    expect(aoAlterar).toHaveBeenCalledWith(true);
  });
});

describe('Telas com turmas filtradas pelo ano letivo (#134)', () => {
  let usuario;

  function iniciar(agora = AGORA) {
    vi.setSystemTime(agora);
    gravarSessaoFicticia();
  }

  beforeEach(() => {
    // Só o relógio (Date) é fixado; os temporizadores continuam reais.
    vi.useFakeTimers({ toFake: ['Date'] });
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

  describe('registro de ocorrência', () => {
    async function abrirRegistro() {
      mockarApi();
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });
      return {
        turma: screen.getByLabelText('Turma da ocorrência'),
        filtro: screen.getByLabelText('Mostrar estudantes da turma'),
        caixa: screen.getByRole('checkbox', { name: ROTULO_CAIXA }),
      };
    }

    it('por padrão, mostra só as turmas do ano atual e dos seguintes nas duas listas', async () => {
      iniciar();
      const { turma, filtro, caixa } = await abrirRegistro();

      expect(caixa).not.toBeChecked();
      expect(caixa).toHaveAccessibleDescription('Mostrando só as turmas de 2026 em diante.');
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026]);
      expect(opcoes(filtro)).toEqual([ROTULO_2027, ROTULO_2026]);
      // A API continua sendo chamada sem filtro.
      expect(fetch.mock.calls.some(([url]) => url === `${URL_API}/turmas`)).toBe(true);
    });

    it('a caixa mostra as turmas dos anos anteriores e, desmarcada, volta ao padrão', async () => {
      iniciar();
      const { turma, filtro, caixa } = await abrirRegistro();

      await usuario.click(caixa);

      expect(caixa).toBeChecked();
      expect(caixa).toHaveAccessibleDescription('Mostrando as turmas de todos os anos letivos.');
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
      expect(opcoes(filtro)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);

      await usuario.click(caixa);
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026]);
    });

    it('turma antiga já escolhida continua visível e selecionada ao desmarcar a caixa', async () => {
      iniciar();
      const { turma, filtro, caixa } = await abrirRegistro();

      await usuario.click(caixa);
      await usuario.selectOptions(turma, ROTULO_2025);
      expect(await screen.findByRole('checkbox', { name: 'Estudante Fictício Antigo' })).toBeInTheDocument();

      await usuario.click(caixa);

      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
      expect(turma).toHaveDisplayValue(ROTULO_2025);
      expect(filtro).toHaveDisplayValue(ROTULO_2025);
    });

    it('em 31/12 às 22h em São Paulo (01/01 em UTC), a turma do ano que termina ainda aparece', async () => {
      iniciar(VESPERA_ANO_NOVO);
      const { turma, caixa } = await abrirRegistro();

      expect(caixa).toHaveAccessibleDescription('Mostrando só as turmas de 2026 em diante.');
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026]);
    });

    it('sem turma de ano anterior, a caixa não aparece e as turmas são listadas', async () => {
      iniciar();
      mockarApi({ turmas: [TURMA_2027, TURMA_2026] });
      renderizarApp('/ocorrencias/nova');
      await screen.findByRole('button', { name: 'Registrar ocorrência' });

      expect(screen.queryByRole('checkbox', { name: ROTULO_CAIXA })).not.toBeInTheDocument();
      expect(opcoes(screen.getByLabelText('Turma da ocorrência'))).toEqual([ROTULO_2027, ROTULO_2026]);
    });

    it('a partir de 01/01 à 0h em São Paulo, a turma do ano anterior sai da lista padrão', async () => {
      iniciar(ANO_NOVO);
      const { turma, caixa } = await abrirRegistro();

      expect(caixa).toHaveAccessibleDescription('Mostrando só as turmas de 2027 em diante.');
      expect(opcoes(turma)).toEqual([ROTULO_2027]);
    });
  });

  describe('tela de estudantes', () => {
    async function abrirEstudantes(opcoesApi) {
      mockarApi(opcoesApi);
      renderizarApp('/estudantes');
      await screen.findByText('Estudante Fictício Antigo');
      await screen.findByRole('button', { name: 'Cadastrar estudante' });
    }

    function cadastro() {
      const secao = screen.getByRole('region', { name: 'Cadastrar estudante' });
      return {
        turma: within(secao).getByLabelText('Turma'),
        caixa: within(secao).getByRole('checkbox', { name: ROTULO_CAIXA }),
      };
    }

    it('filtro da lista: por padrão, só o ano atual em diante; a caixa mostra os anteriores', async () => {
      iniciar();
      await abrirEstudantes();
      const filtro = screen.getByLabelText('Filtrar por turma');
      const secao = screen.getByRole('region', { name: 'Estudantes cadastrados' });
      const caixa = within(secao).getByRole('checkbox', { name: ROTULO_CAIXA });

      expect(opcoes(filtro)).toEqual([ROTULO_2027, ROTULO_2026]);
      // "Todas as turmas" continua listando todos os estudantes.
      expect(screen.getByText('Estudante Fictício Antigo')).toBeInTheDocument();

      await usuario.click(caixa);
      expect(opcoes(filtro)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);

      // Turma antiga escolhida no filtro continua visível ao desmarcar.
      await usuario.selectOptions(filtro, ROTULO_2025);
      await usuario.click(caixa);
      expect(opcoes(filtro)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
      expect(filtro).toHaveDisplayValue(ROTULO_2025);
    });

    it('sem turma de ano anterior, nem o filtro nem o cadastro mostram a caixa', async () => {
      iniciar();
      mockarApi({ turmas: [TURMA_2027, TURMA_2026] });
      renderizarApp('/estudantes');
      await screen.findByRole('button', { name: 'Cadastrar estudante' });
      await screen.findByLabelText('Filtrar por turma');

      expect(screen.queryByRole('checkbox', { name: ROTULO_CAIXA })).not.toBeInTheDocument();
      expect(opcoes(screen.getByLabelText('Filtrar por turma'))).toEqual([ROTULO_2027, ROTULO_2026]);
    });

    it('cadastro: por padrão, só o ano atual em diante; a caixa mostra os anteriores', async () => {
      iniciar();
      await abrirEstudantes();
      const { turma, caixa } = cadastro();

      expect(caixa).not.toBeChecked();
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026]);

      await usuario.click(caixa);
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
    });

    it('edição de estudante de turma antiga: a turma continua visível e selecionada', async () => {
      iniciar();
      await abrirEstudantes();

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício Antigo' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar estudante' });
      const turma = within(dialogo).getByLabelText('Turma');
      const caixa = within(dialogo).getByRole('checkbox', { name: ROTULO_CAIXA });

      expect(caixa).not.toBeChecked();
      expect(turma).toHaveDisplayValue(ROTULO_2025);
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);

      // Mesmo trocando para outra turma, a turma original continua como opção.
      await usuario.selectOptions(turma, ROTULO_2026);
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
    });

    it('edição de turma antiga: salvar só o nome reenvia a mesma turma', async () => {
      iniciar();
      const aoAtualizarEstudante = vi.fn((id, corpo) =>
        respostaFalsa(200, { ...ESTUDANTES_FICTICIOS[0], ...corpo, id, turma: TURMA_2025 }),
      );
      await abrirEstudantes({ aoAtualizarEstudante });

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício Antigo' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar estudante' });
      const nome = within(dialogo).getByLabelText('Nome completo');
      await usuario.clear(nome);
      await usuario.type(nome, 'Estudante Fictício Antigo Dois');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      await waitFor(() => expect(aoAtualizarEstudante).toHaveBeenCalledTimes(1));
      expect(aoAtualizarEstudante.mock.calls[0][1]).toMatchObject({
        nomeCompleto: 'Estudante Fictício Antigo Dois',
        turmaId: TURMA_2025.id,
      });
    });

    it('edição de estudante do ano atual: a turma antiga só aparece com a caixa marcada', async () => {
      iniciar();
      await abrirEstudantes();

      await usuario.click(screen.getByRole('button', { name: 'Editar Estudante Fictício Atual' }));
      const dialogo = screen.getByRole('dialog', { name: 'Editar estudante' });
      const turma = within(dialogo).getByLabelText('Turma');

      expect(turma).toHaveDisplayValue(ROTULO_2026);
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026]);

      await usuario.click(within(dialogo).getByRole('checkbox', { name: ROTULO_CAIXA }));
      expect(opcoes(turma)).toEqual([ROTULO_2027, ROTULO_2026, ROTULO_2025]);
    });
  });
});
