import { Link, NavLink, useMatch } from 'react-router-dom';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';
import { linkTelefone, NOME_ESCOLA, TELEFONE_ESCOLA } from '../services/escola.js';
import {
  podeConsultarOcorrencias,
  podeGerenciarCategorias,
  podeGerenciarEstudantes,
  podeGerenciarTurmas,
  podeGerenciarUsuarios,
  podeRegistrarOcorrencia,
  rotuloPerfil,
} from '../services/perfis.js';
import { ROTA_PRIVACIDADE, ROTA_TERMOS } from '../services/rotasPublicas.js';
import { useSessao } from './Sessao.jsx';

// Layout base responsivo (RNF01): cabeçalho com a marca, área de conteúdo e rodapé.
// Com usuário logado, o cabeçalho mostra quem está usando, o menu e a opção "Sair" (RF02).
// O menu só mostra o que o perfil pode usar (RN01); a proteção real é do back-end.
// Com a troca de senha obrigatória pendente (RN10), o menu e o link da conta
// ficam ocultos: só é possível trocar a senha ou sair.
// O rodapé mostra o nome e o telefone da escola (sem endereço nem e-mail) e os
// links para a Política de privacidade e os Termos de uso (#92).
export default function Layout({ children }) {
  const { usuario, trocaSenhaPendente, sair } = useSessao();
  const veUsuarios = podeGerenciarUsuarios(usuario?.perfil);
  const veTurmas = podeGerenciarTurmas(usuario?.perfil);
  const veEstudantes = podeGerenciarEstudantes(usuario?.perfil);
  const veCategorias = podeGerenciarCategorias(usuario?.perfil);
  const veRegistroOcorrencia = podeRegistrarOcorrencia(usuario?.perfil);
  const veOcorrencias = podeConsultarOcorrencias(usuario?.perfil);
  // "Ocorrências" fica marcado na lista e no detalhe, mas não no registro,
  // que tem item próprio no menu.
  const noRegistro = Boolean(useMatch('/ocorrencias/nova'));

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
              {veOcorrencias && (
                <NavLink to="/ocorrencias" end={noRegistro} className="layout__menu-item">
                  Ocorrências
                </NavLink>
              )}
              {veRegistroOcorrencia && (
                <NavLink to="/ocorrencias/nova" className="layout__menu-item">
                  Registrar ocorrência
                </NavLink>
              )}
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
              {veEstudantes && (
                <NavLink to="/estudantes" className="layout__menu-item">
                  Estudantes
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
        <div className="layout__container layout__rodape-conteudo">
          <p className="layout__rodape-escola">
            {NOME_ESCOLA}
            <span className="layout__rodape-separador" aria-hidden="true">
              {' · '}
            </span>
            <span className="layout__rodape-telefone">
              Telefone: <a href={linkTelefone()}>{TELEFONE_ESCOLA}</a>
            </span>
          </p>
          <nav className="layout__rodape-links" aria-label="Informações legais">
            <Link to={ROTA_PRIVACIDADE}>Política de privacidade</Link>
            <Link to={ROTA_TERMOS}>Termos de uso</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
