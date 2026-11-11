import { Link, Navigate } from 'react-router-dom';
import { useSessao } from '../components/Sessao.jsx';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { ROTA_ALTERAR_SENHA } from '../services/conta.js';

/**
 * Página 404: endereço que não corresponde a nenhuma tela do Sisto.
 * Fica dentro do layout, fora de <RotaProtegida>: quem está logado vê o
 * cabeçalho e o menu; quem não está volta ao início, que leva ao login.
 * Com a troca de senha obrigatória pendente (RN10), segue a regra de
 * <RotaProtegida>: só a tela de troca abre.
 */
export default function PaginaNaoEncontrada() {
  const { trocaSenhaPendente } = useSessao();
  useTituloPagina('Página não encontrada');

  if (trocaSenhaPendente) {
    return <Navigate to={ROTA_ALTERAR_SENHA} replace />;
  }

  return (
    <section className="cartao" aria-labelledby="titulo-pagina-nao-encontrada">
      <h1 id="titulo-pagina-nao-encontrada">Página não encontrada</h1>
      <p>O endereço acessado não existe ou foi digitado errado.</p>
      <p>
        <Link to="/">Voltar para o início</Link>
      </p>
    </section>
  );
}
