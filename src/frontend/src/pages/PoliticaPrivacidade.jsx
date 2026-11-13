import TextoLegal from '../components/TextoLegal.jsx';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { POLITICA_PRIVACIDADE } from '../services/textosLegais.js';

/**
 * Política de privacidade (#92, RNF02, RNF06): página pública, aberta com ou
 * sem sessão e também com a troca de senha pendente (RN10), porque não chama a
 * API nem mostra dado pessoal. O texto fica em services/textosLegais.js.
 */
export default function PoliticaPrivacidade() {
  useTituloPagina('Política de privacidade');
  return <TextoLegal id="privacidade" documento={POLITICA_PRIVACIDADE} />;
}
