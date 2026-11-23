import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { estaAutenticado } from '../services/auth.js';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';
import { estadoVoltarPara } from '../services/destinoLogin.js';
import { useSessao } from './Sessao.jsx';

// Páginas autenticadas: sem sessão válida, volta para o login (RNF03),
// guardando a tela de origem (caminho + busca) para voltar a ela (#128).
// Com a troca de senha obrigatória pendente (RN10), só a tela de troca abre.
// Esconder telas no front-end é só usabilidade; a proteção real é do back-end.
export default function RotaProtegida() {
  const { usuario, trocaSenhaPendente, saiuDaConta, limparSessao } = useSessao();
  const location = useLocation();
  const sessaoValida = Boolean(usuario) && estaAutenticado();
  // Havia usuário em memória, mas o token expirou (8h, RNF03) ou foi descartado.
  const sessaoPerdida = Boolean(usuario) && !sessaoValida;

  useEffect(() => {
    if (sessaoPerdida) limparSessao(true);
  }, [sessaoPerdida, limparSessao]);

  if (!sessaoValida) {
    // Depois de "Sair" (ou de trocar a senha), o próximo login vai para "Início".
    const estado = saiuDaConta ? undefined : estadoVoltarPara(location);
    return <Navigate to="/login" replace state={estado} />;
  }

  if (trocaSenhaPendente && location.pathname !== ROTA_ALTERAR_SENHA) {
    return <Navigate to={ROTA_ALTERAR_SENHA} replace />;
  }

  return <Outlet />;
}
