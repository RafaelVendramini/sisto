// Utilitários de teste. Somente dados fictícios (RN05 / LGPD).
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';

export const CHAVE_SESSAO = 'sisto.sessao';

export const USUARIO_FICTICIO = Object.freeze({
  id: 1,
  nome: 'Maria Fictícia',
  perfil: 'GESTAO',
});

function base64url(objeto) {
  return btoa(JSON.stringify(objeto)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Gera um JWT fictício (assinatura falsa) com expiração relativa a agora. */
export function tokenFicticio({ expiraEmSegundos = 8 * 60 * 60 } = {}) {
  const exp = Math.floor(Date.now() / 1000) + expiraEmSegundos;
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: 1, exp })}.assinatura-ficticia`;
}

export function gravarSessaoFicticia(opcoes) {
  const token = tokenFicticio(opcoes);
  sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ token, usuario: USUARIO_FICTICIO }));
  return token;
}

export function respostaFalsa(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
  };
}

export function renderizarApp(rota = '/') {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>,
  );
}
