// Fluxos da Issue #92 — Política de privacidade, Termos de uso e contato da
// escola no rodapé (RNF01, RNF02, RNF06). As páginas são públicas (logado ou
// não), mostram o aviso de texto provisório e os trechos "[A DEFINIR PELA
// ESCOLA]" destacados, com o conteúdo vindo de services/textosLegais.js.
// O rodapé mostra só o nome e o telefone da escola (sem endereço nem e-mail).
// Não há aceite de termos. API mockada, sem rede. Somente dados fictícios (RN05 / LGPD).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TextoLegal from '../src/components/TextoLegal.jsx';
import { NOME_ESCOLA, TELEFONE_ESCOLA, linkTelefone } from '../src/services/escola.js';
import {
  AVISO_TEXTO_PROVISORIO,
  MARCADOR_A_DEFINIR,
  POLITICA_PRIVACIDADE,
  TERMOS_USO,
} from '../src/services/textosLegais.js';
import { CHAVE_SESSAO, gravarSessaoFicticia, renderizarApp, tokenFicticio } from './utilitarios.jsx';

const URL_API = 'http://api.exemplo.test';
const PERFIS = ['PROFESSOR', 'TUTOR', 'GESTAO', 'PEDAGOGICO', 'TECNICO_ADMINISTRATIVO'];

const PAGINAS = [
  {
    rota: '/privacidade',
    link: 'Política de privacidade',
    titulo: 'Política de privacidade · Sisto',
    documento: POLITICA_PRIVACIDADE,
  },
  {
    rota: '/termos',
    link: 'Termos de uso',
    titulo: 'Termos de uso · Sisto',
    documento: TERMOS_USO,
  },
];

/** Texto puro de um bloco do arquivo de conteúdo (sem a marcação de negrito). */
function semMarcacao(texto) {
  return texto.replace(/\*\*/g, '');
}

function textosDoDocumento(documento) {
  return documento.secoes.flatMap((secao) =>
    secao.blocos.flatMap((bloco) => (typeof bloco === 'string' ? [bloco] : bloco.lista)),
  );
}

/** Trechos "[A DEFINIR PELA ESCOLA...]" previstos no arquivo de conteúdo. */
function trechosADefinir(documento) {
  const todos = [documento.nota, ...textosDoDocumento(documento)].join('\n');
  return [...todos.matchAll(/\*\*(\[A DEFINIR PELA ESCOLA[^*]*)\*\*/g)].map((m) => m[1]);
}

/** Confere a página inteira contra o arquivo de conteúdo. */
function conferirPagina({ documento }) {
  const principal = screen.getByRole('main');
  // Aviso no topo, antes do título.
  const aviso = within(principal).getByText(AVISO_TEXTO_PROVISORIO);
  const titulo = within(principal).getByRole('heading', { level: 1, name: documento.titulo });
  expect(aviso.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // Uma seção (h2) por item do arquivo de conteúdo, na mesma ordem.
  const subtitulos = within(principal)
    .getAllByRole('heading', { level: 2 })
    .map((h) => h.textContent);
  expect(subtitulos).toEqual(documento.secoes.map((secao) => secao.titulo));

  // Todo o texto do arquivo aparece na página.
  const textoPagina = principal.textContent;
  for (const texto of textosDoDocumento(documento)) {
    expect(textoPagina).toContain(semMarcacao(texto));
  }

  // Trechos "[A DEFINIR PELA ESCOLA]" visíveis e destacados (<mark>).
  const esperados = trechosADefinir(documento);
  expect(esperados.length).toBeGreaterThan(0);
  const destacados = principal.querySelectorAll('mark.texto-legal__a-definir');
  expect([...destacados].map((m) => m.textContent)).toEqual(esperados);
  for (const marca of destacados) {
    expect(marca.textContent.startsWith(MARCADOR_A_DEFINIR)).toBe(true);
  }

  // Sem aceite de termos: nenhum formulário, caixa de seleção ou botão na página.
  expect(principal.querySelector('form')).toBeNull();
  expect(within(principal).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(principal).queryByRole('button')).not.toBeInTheDocument();
}

describe('Política de privacidade e Termos de uso (#92)', () => {
  let usuario;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubEnv('VITE_API_URL', URL_API);
    vi.stubGlobal('fetch', vi.fn());
    document.title = 'título anterior (teste)';
    usuario = userEvent.setup();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe.each(PAGINAS)('$rota', (pagina) => {
    it('abre deslogado, dentro do layout, com aviso, conteúdo e título da aba', () => {
      renderizarApp(pagina.rota);

      conferirPagina(pagina);
      expect(document.title).toBe(pagina.titulo);
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Entrar no Sisto' })).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sessão com token expirado é tratada como deslogado e a página abre', () => {
      gravarSessaoFicticia({ expiraEmSegundos: -60 });
      renderizarApp(pagina.rota);

      conferirPagina(pagina);
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
    });

    it.each(PERFIS)('abre logado (perfil %s), com cabeçalho e menu', (perfil) => {
      gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil } });
      renderizarApp(pagina.rota);

      conferirPagina(pagina);
      expect(document.title).toBe(pagina.titulo);
      expect(screen.getByRole('navigation', { name: 'Menu principal' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('com troca de senha pendente (RN10), abre sem menu e sem redirecionar', () => {
      sessionStorage.setItem(
        CHAVE_SESSAO,
        JSON.stringify({
          token: tokenFicticio(),
          usuario: { id: 9, nome: 'Pessoa Fictícia', perfil: 'PROFESSOR' },
          trocaSenhaObrigatoria: true,
        }),
      );
      renderizarApp(pagina.rota);

      conferirPagina(pagina);
      expect(screen.queryByRole('navigation', { name: 'Menu principal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Alterar minha senha' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('rodapé', () => {
    it.each(['/login', '/privacidade', '/uma-rota-qualquer'])(
      'em %s mostra o nome da escola e somente o telefone, sem e-mail nem endereço',
      (rota) => {
        renderizarApp(rota);

        const rodape = screen.getByRole('contentinfo');
        expect(rodape).toHaveTextContent(NOME_ESCOLA);
        expect(rodape).toHaveTextContent('(19) 3245-1266');
        const telefone = within(rodape).getByRole('link', { name: '(19) 3245-1266' });
        expect(telefone).toHaveAttribute('href', 'tel:+551932451266');
        // Sem e-mail e sem endereço.
        expect(rodape.textContent).not.toMatch(/@/);
        expect(rodape.querySelector('a[href^="mailto:"]')).toBeNull();
        expect(rodape.textContent).not.toMatch(/(^|\s)(rua|avenida|av\.|cep|endereço|bairro)(\s|$)/i);
        expect(rodape.textContent).not.toMatch(/\d{5}-\d{3}/); // formato de CEP
      },
    );

    it('logado, o rodapé também mostra nome e telefone', () => {
      gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil: 'GESTAO' } });
      renderizarApp('/privacidade');

      const rodape = screen.getByRole('contentinfo');
      expect(rodape).toHaveTextContent(NOME_ESCOLA);
      expect(within(rodape).getByRole('link', { name: '(19) 3245-1266' })).toBeInTheDocument();
    });

    it('o telefone vem do ponto único de configuração', () => {
      expect(TELEFONE_ESCOLA).toBe('(19) 3245-1266');
      expect(linkTelefone()).toBe('tel:+551932451266');
      renderizarApp('/login');
      expect(
        within(screen.getByRole('contentinfo')).getByRole('link', { name: TELEFONE_ESCOLA }),
      ).toHaveAttribute('href', linkTelefone());
    });

    it.each(PAGINAS)('deslogado: o link "$link" do rodapé abre a página', async (pagina) => {
      renderizarApp('/login');

      const links = screen.getByRole('navigation', { name: 'Informações legais' });
      const link = within(links).getByRole('link', { name: pagina.link });
      expect(link).toHaveAttribute('href', pagina.rota);

      await usuario.click(link);

      conferirPagina(pagina);
      expect(document.title).toBe(pagina.titulo);
    });

    it.each(PAGINAS)('logado: o link "$link" do rodapé abre a página', async (pagina) => {
      gravarSessaoFicticia({ usuario: { id: 9, nome: 'Pessoa Fictícia', perfil: 'GESTAO' } });
      renderizarApp('/uma-rota-qualquer');

      const links = screen.getByRole('navigation', { name: 'Informações legais' });
      await usuario.click(within(links).getByRole('link', { name: pagina.link }));

      conferirPagina(pagina);
    });
  });

  describe('tela de login', () => {
    it.each(PAGINAS)('tem o link "$link", que abre a página', async (pagina) => {
      renderizarApp('/login');

      const login = screen
        .getByRole('heading', { level: 1, name: 'Entrar no Sisto' })
        .closest('section');
      const links = within(login).getByRole('navigation', { name: 'Textos legais' });
      const link = within(links).getByRole('link', { name: pagina.link });
      expect(link).toHaveAttribute('href', pagina.rota);

      await usuario.click(link);

      conferirPagina(pagina);
      expect(document.title).toBe(pagina.titulo);
    });

    it('não pede aceite dos termos (sem caixa de seleção nem campo extra)', () => {
      renderizarApp('/login');

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/aceito|concordo/i)).not.toBeInTheDocument();
    });
  });
});

describe('TextoLegal (componente)', () => {
  afterEach(() => {
    cleanup();
  });

  it('apresenta o documento recebido, sem texto fixo além do aviso', () => {
    render(
      <TextoLegal
        id="ficticio"
        documento={{
          titulo: 'Documento Fictício',
          nota: 'Nota fictícia.',
          secoes: [
            {
              titulo: '1. Seção fictícia',
              blocos: [
                'Parágrafo com **negrito** e **[A DEFINIR PELA ESCOLA: item fictício.]**',
                { lista: ['Item fictício A', 'Item fictício B'] },
              ],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(AVISO_TEXTO_PROVISORIO)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Documento Fictício' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '1. Seção fictícia' })).toBeInTheDocument();
    expect(screen.getByText('negrito').tagName).toBe('STRONG');
    expect(
      screen.getByText('[A DEFINIR PELA ESCOLA: item fictício.]').closest('mark'),
    ).toHaveClass('texto-legal__a-definir');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Item fictício A',
      'Item fictício B',
    ]);
    // Seção com nome acessível (landmark region).
    expect(screen.getByRole('region', { name: '1. Seção fictícia' })).toBeInTheDocument();
  });
});
