import { rotuloPerfil } from '../services/perfis.js';
import { useSessao } from './Sessao.jsx';

// Layout base responsivo (RNF01): cabeçalho com a marca, área de conteúdo e rodapé.
// Com usuário logado, o cabeçalho mostra quem está usando e a opção "Sair" (RF02).
export default function Layout({ children }) {
  const { usuario, sair } = useSessao();

  return (
    <div className="layout">
      <header className="layout__cabecalho">
        <div className="layout__container layout__cabecalho-conteudo">
          <img
            className="layout__logo"
            src="/logo-sisto.svg"
            alt="Sisto — Gestão de ocorrências escolares"
          />
          {usuario && (
            <div className="layout__usuario">
              <span className="layout__usuario-nome">
                {usuario.nome}
                <span className="layout__usuario-perfil"> · {rotuloPerfil(usuario.perfil)}</span>
              </span>
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
