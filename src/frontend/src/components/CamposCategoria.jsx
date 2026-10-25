import {
  TAMANHO_MAXIMO_DESCRICAO_CATEGORIA,
  TAMANHO_MAXIMO_NOME_CATEGORIA,
} from '../services/mensagensCategorias.js';

/**
 * Campos "Nome" e "Descrição" da categoria (RF07), usados no cadastro e na
 * edição. Os ids recebem o `prefixo` para não repetir na mesma página.
 *
 * @param {object} props
 * @param {string} props.prefixo - ex.: 'categoria' ou 'edicao-categoria'
 * @param {{ nome: string, descricao: string }} props.dados
 * @param {{ nome?: string, descricao?: string }} props.erros
 * @param {(campo: 'nome' | 'descricao') => (evento: Event) => void} props.aoAlterar
 * @param {{ nome: import('react').RefObject, descricao: import('react').RefObject }} props.refs
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function CamposCategoria({ prefixo, dados, erros, aoAlterar, refs, somenteLeitura }) {
  function propsAcessibilidade(campo) {
    const descricoes = [
      `${prefixo}-${campo}-ajuda`,
      erros[campo] ? `${prefixo}-${campo}-erro` : null,
    ].filter(Boolean);
    return {
      'aria-invalid': Boolean(erros[campo]),
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
          maxLength={TAMANHO_MAXIMO_NOME_CATEGORIA}
          value={dados.nome}
          readOnly={somenteLeitura}
          onChange={aoAlterar('nome')}
          {...propsAcessibilidade('nome')}
        />
        <span id={`${prefixo}-nome-ajuda`} className="campo__ajuda">
          Obrigatório. Até {TAMANHO_MAXIMO_NOME_CATEGORIA} caracteres. Não pode repetir o nome de
          outra categoria.
        </span>
        {mensagemCampo('nome')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-descricao`}>Descrição (opcional)</label>
        <textarea
          ref={refs.descricao}
          id={`${prefixo}-descricao`}
          name="descricao"
          rows={4}
          maxLength={TAMANHO_MAXIMO_DESCRICAO_CATEGORIA}
          value={dados.descricao}
          readOnly={somenteLeitura}
          onChange={aoAlterar('descricao')}
          {...propsAcessibilidade('descricao')}
        />
        <span id={`${prefixo}-descricao-ajuda`} className="campo__ajuda">
          Até {TAMANHO_MAXIMO_DESCRICAO_CATEGORIA} caracteres.
        </span>
        {mensagemCampo('descricao')}
      </div>
    </>
  );
}
