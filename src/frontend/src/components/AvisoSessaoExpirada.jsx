import { estaAutenticado } from '../services/auth.js';
import { useSessao } from './Sessao.jsx';

export const MENSAGEM_SESSAO_EXPIRADA_FORMULARIO =
  'Sua sessão expirou. Copie o texto que você escreveu, se precisar, e entre novamente.';

/**
 * Confere, ANTES de enviar um formulário com texto livre, se a sessão ainda é
 * válida (token de 8h — RNF03). Se venceu, quem chama não envia nem limpa o
 * formulário e mostra o <AvisoSessaoExpirada> (#128). Nada do que foi
 * digitado é guardado no navegador (LGPD).
 * @returns {boolean} true se a sessão venceu
 */
export function sessaoExpirou() {
  return !estaAutenticado();
}

/**
 * Aviso de sessão vencida dentro de um formulário: o que foi digitado continua
 * na tela para a pessoa copiar; o botão leva ao login, que depois volta a esta
 * tela (state.de).
 * @param {object} props
 * @param {string} [props.id]
 */
export default function AvisoSessaoExpirada({ id }) {
  const { voltarAoLogin } = useSessao();
  return (
    <div id={id} className="mensagem mensagem--erro" role="alert">
      <p>{MENSAGEM_SESSAO_EXPIRADA_FORMULARIO}</p>
      <button type="button" className="botao botao--secundario" onClick={voltarAoLogin}>
        Entrar novamente
      </button>
    </div>
  );
}
