import { useSessao } from '../components/Sessao.jsx';
import { rotuloPerfil } from '../services/perfis.js';

// Página inicial da área autenticada (placeholder da Sprint 1 — Issue #14).
export default function Inicio() {
  const { usuario } = useSessao();

  return (
    <section className="cartao">
      <h1>Olá, {usuario.nome}</h1>
      <p>
        Você entrou no Sisto com o perfil <strong>{rotuloPerfil(usuario.perfil)}</strong>.
      </p>
      <p className="texto-secundario">
        As funcionalidades do sistema serão liberadas aos poucos nesta área.
        Para encerrar o acesso, use o botão “Sair” no topo da página.
      </p>
    </section>
  );
}
