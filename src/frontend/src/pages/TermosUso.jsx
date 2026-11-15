import TextoLegal from '../components/TextoLegal.jsx';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { TERMOS_USO } from '../services/textosLegais.js';

/**
 * Termos de uso (#92, RNF02): página pública, aberta com ou sem sessão e
 * também com a troca de senha pendente (RN10), porque não chama a API nem
 * mostra dado pessoal. Sem aceite obrigatório. O texto fica em
 * services/textosLegais.js.
 */
export default function TermosUso() {
  useTituloPagina('Termos de uso');
  return <TextoLegal id="termos" documento={TERMOS_USO} />;
}
