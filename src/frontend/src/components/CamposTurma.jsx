import {
  MAIOR_ANO_LETIVO,
  MENOR_ANO_LETIVO,
  TAMANHO_MAXIMO_ETAPA_TURMA,
  TAMANHO_MAXIMO_NOME_TURMA,
} from '../services/mensagensTurmas.js';

/** Ordem dos campos na tela (usada para focar o primeiro campo com erro). */
export const CAMPOS_TURMA = Object.freeze(['nome', 'etapa', 'anoLetivo']);

/**
 * Campos "Nome", "Etapa" e "Ano letivo" da turma (RF15), usados no cadastro e
 * na edição. Os ids recebem o `prefixo` para não repetir na mesma página.
 *
 * @param {object} props
 * @param {string} props.prefixo - ex.: 'turma' ou 'edicao-turma'
 * @param {{ nome: string, etapa: string, anoLetivo: string }} props.dados
 * @param {{ nome?: string, etapa?: string, anoLetivo?: string }} props.erros
 * @param {(campo: 'nome' | 'etapa' | 'anoLetivo') => (evento: Event) => void} props.aoAlterar
 * @param {Record<string, import('react').RefObject>} props.refs
 * @param {string} [props.idConflito] - id da mensagem de turma repetida (409),
 *   que marca os três campos como inválidos enquanto estiver na tela
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function CamposTurma({
  prefixo,
  dados,
  erros,
  aoAlterar,
  refs,
  idConflito,
  somenteLeitura,
}) {
  function propsAcessibilidade(campo) {
    const descricoes = [
      `${prefixo}-${campo}-ajuda`,
      erros[campo] ? `${prefixo}-${campo}-erro` : null,
      idConflito || null,
    ].filter(Boolean);
    return {
      'aria-invalid': Boolean(erros[campo] || idConflito),
      'aria-describedby': descricoes.join(' '),
    };
  }

  function mensagemCampo(campo) {
    return (
      erros[campo] && (
        <span id={`${prefixo}-${campo}-erro`} className="campo__erro">
          {erros[campo]}
        </span>
      )
    );
  }

  return (
    <>
      <div className="campo">
        <label htmlFor={`${prefixo}-nome`}>Nome</label>
        <input
          ref={refs.nome}
          id={`${prefixo}-nome`}
          name="nome"
          type="text"
          autoComplete="off"
          maxLength={TAMANHO_MAXIMO_NOME_TURMA}
          value={dados.nome}
          readOnly={somenteLeitura}
          onChange={aoAlterar('nome')}
          {...propsAcessibilidade('nome')}
        />
        <span id={`${prefixo}-nome-ajuda`} className="campo__ajuda">
          Obrigatório. Até {TAMANHO_MAXIMO_NOME_TURMA} caracteres. Ex.: 1º A.
        </span>
        {mensagemCampo('nome')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-etapa`}>Etapa</label>
        <input
          ref={refs.etapa}
          id={`${prefixo}-etapa`}
          name="etapa"
          type="text"
          autoComplete="off"
          maxLength={TAMANHO_MAXIMO_ETAPA_TURMA}
          value={dados.etapa}
          readOnly={somenteLeitura}
          onChange={aoAlterar('etapa')}
          {...propsAcessibilidade('etapa')}
        />
        <span id={`${prefixo}-etapa-ajuda`} className="campo__ajuda">
          Obrigatório. Até {TAMANHO_MAXIMO_ETAPA_TURMA} caracteres. Ex.: Ensino Médio.
        </span>
        {mensagemCampo('etapa')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-anoLetivo`}>Ano letivo</label>
        <input
          ref={refs.anoLetivo}
          id={`${prefixo}-anoLetivo`}
          name="anoLetivo"
          type="number"
          inputMode="numeric"
          min={MENOR_ANO_LETIVO}
          max={MAIOR_ANO_LETIVO}
          step={1}
          autoComplete="off"
          value={dados.anoLetivo}
          readOnly={somenteLeitura}
          onChange={aoAlterar('anoLetivo')}
          {...propsAcessibilidade('anoLetivo')}
        />
        <span id={`${prefixo}-anoLetivo-ajuda`} className="campo__ajuda">
          Obrigatório. Ano com 4 algarismos (ex.: 2026). A mesma turma pode ser cadastrada de novo
          em outro ano letivo.
        </span>
        {mensagemCampo('anoLetivo')}
      </div>
    </>
  );
}
