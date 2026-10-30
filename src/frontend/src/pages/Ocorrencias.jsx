import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ListaOcorrencias from '../components/ListaOcorrencias.jsx';
import { mensagemErroListaOcorrencias } from '../services/mensagensOcorrencias.js';
import { listarOcorrencias } from '../services/ocorrencias.js';

// Ocorrências (UC03, RF05, RN19): lista somente leitura das ocorrências que o
// usuário pode ver, da mais recente para a mais antiga. Disponível aos 5
// perfis; a visibilidade é decidida pelo back-end. Sem filtros nesta versão
// (o RF11 é da Sprint 3).
export default function Ocorrencias() {
  const [ocorrencias, setOcorrencias] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarOcorrencias();
      if (montado.current) setOcorrencias(lista);
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && falha?.status !== 401) setErro(mensagemErroListaOcorrencias(falha));
    } finally {
      if (montado.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="pagina-ocorrencia">
      <div className="pagina-ocorrencia__cabecalho">
        <h1>Ocorrências</h1>
        <Link to="/ocorrencias/nova" className="botao botao--primario">
          Registrar ocorrência
        </Link>
      </div>
      <p className="texto-secundario">
        Ocorrências que você pode consultar, da mais recente para a mais antiga. Escolha uma para
        ver todos os detalhes.
      </p>

      <ListaOcorrencias
        ocorrencias={ocorrencias}
        carregando={carregando}
        erro={erro}
        aoTentarNovamente={carregar}
      />
    </div>
  );
}
