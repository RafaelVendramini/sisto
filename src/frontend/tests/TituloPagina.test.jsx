// Fluxos da Issue #78 — título da aba por tela (RNF02, RNF06): formato
// "<Tela> · Sisto" definido por um hook único (useTituloPagina), aplicado a
// todas as telas, inclusive "Acesso não permitido" e "Página não encontrada".
// O título nunca leva nome de estudante nem outro dado pessoal: no detalhe,
// só o número da ocorrência (RNF06).
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatarTituloPagina, useTituloPagina } from '../src/components/useTituloPagina.js';
import {
  CHAVE_SESSAO,
  gravarSessaoFicticia,
  renderizarApp,
  respostaFalsa,
  tokenFicticio,
} from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const TITULO_INICIAL = 'título anterior (teste)';

const NOME_USUARIO = 'Pessoa Fictícia';
const ESTUDANTE_A = 'Estudante Fictício A';
const ESTUDANTE_B = 'Estudante Fictício B';

// Detalhe fictício com nomes de estudantes, para conferir que não vão ao título.
const DETALHE_FICTICIO = Object.freeze({
  id: 23,
  dataHora: '2026-10-30T12:39:00.000Z',
  local: 'Pátio',
  turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 },
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
    {
      id: 1,
      nomeCompleto: ESTUDANTE_A,
      turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 },
      codigoEscolar: 'COD-FICT-001',
    },
    {
      id: 2,
      nomeCompleto: ESTUDANTE_B,
      turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 },
      codigoEscolar: null,
    },
  ],
  encaminhamentos: [],
  comunicacoes: [],
  providencias: [],
});

/**
 * GET /ocorrencias/{id} chama `detalhe(id)`; qualquer outro GET devolve lista
 * vazia (as telas só precisam montar para o título ser conferido).
 */
function mockarApi({ detalhe = () => respostaFalsa(200, DETALHE_FICTICIO) } = {}) {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    const get = url.match(/\/ocorrencias\/([^/]+)$/);
    if (opcoes.method === 'GET' && get && get[1] !== 'nova') {
      return detalhe(decodeURIComponent(get[1]));
    }
    if (opcoes.method === 'GET') return respostaFalsa(200, []);
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: NOME_USUARIO, perfil } });
}

describe('Título da aba por tela (#78)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.title = TITULO_INICIAL;
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('formatarTituloPagina', () => {
    it.each([
      ['Entrar', 'Entrar · Sisto'],
      ['Ocorrências', 'Ocorrências · Sisto'],
      ['Ocorrência nº 23', 'Ocorrência nº 23 · Sisto'],
      ['Registrar ocorrência', 'Registrar ocorrência · Sisto'],
      ['Página não encontrada', 'Página não encontrada · Sisto'],
    ])('"%s" vira "%s"', (tela, esperado) => {
      expect(formatarTituloPagina(tela)).toBe(esperado);
    });

    it('usa o ponto médio (U+00B7) com um espaço de cada lado', () => {
      expect(formatarTituloPagina('X')).toBe('X · Sisto');
    });
  });

  describe('useTituloPagina', () => {
    it('define o document.title ao montar', () => {
      renderHook(() => useTituloPagina('Tela Fictícia'));

      expect(document.title).toBe('Tela Fictícia · Sisto');
    });

    it('atualiza o document.title quando o título muda', () => {
      const { rerender } = renderHook(({ titulo }) => useTituloPagina(titulo), {
        initialProps: { titulo: 'Primeira' },
      });
      expect(document.title).toBe('Primeira · Sisto');

      rerender({ titulo: 'Segunda' });

      expect(document.title).toBe('Segunda · Sisto');
    });

    it('a tela montada por último define o título', () => {
      function Tela({ titulo }) {
        useTituloPagina(titulo);
        return null;
      }
      const { rerender } = render(<Tela key="a" titulo="Tela A" />);
      rerender(<Tela key="b" titulo="Tela B" />);

      expect(document.title).toBe('Tela B · Sisto');
    });
  });

  describe('título de cada tela', () => {
    it('Login: "Entrar · Sisto"', () => {
      renderizarApp('/login');

      expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
      expect(document.title).toBe('Entrar · Sisto');
    });

    it('rota protegida sem sessão termina no login com "Entrar · Sisto"', () => {
      renderizarApp('/ocorrencias');

      expect(document.title).toBe('Entrar · Sisto');
    });

    it.each([
      ['/', 'Início · Sisto'],
      ['/conta/senha', 'Alterar minha senha · Sisto'],
      ['/ocorrencias', 'Ocorrências · Sisto'],
      ['/ocorrencias/nova', 'Registrar ocorrência · Sisto'],
      ['/usuarios', 'Usuários · Sisto'],
      ['/turmas', 'Turmas · Sisto'],
      ['/estudantes', 'Estudantes · Sisto'],
      ['/categorias', 'Categorias · Sisto'],
    ])('Gestão em %s: "%s"', async (rota, esperado) => {
      sessao('GESTAO');
      mockarApi();
      renderizarApp(rota);

      await waitFor(() => expect(document.title).toBe(esperado));
      // Nenhum dado pessoal do usuário logado no título (RNF06).
      expect(document.title).not.toContain(NOME_USUARIO);
    });

    it('Categorias também tem o título para o Pedagógico', async () => {
      sessao('PEDAGOGICO');
      mockarApi();
      renderizarApp('/categorias');

      await waitFor(() => expect(document.title).toBe('Categorias · Sisto'));
    });

    it('Página não encontrada (deslogado): "Página não encontrada · Sisto"', () => {
      renderizarApp('/uma-rota-qualquer');

      expect(document.title).toBe('Página não encontrada · Sisto');
    });

    it('Página não encontrada (logado): "Página não encontrada · Sisto"', () => {
      sessao('PROFESSOR');
      renderizarApp('/uma-rota-qualquer');

      expect(document.title).toBe('Página não encontrada · Sisto');
    });

    it.each([
      ['PROFESSOR', '/usuarios'],
      ['PROFESSOR', '/categorias'],
      ['TUTOR', '/turmas'],
      ['TECNICO_ADMINISTRATIVO', '/estudantes'],
    ])('%s em %s: "Acesso não permitido · Sisto"', (perfil, rota) => {
      sessao(perfil);
      renderizarApp(rota);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Acesso não permitido' }),
      ).toBeInTheDocument();
      expect(document.title).toBe('Acesso não permitido · Sisto');
    });

    it('com a troca de senha pendente (RN10), endereço inexistente termina em "Alterar minha senha · Sisto"', () => {
      sessionStorage.setItem(
        CHAVE_SESSAO,
        JSON.stringify({
          token: tokenFicticio(),
          usuario: { id: 9, nome: NOME_USUARIO, perfil: 'PROFESSOR' },
          trocaSenhaObrigatoria: true,
        }),
      );
      renderizarApp('/uma-rota-qualquer');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Alterar minha senha' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Página não encontrada' })).not.toBeInTheDocument();
      expect(document.title).toBe('Alterar minha senha · Sisto');
    });

    it('navegar entre telas atualiza o título (404 → início)', async () => {
      sessao('PROFESSOR');
      renderizarApp('/uma-rota-qualquer');
      expect(document.title).toBe('Página não encontrada · Sisto');

      await usuario.click(screen.getByRole('link', { name: 'Voltar para o início' }));

      expect(document.title).toBe('Início · Sisto');
    });

    it('deslogado: 404 → início termina no login com "Entrar · Sisto"', async () => {
      renderizarApp('/uma-rota-qualquer');

      await usuario.click(screen.getByRole('link', { name: 'Voltar para o início' }));

      expect(document.title).toBe('Entrar · Sisto');
    });
  });

  describe('detalhe da ocorrência (RNF06)', () => {
    it('"Ocorrência nº 23 · Sisto", sem nome de estudante, mesmo depois de carregar os dados', async () => {
      sessao('GESTAO');
      mockarApi();
      renderizarApp('/ocorrencias/23');

      // Os dados (com nomes de estudantes) já estão na tela...
      expect(await screen.findByText(ESTUDANTE_A)).toBeInTheDocument();
      expect(screen.getByText(ESTUDANTE_B)).toBeInTheDocument();
      // ...e o título continua só com o número.
      expect(document.title).toBe('Ocorrência nº 23 · Sisto');
      for (const proibido of [
        ESTUDANTE_A,
        ESTUDANTE_B,
        'COD-FICT-001',
        '6º A',
        'Categoria Fictícia X',
        'Professor Fictício',
        NOME_USUARIO,
      ]) {
        expect(document.title).not.toContain(proibido);
      }
    });

    it('o título do detalhe já aparece enquanto os dados carregam', async () => {
      sessao('PROFESSOR');
      let liberar;
      mockarApi({
        detalhe: () =>
          new Promise((resolver) => {
            liberar = () => resolver(respostaFalsa(200, DETALHE_FICTICIO));
          }),
      });
      renderizarApp('/ocorrencias/23');

      expect(document.title).toBe('Ocorrência nº 23 · Sisto');

      await waitFor(() => expect(liberar).toBeTypeOf('function'));
      liberar();
      expect(await screen.findByText(ESTUDANTE_A)).toBeInTheDocument();
      expect(document.title).toBe('Ocorrência nº 23 · Sisto');
    });

    it('detalhe com 404 da API mantém só o número no título', async () => {
      sessao('GESTAO');
      mockarApi({ detalhe: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }) });
      renderizarApp('/ocorrencias/999');

      expect(await screen.findByText('Ocorrência não encontrada.')).toBeInTheDocument();
      expect(document.title).toBe('Ocorrência nº 999 · Sisto');
    });

    it('id não numérico na URL não vai para o título (RNF06)', async () => {
      sessao('GESTAO');
      mockarApi({ detalhe: () => respostaFalsa(404, { erro: 'Ocorrência não encontrada.' }) });
      renderizarApp('/ocorrencias/Pessoa%20Ficticia');

      expect(await screen.findByText('Ocorrência não encontrada.')).toBeInTheDocument();
      expect(document.title).toBe('Detalhe da ocorrência · Sisto');
      expect(document.title).not.toMatch(/Pessoa|Ficticia/);
    });
  });
});
