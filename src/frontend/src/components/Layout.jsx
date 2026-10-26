import { NavLink } from 'react-router-dom';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';
import {
  podeGerenciarCategorias,
  podeGerenciarTurmas,
  podeGerenciarUsuarios,
  rotuloPerfil,
} from '../services/perfis.js';
import { useSessao } from './Sessao.jsx';

// Layout base responsivo (RNF01): cabeçalho com a marca, área de conteúdo e rodapé.
// Com usuário logado, o cabeçalho mostra quem está usando, o menu e a opção "Sair" (RF02).
// O menu só mostra o que o perfil pode usar (RN01); a proteção real é do back-end.
// Com a troca de senha obrigatória pendente (RN10), o menu e o link da conta
// ficam ocultos: só é possível trocar a senha ou sair.
export default function Layout({ children }) {
  const { usuario, trocaSenhaPendente, sair } = useSessao();
  const veUsuarios = podeGerenciarUsuarios(usuario?.perfil);
  const veTurmas = podeGerenciarTurmas(usuario?.perfil);
  const veCategorias = podeGerenciarCategorias(usuario?.perfil);

  return (
    <div className="layout">
      <header className="layout__cabecalho">
        <div className="layout__container layout__cabecalho-conteudo">
          <img
            className="layout__logo"
            src="/logo-sisto.svg"
            alt="Sisto — Gestão de ocorrências escolares"
          />
          {usuario && !trocaSenhaPendente && (
            <nav className="layout__menu" aria-label="Menu principal">
              <NavLink to="/" end className="layout__menu-item">
                Início
              </NavLink>
              {veUsuarios && (
                <NavLink to="/usuarios" className="layout__menu-item">
                  Usuários
                </NavLink>
              )}
              {veTurmas && (
                <NavLink to="/turmas" className="layout__menu-item">
                  Turmas
                </NavLink>
              )}
              {veCategorias && (
                <NavLink to="/categorias" className="layout__menu-item">
                  Categorias
                </NavLink>
              )}
            </nav>
          )}
          {usuario && (
            <div className="layout__usuario">
              <span className="layout__usuario-nome">
                {usuario.nome}
                <span className="layout__usuario-perfil"> · {rotuloPerfil(usuario.perfil)}</span>
              </span>
              {!trocaSenhaPendente && (
                <NavLink to={ROTA_ALTERAR_SENHA} className="layout__menu-item layout__conta">
                  Alterar minha senha
                </NavLink>
              )}
              <button type="button" className="botao botao--secundario" onClick={sair}>
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="layout__principal">
        <div className="layout__container">{children}</div>
      </main>

      <footer className="layout__rodape">
        <div className="layout__container">
          EE José Carlos Nogueira Reverendo – Professor
        </div>
      </footer>
    </div>
  );
}
