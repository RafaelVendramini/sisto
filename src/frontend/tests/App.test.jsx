import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../src/App.jsx';

describe('App (componente raiz)', () => {
  it('renderiza o layout base com logo, conteúdo e rodapé', () => {
    render(<App />);

    expect(
      screen.getByRole('img', { name: /sisto — gestão de ocorrências escolares/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'EE José Carlos Nogueira Reverendo – Professor',
    );
  });

  it('exibe a página inicial em português', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Bem-vindo ao Sisto' }),
    ).toBeInTheDocument();
  });
});
