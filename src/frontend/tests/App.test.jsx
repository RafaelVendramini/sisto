import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { gravarSessaoFicticia, renderizarApp } from './utilitarios.jsx';

describe('App (componente raiz)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renderiza o layout base com logo, conteúdo e rodapé', () => {
    renderizarApp('/login');

    expect(
      screen.getByRole('img', { name: /sisto — gestão de ocorrências escolares/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'EE José Carlos Nogueira Reverendo – Professor',
    );
  });

  it('sem sessão, qualquer rota leva à tela de login', () => {
    renderizarApp('/uma-rota-qualquer');

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
  });

  it('com sessão, a tela de login redireciona para a área autenticada', () => {
    gravarSessaoFicticia();
    renderizarApp('/login');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
    ).toBeInTheDocument();
  });
});
