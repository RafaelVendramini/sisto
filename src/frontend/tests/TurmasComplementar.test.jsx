// Testes complementares do QA — Issue #41 (tela de turmas).
// Cobrem: conversão/validação do ano letivo (valores-limite e formatos
// estranhos), contrato com o back-end (#40), 403/404/500 na tela, 409
// acessível na edição, duplo envio e ordenação após operações.
// Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';
import {
  converterAnoLetivo,
  ehTurmaDuplicada,
  listaPodeEstarDesatualizada,
  mensagemErroTurma,
  mensagemTurmaDuplicada,
  validarTurma,
  MENSAGEM_TURMA_DUPLICADA,
  MENSAGEM_ALTERACAO_SIMULTANEA_TURMA,
} from '../src/services/mensagensTurmas.js';

const URL_API = 'http://api.exemplo.test';
const MSG_SEM_PERMISSAO = 'Acesso não permitido para o seu perfil.';
const MSG_DUPLICADA =
  'Já existe uma turma cadastrada com este nome e esta etapa neste ano letivo.';
const MSG_CONCORRENCIA = 'A turma foi alterada por outra operação ao mesmo tempo. Tente novamente.';

const TURMAS_FICTICIAS = [
  { id: 3, nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2026 },
  { id: 2, nome: '1º B', etapa: 'Ensino Médio', anoLetivo: 2026 },
  { id: 1, nome: '1º A', etapa: 'Ensino Médio', anoLetivo: 2025 },
];

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

function linhasNaTabela() {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((linha) =>
      within(linha)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((c) => c.textContent)
        .join(' | '),
    );
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

// ---------------------------------------------------------------------------
// Unidade: regras de conversão do ano letivo (contrato #40: inteiro 1000–9999)
// ---------------------------------------------------------------------------
describe('mensagensTurmas — converterAnoLetivo (contrato #40)', () => {
  it.each([
    ['2026', 2026],
    [' 2026 ', 2026],
    ['1000', 1000],
    ['9999', 9999],
    [2026, 2026],
  ])('aceita %j → %j (número)', (entrada, esperado) => {
    const ano = converterAnoLetivo(entrada);
    expect(ano).toBe(esperado);
    expect(Number.isInteger(ano)).toBe(true);
  });

  it.each(['', '   ', null, undefined, '2026.5', '2026,0', 'abc', '02026', '0999', '999', '10000', '-2026', '+2026', '2e3', '2E3', '0x7EA', '20 26', '２０２６', NaN, 2026.5])(
    'recusa %j (devolve null)',
    (entrada) => {
      expect(converterAnoLetivo(entrada)).toBeNull();
    },
  );
});

describe('mensagensTurmas — validarTurma', () => {
  it('nome e etapa só com espaços são obrigatórios; limites de 150 após trim', () => {
    expect(validarTurma({ nome: '   ', etapa: '\t', anoLetivo: '2026' })).toEqual({
      nome: 'Informe o nome da turma.',
      etapa: 'Informe a etapa da turma.',
    });
    const ok = validarTurma({ nome: ` ${'a'.repeat(150)} `, etapa: 'b'.repeat(150), anoLetivo: '2026' });
    expect(ok).toEqual({});
    const longo = validarTurma({ nome: 'a'.repeat(151), etapa: 'b'.repeat(151), anoLetivo: '2026' });
    expect(longo.nome).toMatch(/no máximo 150/);
    expect(longo.etapa).toMatch(/no máximo 150/);
  });

  it('ano vazio → "Informe o ano letivo."; formato inválido → mensagem dos 4 algarismos', () => {
    expect(validarTurma({ nome: 'X', etapa: 'Y', anoLetivo: '' }).anoLetivo).toBe(
      'Informe o ano letivo.',
    );
    for (const ano of ['2026.5', '02026', '-2026', '2e3']) {
      expect(validarTurma({ nome: 'X', etapa: 'Y', anoLetivo: ano }).anoLetivo).toMatch(
        /4 algarismos, entre 1000 e 9999/,
      );
    }
  });
});

describe('mensagensTurmas — classificação das falhas', () => {
  it('409 de duplicidade × 409 de alteração simultânea (textos do back-end #40)', () => {
    const dup = { status: 409, message: MSG_DUPLICADA, doServidor: true };
    const conc = { status: 409, message: MSG_CONCORRENCIA, doServidor: true };
    expect(MENSAGEM_TURMA_DUPLICADA).toBe(MSG_DUPLICADA);
    expect(MENSAGEM_ALTERACAO_SIMULTANEA_TURMA).toBe(MSG_CONCORRENCIA);
    expect(ehTurmaDuplicada(dup)).toBe(true);
    expect(ehTurmaDuplicada(conc)).toBe(false);
    expect(listaPodeEstarDesatualizada(conc)).toBe(true);
    expect(listaPodeEstarDesatualizada(dup)).toBe(false);
    expect(listaPodeEstarDesatualizada({ status: 404 })).toBe(true);
  });

  it('409 sem corpo do servidor usa o texto fixo de turma repetida', () => {
    expect(mensagemTurmaDuplicada({ status: 409, message: 'x', doServidor: false })).toBe(
      MSG_DUPLICADA,
    );
  });

  it('500 e status desconhecido viram mensagem genérica sem detalhe técnico', () => {
    const falha = { status: 500, message: 'Erro interno do servidor.', doServidor: true };
    expect(mensagemErroTurma(falha, 'criar')).toBe(
      'Não foi possível cadastrar a turma agora. Tente novamente em instantes.',
    );
    expect(mensagemErroTurma(falha, 'editar')).toBe(
      'Não foi possível salvar a alteração agora. Tente novamente em instantes.',
    );
    expect(mensagemErroTurma({ status: 404 }, 'editar')).toBe(
      'Turma não encontrada. Atualize a página e tente novamente.',
    );
  });
});

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
describe('Tela de turmas (#41) — complementar QA', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    gravarSessaoFicticia();
    usuario = userEvent.setup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('ano letivo digitado no cadastro (campo type="number")', () => {
    // fireEvent.change simula o valor que o navegador entrega ao React.
    it.each(['2026.5', '02026', '-2026', '2e3', '999', '10000'])(
      'valor %j: mostra erro no campo, foca o ano e não envia POST',
      async (valor) => {
        mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: 9, ...c }) });
        renderizarApp('/turmas');
        await screen.findByRole('table');

        const c = formularioCadastro();
        await usuario.type(c.nome, '3º C');
        await usuario.type(c.etapa, 'Ensino Médio');
        fireEvent.change(c.ano, { target: { value: valor } });
        await usuario.click(c.cadastrar);

        expect(screen.getByText(/4 algarismos, entre 1000 e 9999/)).toBeInTheDocument();
        expect(c.ano).toHaveAttribute('aria-invalid', 'true');
        expect(c.ano.getAttribute('aria-describedby')).toContain('turma-anoLetivo-erro');
        expect(c.ano).toHaveFocus();
        expect(chamadas('POST')).toHaveLength(0);
      },
    );

    it('texto não numérico ("abc") é descartado pelo campo numérico e cai em "Informe o ano letivo."', async () => {
      mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: 9, ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.clear(c.ano);
      await usuario.type(c.ano, 'abc');
      await usuario.click(c.cadastrar);

      expect(screen.getByText('Informe o ano letivo.')).toBeInTheDocument();
      expect(chamadas('POST')).toHaveLength(0);
    });

    it('ano no limite (1000 e 9999) é enviado como número', async () => {
      let id = 10;
      mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: (id += 1), ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      for (const ano of ['1000', '9999']) {
        const c = formularioCadastro();
        await usuario.type(c.nome, 'Turma Fictícia');
        await usuario.type(c.etapa, 'Ensino Médio');
        fireEvent.change(c.ano, { target: { value: ano } });
        await usuario.click(c.cadastrar);
        await screen.findByText(`Turma Turma Fictícia (Ensino Médio, ${ano}) cadastrada com sucesso.`);
      }
      const corpos = chamadas('POST').map(([, o]) => JSON.parse(o.body));
      expect(corpos).toEqual([
        { nome: 'Turma Fictícia', etapa: 'Ensino Médio', anoLetivo: 1000 },
        { nome: 'Turma Fictícia', etapa: 'Ensino Médio', anoLetivo: 9999 },
      ]);
      // Ordem do back-end: ano desc (9999 primeiro, 1000 por último).
      const linhas = linhasNaTabela();
      expect(linhas[0]).toBe('Turma Fictícia | Ensino Médio | 9999');
      expect(linhas.at(-1)).toBe('Turma Fictícia | Ensino Médio | 1000');
    });
  });

  describe('contrato do corpo (#40)', () => {
    it('POST envia só nome, etapa e anoLetivo (sem id nem campos extras)', async () => {
      mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: 9, ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrada com sucesso/);

      const [[url, opcoes]] = chamadas('POST');
      expect(url).toBe(`${URL_API}/turmas`);
      expect(Object.keys(JSON.parse(opcoes.body)).sort()).toEqual(['anoLetivo', 'etapa', 'nome']);
      expect(opcoes.headers.Authorization).toMatch(/^Bearer /);
    });

    it('PUT envia sempre os três campos, mesmo alterando só a etapa', async () => {
      mockarApi({ aoAtualizar: (id, c) => respostaFalsa(200, { id, ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');
      await usuario.click(
        screen.getByRole('button', { name: 'Editar a turma 1º B (Ensino Médio, 2026)' }),
      );
      const dialogo = screen.getByRole('dialog', { name: 'Editar turma' });
      const etapa = within(dialogo).getByLabelText('Etapa');
      await usuario.clear(etapa);
      await usuario.type(etapa, '  Ensino Fundamental  ');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));
      await screen.findByText(/atualizada com sucesso/);

      const [[, opcoes]] = chamadas('PUT');
      expect(JSON.parse(opcoes.body)).toEqual({
        nome: '1º B',
        etapa: 'Ensino Fundamental',
        anoLetivo: 2026,
      });
    });

    it('edição só com espaços nas pontas é tratada como "sem alteração" (trim igual ao back-end)', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(200, {}) });
      renderizarApp('/turmas');
      await screen.findByRole('table');
      await usuario.click(
        screen.getByRole('button', { name: 'Editar a turma 1º B (Ensino Médio, 2026)' }),
      );
      const dialogo = screen.getByRole('dialog', { name: 'Editar turma' });
      await usuario.type(within(dialogo).getByLabelText('Nome'), '   ');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(within(dialogo).getByRole('alert')).toHaveTextContent('Nenhum dado foi alterado.');
      expect(chamadas('PUT')).toHaveLength(0);
    });
  });

  describe('erros da API na tela', () => {
    it('403 no GET mostra "Acesso não permitido para o seu perfil." (sem texto técnico)', async () => {
      mockarApi({ lista: () => respostaFalsa(403, { erro: MSG_SEM_PERMISSAO }) });
      renderizarApp('/turmas');

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(MSG_SEM_PERMISSAO);
      expect(alerta.textContent).not.toMatch(/403/);
    });

    it('500 no POST mostra mensagem genérica, sem detalhe técnico, e mantém os dados', async () => {
      mockarApi({ aoCriar: () => respostaFalsa(500, { erro: 'Erro interno do servidor.' }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Não foi possível cadastrar a turma agora.');
      expect(alerta.textContent).not.toMatch(/500|interno/i);
      expect(c.nome).toHaveValue('3º C');
      expect(linhasNaTabela()).toHaveLength(3);
    });

    it('404 na edição mostra a mensagem do servidor e recarrega a lista em segundo plano', async () => {
      let gets = 0;
      mockarApi({
        lista: () => {
          gets += 1;
          return respostaFalsa(200, gets === 1 ? TURMAS_FICTICIAS : TURMAS_FICTICIAS.slice(0, 1));
        },
        aoAtualizar: () => respostaFalsa(404, { erro: 'Turma não encontrada.' }),
      });
      renderizarApp('/turmas');
      await screen.findByRole('table');
      await usuario.click(
        screen.getByRole('button', { name: 'Editar a turma 1º B (Ensino Médio, 2026)' }),
      );
      const dialogo = screen.getByRole('dialog', { name: 'Editar turma' });
      await usuario.type(within(dialogo).getByLabelText('Nome'), ' tarde');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Turma não encontrada.');
      await waitFor(() => expect(linhasNaTabela()).toEqual(['1º A | Ensino Médio | 2026']));
    });

    it('409 de duplicidade na edição marca os três campos e aponta para o aviso (acessibilidade)', async () => {
      mockarApi({ aoAtualizar: () => respostaFalsa(409, { erro: MSG_DUPLICADA, codigo: 'TURMA_DUPLICADA' }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');
      await usuario.click(
        screen.getByRole('button', { name: 'Editar a turma 1º B (Ensino Médio, 2026)' }),
      );
      const dialogo = screen.getByRole('dialog', { name: 'Editar turma' });
      const nome = within(dialogo).getByLabelText('Nome');
      await usuario.clear(nome);
      await usuario.type(nome, '1º A');
      await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar alterações' }));

      const alerta = await within(dialogo).findByRole('alert');
      expect(alerta).toHaveAttribute('id', 'edicao-turma-conflito');
      for (const rotulo of ['Nome', 'Etapa', 'Ano letivo']) {
        const campo = within(dialogo).getByLabelText(rotulo);
        expect(campo).toHaveAttribute('aria-invalid', 'true');
        expect(campo.getAttribute('aria-describedby').split(' ')).toContain('edicao-turma-conflito');
        // O texto de ajuda do campo continua referenciado.
        expect(campo.getAttribute('aria-describedby')).toMatch(/-ajuda/);
      }
      // A descrição acessível do campo inclui o aviso de turma repetida.
      expect(nome).toHaveAccessibleDescription(expect.stringContaining(MSG_DUPLICADA));
    });
  });

  describe('fluxo', () => {
    it('duplo clique em "Cadastrar turma" envia um único POST', async () => {
      let liberar;
      mockarApi({
        aoCriar: (c) =>
          new Promise((resolve) => {
            liberar = () => resolve(respostaFalsa(201, { id: 9, ...c }));
          }),
      });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.dblClick(c.cadastrar);
      await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
      expect(screen.getByRole('button', { name: 'Cadastrando...' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      liberar();
      await screen.findByText(/cadastrada com sucesso/);
      expect(chamadas('POST')).toHaveLength(1);
    });

    it('abrir a edição limpa a confirmação anterior', async () => {
      mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: 9, ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '3º C');
      await usuario.type(c.etapa, 'Ensino Médio');
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrada com sucesso/);

      await usuario.click(
        screen.getByRole('button', { name: 'Editar a turma 1º A (Ensino Médio, 2025)' }),
      );
      expect(screen.queryByText(/cadastrada com sucesso/)).not.toBeInTheDocument();
    });

    it('após cadastrar, reordena por ano desc, etapa e nome (igual ao GET /turmas)', async () => {
      mockarApi({ aoCriar: (c) => respostaFalsa(201, { id: 9, ...c }) });
      renderizarApp('/turmas');
      await screen.findByRole('table');

      const c = formularioCadastro();
      await usuario.type(c.nome, '9º A');
      await usuario.type(c.etapa, 'Ensino Fundamental');
      fireEvent.change(c.ano, { target: { value: '2025' } });
      await usuario.click(c.cadastrar);
      await screen.findByText(/cadastrada com sucesso/);

      expect(linhasNaTabela()).toEqual([
        '1º A | Ensino Médio | 2026',
        '1º B | Ensino Médio | 2026',
        '9º A | Ensino Fundamental | 2025',
        '1º A | Ensino Médio | 2025',
      ]);
    });

    it('não há rota/ação de exclusão (RN21): nenhuma chamada DELETE é possível pela tela', async () => {
      mockarApi();
      renderizarApp('/turmas');
      await screen.findByRole('table');
      expect(screen.queryByRole('button', { name: /excluir|remover|apagar|inativar/i })).toBeNull();
      expect(chamadas('DELETE')).toHaveLength(0);
    });
  });
});
