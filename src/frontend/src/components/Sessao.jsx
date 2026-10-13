import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { definirAoNaoAutenticado } from '../services/api.js';
import * as auth from '../services/auth.js';

export const AVISO_SESSAO_ENCERRADA =
  'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';

const SessaoContexto = createContext(null);

/**
 * Mantém o usuário logado disponível para toda a aplicação e concentra
 * o tratamento de sessão inválida: qualquer 401 de chamada autenticada
 * descarta a sessão e volta ao login com um aviso (RNF03, RN09).
 */
export function SessaoProvider({ children }) {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState(() => auth.obterUsuario());
  // Aviso exibido na tela de login quando a sessão foi encerrada pelo sistema.
  const [aviso, setAviso] = useState('');

  const entrar = useCallback(async (email, senha) => {
    const logado = await auth.login(email, senha);
    setAviso('');
    setUsuario(logado);
    return logado;
  }, []);

  // Descarta token e dados do usuário (não há endpoint de logout — Seção 12).
  // Com `avisar`, a tela de login explica que a sessão expirou/foi encerrada.
  const limparSessao = useCallback((avisar = false) => {
    auth.logout();
    setUsuario(null);
    setAviso(avisar ? AVISO_SESSAO_ENCERRADA : '');
  }, []);

  const sair = useCallback(() => {
    limparSessao(false);
    navigate('/login', { replace: true });
  }, [limparSessao, navigate]);

  useEffect(() => {
    return definirAoNaoAutenticado(() => {
      limparSessao(true);
      navigate('/login', { replace: true });
    });
  }, [limparSessao, navigate]);

  const valor = useMemo(
    () => ({ usuario, aviso, entrar, sair, limparSessao }),
    [usuario, aviso, entrar, sair, limparSessao],
  );

  return <SessaoContexto.Provider value={valor}>{children}</SessaoContexto.Provider>;
}

export function useSessao() {
  const contexto = useContext(SessaoContexto);
  if (!contexto) {
    throw new Error('useSessao deve ser usado dentro de <SessaoProvider>.');
  }
  return contexto;
}
