import { Link, Outlet } from 'react-router-dom';
import { useSessao } from './Sessao.jsx';
import { useTituloPagina } from './useTituloPagina.js';

/**
 * Bloco exibido a quem não tem o perfil exigido. É um componente à parte
 * para que o título da aba seja definido sem chamar hook condicionalmente.
 */
function AcessoNaoPermitido() {
  useTituloPagina('Acesso não permitido');

  return (
    <section className="cartao" aria-labelledby="titulo-acesso-negado">
      <h1 id="titulo-acesso-negado">Acesso não permitido</h1>
      <p>Esta página não está disponível para o seu perfil.</p>
      <p>
        <Link to="/">Voltar para o início</Link>
      </p>
    </section>
  );
}

/**
 * Restringe páginas a determinados perfis (RN01, matriz da Seção 4).
 * Deve ficar dentro de <RotaProtegida>, que já garante a sessão.
 * Quem não tem o perfil vê uma mensagem clara, com link para o início.
 * Isto é só usabilidade: a proteção real é do back-end (403).
 * @param {{ perfis: string[] }} props - valores técnicos permitidos (ex.: ['GESTAO'])
 */
export default function RotaPorPerfil({ perfis }) {
  const { usuario } = useSessao();

  if (!usuario || !perfis.includes(usuario.perfil)) {
    return <AcessoNaoPermitido />;
  }

  return <Outlet />;
}
