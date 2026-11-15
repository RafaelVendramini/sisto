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

  it('sem sessão, uma rota protegida leva à tela de login', () => {
    renderizarApp('/ocorrencias');

    expect(screen.getByRole('heading', { level: 1, name: 'Entrar no Sisto' })).toBeInTheDocument();
  });

  it('sem sessão, uma rota inexistente mostra a página não encontrada (#78)', () => {
    renderizarApp('/uma-rota-qualquer');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Página não encontrada' }),
    ).toBeInTheDocument();
  });

  it('com sessão, a tela de login redireciona para a área autenticada', () => {
    gravarSessaoFicticia();
    renderizarApp('/login');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Olá, Maria Fictícia' }),
    ).toBeInTheDocument();
  });

  it('a tela inicial orienta pelo menu, sem o texto provisório (#123)', () => {
    gravarSessaoFicticia();
    renderizarApp('/');

    expect(
      screen.getByText(/Use o menu acima para acessar o que o seu perfil permite\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/use o botão “Sair” no topo da página\./)).toBeInTheDocument();
    expect(screen.queryByText(/liberadas aos poucos/)).not.toBeInTheDocument();
  });
});
