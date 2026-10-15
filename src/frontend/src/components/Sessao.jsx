import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { definirAoNaoAutenticado, definirAoTrocaSenhaPendente } from '../services/api.js';
import * as auth from '../services/auth.js';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';

export const AVISO_SESSAO_ENCERRADA =
  'Sua sessão expirou ou seu acesso foi encerrado. Entre novamente.';
export const MENSAGEM_SENHA_ALTERADA = 'Senha alterada. Entre com a nova senha.';

const SessaoContexto = createContext(null);

/**
 * Mantém o usuário logado disponível para toda a aplicação e concentra
 * o tratamento de sessão inválida: qualquer 401 de chamada autenticada
 * descarta a sessão e volta ao login com um aviso (RNF03, RN09).
 * Também concentra a troca de senha obrigatória (RN10): enquanto ela estiver
 * pendente, o app só mostra a tela de troca; o 403 de troca pendente vindo
 * de qualquer chamada leva a essa tela.
 */
export function SessaoProvider({ children }) {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState(() => auth.obterUsuario());
  const [trocaSenhaPendente, setTrocaSenhaPendente] = useState(() => auth.trocaSenhaPendente());
  // Aviso exibido na tela de login quando a sessão foi encerrada pelo sistema.
  const [aviso, setAviso] = useState('');
  // Confirmação exibida na tela de login (ex.: depois de trocar a senha — RN12).
  const [sucesso, setSucesso] = useState('');

  const entrar = useCallback(async (email, senha) => {
    const logado = await auth.login(email, senha);
    const pendente = auth.trocaSenhaPendente();
    setAviso('');
    setSucesso('');
    setUsuario(logado);
    setTrocaSenhaPendente(pendente);
    return { usuario: logado, trocaSenhaObrigatoria: pendente };
  }, []);

  // Descarta token e dados do usuário (não há endpoint de logout — Seção 12).
  // Com `avisar`, a tela de login explica que a sessão expirou/foi encerrada.
  const limparSessao = useCallback((avisar = false) => {
    auth.logout();
    setUsuario(null);
    setTrocaSenhaPendente(false);
    setAviso(avisar ? AVISO_SESSAO_ENCERRADA : '');
    setSucesso('');
  }, []);

  // Reflete na hora (ex.: cabeçalho) a edição do próprio nome pela Gestão.
  const atualizarNomeUsuario = useCallback((nome) => {
    const atualizado = auth.atualizarNomeNaSessao(nome);
    if (atualizado) setUsuario(atualizado);
  }, []);

  const sair = useCallback(() => {
    limparSessao(false);
    navigate('/login', { replace: true });
  }, [limparSessao, navigate]);

  // Depois de trocar a própria senha, o token atual deixa de valer (RN12):
  // a sessão local é descartada e o usuário entra de novo com a nova senha.
  const concluirTrocaSenha = useCallback(() => {
    limparSessao(false);
    setSucesso(MENSAGEM_SENHA_ALTERADA);
    navigate('/login', { replace: true });
  }, [limparSessao, navigate]);

  useEffect(() => {
    return definirAoNaoAutenticado(() => {
      limparSessao(true);
      navigate('/login', { replace: true });
    });
  }, [limparSessao, navigate]);

  useEffect(() => {
    return definirAoTrocaSenhaPendente(() => {
      if (!auth.marcarTrocaSenhaPendente()) return;
      setTrocaSenhaPendente(true);
      navigate(ROTA_ALTERAR_SENHA, { replace: true });
    });
  }, [navigate]);

  const valor = useMemo(
    () => ({
      usuario,
      trocaSenhaPendente,
      aviso,
      sucesso,
      entrar,
      sair,
      limparSessao,
      atualizarNomeUsuario,
      concluirTrocaSenha,
    }),
    [
      usuario,
      trocaSenhaPendente,
      aviso,
      sucesso,
      entrar,
      sair,
      limparSessao,
      atualizarNomeUsuario,
      concluirTrocaSenha,
    ],
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
