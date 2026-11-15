import { useSessao } from '../components/Sessao.jsx';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { rotuloPerfil } from '../services/perfis.js';

// Página inicial da área autenticada (Issue #14). O texto de orientação foi
// atualizado para o MVP 1.0 na Issue #123: o menu mostra só o que o perfil
// pode usar.
export default function Inicio() {
  useTituloPagina('Início');
  const { usuario } = useSessao();

  return (
    <section className="cartao">
      <h1>Olá, {usuario.nome}</h1>
      <p>
        Você entrou no Sisto com o perfil <strong>{rotuloPerfil(usuario.perfil)}</strong>.
      </p>
      <p className="texto-secundario">
        Use o menu acima para acessar o que o seu perfil permite.
        Para encerrar o acesso, use o botão “Sair” no topo da página.
      </p>
    </section>
  );
}
