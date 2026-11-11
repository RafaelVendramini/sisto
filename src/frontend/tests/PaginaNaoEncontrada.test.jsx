// Fluxos da Issue #78 — página 404 própria (RNF01, RNF02): endereço
// inexistente mostra "Página não encontrada" dentro do layout, com link para o
// início, logado (cabeçalho e menu visíveis) e deslogado (o início leva ao
// login). Regressão: as rotas existentes continuam abrindo e "Acesso não
// permitido" continua aparecendo para o perfil sem permissão (RN01).
// API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { gravarSessaoFicticia, renderizarApp, respostaFalsa } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

const TITULO_404 = 'Página não encontrada';
const TITULO_ACESSO_NEGADO = 'Acesso não permitido';
const TITULO_LOGIN = 'Entrar no Sisto';

// Endereços que não correspondem a nenhuma tela (inclusive "filhos" de rotas existentes).
const ROTAS_INEXISTENTES = [
  '/uma-rota-qualquer',
  '/ocorrencias/12/editar',
  '/usuarios/1',
  '/pagina/que/nao/existe',
];

function sessao(perfil = 'GESTAO') {
  gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
}

/** Qualquer GET devolve lista vazia; o detalhe devolve uma ocorrência mínima fictícia. */
function mockarApiVazia() {
  fetch.mockImplementation(async (url, opcoes = {}) => {
    if (opcoes.method === 'GET' && /\/ocorrencias\/\d+$/.test(url)) {
      return respostaFalsa(200, {
        id: 12,
        dataHora: '2026-10-30T12:39:00.000Z',
        local: 'Pátio',
        turma: { id: 1, nome: '6º A', etapa: 'Ensino Fundamental - Anos Finais', anoLetivo: 2026 },
        categoria: { id: 5, nome: 'Categoria Fictícia X' },
        descricao: 'Descrição fictícia.',
        status: 'ABERTO',
        profissionalResponsavel: { id: 30, nome: 'Professor Fictício' },
        responsavelAcompanhamento: null,
        estudantes: [],
        encaminhamentos: [],
        comunicacoes: [],
        providencias: [],
      });
    }
    if (opcoes.method === 'GET') return respostaFalsa(200, []);
    throw new Error(`Chamada inesperada: ${opcoes.method} ${url}`);
  });
}

describe('Página não encontrada (#78)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    usuario = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('deslogado', () => {
    it.each(ROTAS_INEXISTENTES)('%s mostra a página não encontrada dentro do layout', (rota) => {
      renderizarApp(rota);

      expect(screen.getByRole('heading', { level: 1, name: TITULO_404 })).toBeInTheDocument();
      expect(
        screen.getByText('O endereço acessado não existe ou foi digitado errado.'),
      ).toBeInTheDocument();
      // Dentro do layout: cabeçalho com a marca, conteúdo e rodapé.
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent(
        TITULO_404,
      );
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
      // Sem sessão: nada de menu nem de "Sair".
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
      // Não chama a API.
      expect(fetch).not.toHaveBeenCalled();
    });

    it('o link "Voltar para o início" aponta para "/" e termina no login', async () => {
      renderizarApp('/uma-rota-qualquer');

      const link = screen.getByRole('link', { name: 'Voltar para o início' });
      expect(link).toHaveAttribute('href', '/');

      await usuario.click(link);

      expect(screen.getByRole('heading', { level: 1, name: TITULO_LOGIN })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
    });

    it('sessão com token expirado é tratada como deslogado (sem menu)', () => {
      gravarSessaoFicticia({ expiraEmSegundos: -60 });
      renderizarApp('/uma-rota-qualquer');

      expect(screen.getByRole('heading', { level: 1, name: TITULO_404 })).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(screen.queryByText('Maria Fictícia')).not.toBeInTheDocument();
    });
  });

  describe('logado', () => {
    it.each(PERFIS)('perfil %s: mostra a 404 com cabeçalho, menu e "Sair"', (perfil) => {
      sessao(perfil);
      renderizarApp('/uma-rota-qualquer');

      expect(screen.getByRole('heading', { level: 1, name: TITULO_404 })).toBeInTheDocument();
      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(menu).getByRole('link', { name: 'Início' })).toBeInTheDocument();
      expect(within(menu).getByRole('link', { name: 'Ocorrências' })).toBeInTheDocument();
      expect(screen.getByText('Pessoa Fictícia')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Alterar minha senha' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each(ROTAS_INEXISTENTES)('%s mostra a 404 (não redireciona ao início)', (rota) => {
      sessao();
      renderizarApp(rota);

      expect(screen.getByRole('heading', { level: 1, name: TITULO_404 })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Olá, Pessoa Fictícia' }),
      ).not.toBeInTheDocument();
    });

    it('o link "Voltar para o início" leva à página inicial', async () => {
      sessao('PROFESSOR');
      renderizarApp('/uma-rota-qualquer');

      const link = within(screen.getByRole('main')).getByRole('link', {
        name: 'Voltar para o início',
      });
      expect(link).toHaveAttribute('href', '/');

      await usuario.click(link);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Olá, Pessoa Fictícia' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
    });

    it('nenhum item do menu fica marcado como página atual na 404', () => {
      sessao();
      renderizarApp('/uma-rota-qualquer');

      const menu = screen.getByRole('navigation', { name: 'Menu principal' });
      for (const link of within(menu).getAllByRole('link')) {
        expect(link).not.toHaveAttribute('aria-current', 'page');
      }
    });

    it('"Sair" na 404 encerra a sessão e leva ao login', async () => {
      sessao();
      renderizarApp('/uma-rota-qualquer');

      await usuario.click(screen.getByRole('button', { name: 'Sair' }));

      expect(screen.getByRole('heading', { level: 1, name: TITULO_LOGIN })).toBeInTheDocument();
      expect(sessionStorage.getItem('sisto.sessao')).toBeNull();
    });
  });

  describe('regressão: rotas existentes (#78)', () => {
    it.each([
      ['/', 'Olá, Pessoa Fictícia'],
      ['/conta/senha', 'Alterar minha senha'],
      ['/ocorrencias', 'Ocorrências'],
      ['/ocorrencias/nova', 'Registrar ocorrência'],
      ['/usuarios', 'Usuários'],
      ['/turmas', 'Turmas'],
      ['/estudantes', 'Estudantes'],
      ['/categorias', 'Categorias de ocorrência'],
    ])('Gestão: %s continua abrindo a tela "%s"', async (rota, titulo) => {
      sessao('GESTAO');
      mockarApiVazia();
      renderizarApp(rota);

      expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_ACESSO_NEGADO })).not.toBeInTheDocument();
    });

    it('Gestão: /ocorrencias/12 continua abrindo o detalhe (não cai na 404)', async () => {
      sessao('GESTAO');
      mockarApiVazia();
      renderizarApp('/ocorrencias/12');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Ocorrência nº 12' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
    });

    it('deslogado: rota protegida existente continua levando ao login (não à 404)', () => {
      renderizarApp('/usuarios');

      expect(screen.getByRole('heading', { level: 1, name: TITULO_LOGIN })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
    });

    it.each([
      ['PROFESSOR', '/usuarios'],
      ['PROFESSOR', '/turmas'],
      ['PROFESSOR', '/estudantes'],
      ['PROFESSOR', '/categorias'],
      ['TUTOR', '/usuarios'],
      ['TUTOR', '/categorias'],
      ['PEDAGOGICO', '/usuarios'],
      ['PEDAGOGICO', '/estudantes'],
      ['TECNICO_ADMINISTRATIVO', '/turmas'],
      ['TECNICO_ADMINISTRATIVO', '/categorias'],
    ])('%s em %s continua vendo "Acesso não permitido" (RN01)', (perfil, rota) => {
      sessao(perfil);
      renderizarApp(rota);

      expect(
        screen.getByRole('heading', { level: 1, name: TITULO_ACESSO_NEGADO }),
      ).toBeInTheDocument();
      expect(screen.getByText('Esta página não está disponível para o seu perfil.')).toBeInTheDocument();
      expect(
        within(screen.getByRole('main')).getByRole('link', { name: 'Voltar para o início' }),
      ).toHaveAttribute('href', '/');
      expect(screen.queryByRole('heading', { name: TITULO_404 })).not.toBeInTheDocument();
      // A tela restrita não chega a carregar dados.
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
