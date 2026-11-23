import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import FiltrosOcorrencias from '../components/FiltrosOcorrencias.jsx';
import ListaOcorrencias from '../components/ListaOcorrencias.jsx';
import PaginacaoOcorrencias from '../components/PaginacaoOcorrencias.jsx';
import { useSessao } from '../components/Sessao.jsx';
import { exibirFalha, useCarregamento } from '../components/useCarregamento.js';
import { useTituloPagina } from '../components/useTituloPagina.js';
import { listarCategorias } from '../services/categorias.js';
import {
  contarFiltrosAtivos,
  filtrosParaApi,
  lerBuscaOcorrencias,
  montarBuscaOcorrencias,
  textoTotalOcorrencias,
  totalDePaginas,
} from '../services/filtrosOcorrencias.js';
import {
  MENSAGEM_SEM_OCORRENCIAS,
  MENSAGEM_SEM_OCORRENCIAS_FILTRO,
  mensagemErroListaOcorrencias,
} from '../services/mensagensOcorrencias.js';
import { TAMANHO_PAGINA_OCORRENCIAS, listarOcorrencias } from '../services/ocorrencias.js';
import { podeFiltrarPorProfissional } from '../services/perfis.js';
import { listarTurmas } from '../services/turmas.js';
import { listarUsuarios } from '../services/usuarios.js';

const RESULTADO_VAZIO = Object.freeze({
  itens: [],
  total: 0,
  pagina: 1,
  tamanhoPagina: TAMANHO_PAGINA_OCORRENCIAS,
});

// Ocorrências (UC03, RF05, RF11, RN19): lista somente leitura das ocorrências
// que o usuário pode ver, da mais recente para a mais antiga, com filtros e
// paginação (Issue #87; API da #86, 20 por página). Disponível aos 5 perfis;
// a visibilidade é decidida pelo back-end e os filtros nunca a ampliam.
// Os filtros aplicados e a página ficam na query string (/ocorrencias?...):
// voltar do detalhe preserva a busca. As listas de apoio (turmas, categorias
// e, só para a Gestão, usuários) carregam com Promise.allSettled: se uma
// falhar, os demais filtros continuam.
export default function Ocorrencias() {
  useTituloPagina('Ocorrências');
  const { usuario } = useSessao();
  const verProfissional = podeFiltrarPorProfissional(usuario?.perfil);

  const [searchParams, setSearchParams] = useSearchParams();
  const busca = searchParams.toString();
  const { filtros: filtrosAplicados, pagina } = useMemo(
    () =>
      lerBuscaOcorrencias(new URLSearchParams(busca), { permitirProfissional: verProfissional }),
    [busca, verProfissional],
  );

  const [resultado, setResultado] = useState(RESULTADO_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [apoio, setApoio] = useState({
    turmas: [],
    categorias: [],
    profissionais: [],
    falhas: {},
  });

  // Só a resposta da busca mais recente vale (troca rápida de página/filtro).
  const { novaRequisicao } = useCarregamento();
  const focarResultado = useRef(false);
  const refResumo = useRef(null);

  useEffect(() => {
    let ativo = true;
    Promise.allSettled([
      listarTurmas(),
      listarCategorias(),
      verProfissional ? listarUsuarios() : Promise.resolve([]),
    ]).then(([turmas, categorias, profissionais]) => {
      if (!ativo) return;
      const valor = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
      setApoio({
        turmas: valor(turmas),
        categorias: valor(categorias),
        profissionais: valor(profissionais),
        falhas: {
          turmas: turmas.status === 'rejected',
          categorias: categorias.status === 'rejected',
          profissionais: profissionais.status === 'rejected',
        },
      });
    });
    return () => {
      ativo = false;
    };
  }, [verProfissional]);

  const carregar = useCallback(async () => {
    const vigente = novaRequisicao();
    setCarregando(true);
    setErro('');
    try {
      const dados = await listarOcorrencias({ ...filtrosParaApi(filtrosAplicados), pagina });
      if (vigente()) setResultado(dados);
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (vigente() && exibirFalha(falha)) {
        setResultado(RESULTADO_VAZIO);
        setErro(mensagemErroListaOcorrencias(falha));
      }
    } finally {
      if (vigente()) setCarregando(false);
    }
  }, [filtrosAplicados, pagina, novaRequisicao]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Depois de trocar de página, o foco vai para o resumo do resultado.
  useEffect(() => {
    if (!carregando && focarResultado.current) {
      focarResultado.current = false;
      refResumo.current?.focus();
    }
  }, [carregando]);

  function aplicarFiltros(filtros) {
    const nova = montarBuscaOcorrencias(filtros, 1);
    // Mesma busca já na tela: recarrega (a URL não muda).
    if (nova.toString() === busca) carregar();
    else setSearchParams(nova);
  }

  function limparFiltros() {
    if (busca) setSearchParams(new URLSearchParams());
    else carregar();
  }

  function irParaPagina(novaPagina) {
    focarResultado.current = true;
    setSearchParams(montarBuscaOcorrencias(filtrosAplicados, novaPagina));
  }

  const comFiltros = contarFiltrosAtivos(filtrosAplicados) > 0;
  const paginas = totalDePaginas(resultado.total, resultado.tamanhoPagina);

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

      <FiltrosOcorrencias
        filtrosAplicados={filtrosAplicados}
        turmas={apoio.turmas}
        categorias={apoio.categorias}
        profissionais={verProfissional ? apoio.profissionais : null}
        falhas={apoio.falhas}
        aoFiltrar={aplicarFiltros}
        aoLimpar={limparFiltros}
      />

      {/* Resumo do resultado; recebe o foco depois de trocar de página. */}
      <p ref={refResumo} tabIndex={-1} className="resumo-ocorrencias" aria-live="polite">
        {!carregando && !erro && resultado.total > 0 ? textoTotalOcorrencias(resultado.total) : ''}
      </p>

      <ListaOcorrencias
        ocorrencias={resultado.itens}
        carregando={carregando}
        erro={erro}
        aoTentarNovamente={carregar}
        mensagemVazia={comFiltros ? MENSAGEM_SEM_OCORRENCIAS_FILTRO : MENSAGEM_SEM_OCORRENCIAS}
        buscaLista={busca ? `?${busca}` : ''}
      />

      {!carregando && !erro && resultado.total > 0 && (
        <PaginacaoOcorrencias
          pagina={pagina}
          totalPaginas={paginas}
          aoIrParaPagina={irParaPagina}
        />
      )}
    </div>
  );
}
