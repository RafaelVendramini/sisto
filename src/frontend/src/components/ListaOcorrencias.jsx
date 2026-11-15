import { Link } from 'react-router-dom';
import { rotuloTurma } from '../services/mensagensEstudantes.js';
import {
  MENSAGEM_SEM_OCORRENCIAS,
  TEXTO_NAO_INFORMADO,
  formatarDataHora,
  rotuloStatusOcorrencia,
} from '../services/mensagensOcorrencias.js';

/** Selo com o rótulo amigável do status (ex.: "Em acompanhamento"). */
export function SeloStatusOcorrencia({ status }) {
  const rotulo = rotuloStatusOcorrencia(status) || TEXTO_NAO_INFORMADO;
  const modificador = String(status ?? '').toLowerCase().replace(/_/g, '-');
  return <span className={`selo selo-ocorrencia selo-ocorrencia--${modificador}`}>{rotulo}</span>;
}

function CartaoOcorrencia({ ocorrencia, buscaLista }) {
  const nomes = (ocorrencia.estudantes ?? []).map((e) => e.nomeCompleto).join(', ');
  const idTitulo = `ocorrencia-${ocorrencia.id}-titulo`;
  return (
    <li className="lista-ocorrencias__item">
      <article className="cartao-ocorrencia" aria-labelledby={idTitulo}>
        <div className="cartao-ocorrencia__topo">
          <h2 id={idTitulo} className="cartao-ocorrencia__titulo">
            {/* O link cobre o cartão inteiro (CSS), com área de toque grande (RNF01). */}
            {/* buscaLista: filtros e página atuais, para o "Voltar para a lista" (#87). */}
            <Link
              to={`/ocorrencias/${ocorrencia.id}`}
              state={buscaLista ? { buscaLista } : undefined}
              className="cartao-ocorrencia__link"
            >
              Ocorrência nº {ocorrencia.id}
            </Link>
          </h2>
          <SeloStatusOcorrencia status={ocorrencia.status} />
        </div>
        <dl className="dados-ocorrencia dados-ocorrencia--compacto">
          <div>
            <dt>Data e hora</dt>
            <dd>{formatarDataHora(ocorrencia.dataHora) || TEXTO_NAO_INFORMADO}</dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>{ocorrencia.categoria?.nome || TEXTO_NAO_INFORMADO}</dd>
          </div>
          <div>
            <dt>Turma</dt>
            <dd>{rotuloTurma(ocorrencia.turma) || TEXTO_NAO_INFORMADO}</dd>
          </div>
          <div>
            <dt>Estudantes</dt>
            <dd>{nomes || TEXTO_NAO_INFORMADO}</dd>
          </div>
        </dl>
      </article>
    </li>
  );
}

/**
 * Lista de ocorrências em cartões (UC03, RNF01): funciona igual no celular e
 * no computador. Mostra data e hora (São Paulo), categoria, turma, estudantes
 * e status com rótulo amigável; cada cartão leva ao detalhe. A ordem é a da
 * API (mais recente primeiro) e o conteúdo é o que o back-end permite (RN19).
 * `mensagemVazia` troca o texto da lista vazia (ex.: com filtros — #87) e
 * `buscaLista` (query string da lista, ex.: '?status=ABERTO') vai para o
 * detalhe, para o "Voltar para a lista" manter a busca.
 */
export default function ListaOcorrencias({
  ocorrencias,
  carregando,
  erro,
  aoTentarNovamente,
  mensagemVazia = MENSAGEM_SEM_OCORRENCIAS,
  buscaLista = '',
}) {
  if (carregando) {
    return (
      <p className="texto-secundario" role="status">
        Carregando ocorrências...
      </p>
    );
  }

  if (erro) {
    return (
      <div className="mensagem mensagem--erro" role="alert">
        <p>{erro}</p>
        <button type="button" className="botao botao--secundario" onClick={aoTentarNovamente}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (ocorrencias.length === 0) {
    return <p className="texto-secundario">{mensagemVazia}</p>;
  }

  return (
    <ul className="lista-ocorrencias" aria-label="Ocorrências">
      {ocorrencias.map((ocorrencia) => (
        <CartaoOcorrencia key={ocorrencia.id} ocorrencia={ocorrencia} buscaLista={buscaLista} />
      ))}
    </ul>
  );
}
