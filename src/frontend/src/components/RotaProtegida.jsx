import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { estaAutenticado } from '../services/auth.js';
import { useSessao } from './Sessao.jsx';

// Páginas autenticadas: sem sessão válida, volta para o login (RNF03).
// Esconder telas no front-end é só usabilidade; a proteção real é do back-end.
export default function RotaProtegida() {
  const { usuario, limparSessao } = useSessao();
  const location = useLocation();
  const sessaoValida = Boolean(usuario) && estaAutenticado();
  // Havia usuário em memória, mas o token expirou (8h, RNF03) ou foi descartado.
  const sessaoPerdida = Boolean(usuario) && !sessaoValida;

  useEffect(() => {
    if (sessaoPerdida) limparSessao(true);
  }, [sessaoPerdida, limparSessao]);

  if (!sessaoValida) {
    return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  }

  return <Outlet />;
}
