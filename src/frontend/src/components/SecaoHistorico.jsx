import { useCallback, useEffect, useState } from 'react';
import {
  MENSAGEM_SEM_HISTORICO,
  TEXTO_NAO_INFORMADO,
  formatarDataHora,
  historicoNaoEncontrado,
  mensagemErroHistorico,
  rotuloAcaoHistorico,
  textoOuNaoInformado,
} from '../services/mensagensOcorrencias.js';
import { listarHistoricoOcorrencia } from '../services/ocorrencias.js';
import Dado from './Dado.jsx';
import { exibirFalha, useCarregamento } from './useCarregamento.js';

// Histórico de alterações (#85, RF12, RN08, RN17): carregado à parte, sem
// derrubar o detalhe quando falha (a seção mostra o erro e "Tentar novamente").
// `versao` muda a cada ação concluída na tela e faz a seção buscar de novo;
// os itens anteriores continuam visíveis enquanto a nova lista chega.
// 404/400 (a ocorrência deixou de existir para o usuário — RN19): avisa a
// página, que mostra o mesmo "não encontrada" do detalhe. 401: fluxo central.
export default function SecaoHistorico({ id, versao, aoNaoEncontrar }) {
  const [itens, setItens] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  // Só a resposta da busca mais recente vale (ações seguidas ou "Tentar novamente").
  const { novaRequisicao } = useCarregamento();

  const carregar = useCallback(async () => {
    const vigente = novaRequisicao();
    setCarregando(true);
    setErro('');
    try {
      const lista = await listarHistoricoOcorrencia(id);
      if (vigente()) setItens(lista);
    } catch (falha) {
      if (!vigente() || !exibirFalha(falha)) return;
      if (historicoNaoEncontrado(falha)) aoNaoEncontrar?.(falha);
      else setErro(mensagemErroHistorico(falha));
    } finally {
      if (vigente()) setCarregando(false);
    }
  }, [id, aoNaoEncontrar, novaRequisicao]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  function corpo() {
    if (erro) {
      return (
        <div className="mensagem mensagem--erro" role="alert">
          <p>{erro}</p>
          <button type="button" className="botao botao--secundario" onClick={carregar}>
            Tentar novamente
          </button>
        </div>
      );
    }
    if (itens === null) {
      return carregando ? (
        <p className="texto-secundario" role="status">
          Carregando o histórico...
        </p>
      ) : null;
    }
    if (itens.length === 0) return <p className="texto-secundario">{MENSAGEM_SEM_HISTORICO}</p>;
    // Na ordem da API: do mais antigo para o mais novo.
    return (
      <ol className="detalhe-ocorrencia__itens" aria-label="Alterações da ocorrência">
        {itens.map((h) => (
          <li key={h.id} className="detalhe-ocorrencia__item">
            <p className="detalhe-ocorrencia__nome">
              {rotuloAcaoHistorico(h.acao) || TEXTO_NAO_INFORMADO}
            </p>
            <dl className="dados-ocorrencia dados-ocorrencia--compacto">
              <Dado rotulo="Data e hora">{formatarDataHora(h.dataHora) || TEXTO_NAO_INFORMADO}</Dado>
              <Dado rotulo="Feito por">{textoOuNaoInformado(h.usuario?.nome)}</Dado>
              {h.descricao !== undefined && h.descricao !== null && String(h.descricao).trim() !== '' && (
                <Dado rotulo="Descrição" longo>
                  {h.descricao}
                </Dado>
              )}
            </dl>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section
      className="detalhe-ocorrencia__secao"
      aria-labelledby="titulo-historico"
      aria-busy={carregando}
    >
      <h2 id="titulo-historico">Histórico</h2>
      {corpo()}
    </section>
  );
}
