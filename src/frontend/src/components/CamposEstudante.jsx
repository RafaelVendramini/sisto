import {
  TAMANHO_MAXIMO_CODIGO_ESCOLAR,
  TAMANHO_MAXIMO_NOME_ESTUDANTE,
  rotuloOpcaoTutor,
  rotuloTurma,
} from '../services/mensagensEstudantes.js';

/** Ordem dos campos na tela (usada para focar o primeiro campo com erro). */
export const CAMPOS_ESTUDANTE = Object.freeze(['nomeCompleto', 'codigoEscolar', 'turmaId', 'tutorId']);

/**
 * Campos do estudante (RF15, RF16), usados no cadastro e na edição: nome
 * completo, código escolar (opcional), turma e tutor (opcional, com a opção
 * "Sem tutor"). Os ids recebem o `prefixo` para não repetir na mesma página.
 *
 * @param {object} props
 * @param {string} props.prefixo - ex.: 'estudante' ou 'edicao-estudante'
 * @param {{ nomeCompleto: string, codigoEscolar: string, turmaId: string, tutorId: string }} props.dados
 * @param {Record<string, string>} props.erros
 * @param {(campo: string) => (evento: Event) => void} props.aoAlterar
 * @param {Record<string, import('react').RefObject>} props.refs
 * @param {Array<{ id: number, nome: string, etapa: string, anoLetivo: number }>} props.turmas
 * @param {Array<{ id: number, nome: string, status?: string }>} props.tutores - opções de
 *   tutor já prontas (tutores ativos e, na edição, o tutor atual mesmo que não esteja ativo)
 * @param {string} [props.idConflito] - id da mensagem de código repetido (409),
 *   que marca o campo "Código escolar" como inválido enquanto estiver na tela
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function CamposEstudante({
  prefixo,
  dados,
  erros,
  aoAlterar,
  refs,
  turmas,
  tutores,
  idConflito,
  somenteLeitura,
}) {
  function propsAcessibilidade(campo, { comAjuda = true, conflito = false } = {}) {
    const descricoes = [
      comAjuda ? `${prefixo}-${campo}-ajuda` : null,
      erros[campo] ? `${prefixo}-${campo}-erro` : null,
      conflito && idConflito ? idConflito : null,
    ].filter(Boolean);
    return {
      'aria-invalid': Boolean(erros[campo] || (conflito && idConflito)),
      'aria-describedby': descricoes.length ? descricoes.join(' ') : undefined,
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
        <label htmlFor={`${prefixo}-nomeCompleto`}>Nome completo</label>
        <input
          ref={refs.nomeCompleto}
          id={`${prefixo}-nomeCompleto`}
          name="nomeCompleto"
          type="text"
          autoComplete="off"
          maxLength={TAMANHO_MAXIMO_NOME_ESTUDANTE}
          value={dados.nomeCompleto}
          readOnly={somenteLeitura}
          onChange={aoAlterar('nomeCompleto')}
          {...propsAcessibilidade('nomeCompleto')}
        />
        <span id={`${prefixo}-nomeCompleto-ajuda`} className="campo__ajuda">
          Obrigatório. Até {TAMANHO_MAXIMO_NOME_ESTUDANTE} caracteres.
        </span>
        {mensagemCampo('nomeCompleto')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-codigoEscolar`}>Código escolar (opcional)</label>
        <input
          ref={refs.codigoEscolar}
          id={`${prefixo}-codigoEscolar`}
          name="codigoEscolar"
          type="text"
          autoComplete="off"
          maxLength={TAMANHO_MAXIMO_CODIGO_ESCOLAR}
          value={dados.codigoEscolar}
          readOnly={somenteLeitura}
          onChange={aoAlterar('codigoEscolar')}
          {...propsAcessibilidade('codigoEscolar', { conflito: true })}
        />
        <span id={`${prefixo}-codigoEscolar-ajuda`} className="campo__ajuda">
          Pode ficar em branco. Quando informado, não pode se repetir entre estudantes. Maiúsculas e
          minúsculas são consideradas diferentes.
        </span>
        {mensagemCampo('codigoEscolar')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-turmaId`}>Turma</label>
        <select
          ref={refs.turmaId}
          id={`${prefixo}-turmaId`}
          name="turmaId"
          value={dados.turmaId}
          aria-disabled={somenteLeitura || undefined}
          onChange={aoAlterar('turmaId')}
          {...propsAcessibilidade('turmaId')}
        >
          <option value="">Selecione a turma</option>
          {turmas.map((turma) => (
            <option key={turma.id} value={String(turma.id)}>
              {rotuloTurma(turma)}
            </option>
          ))}
        </select>
        <span id={`${prefixo}-turmaId-ajuda`} className="campo__ajuda">
          Obrigatório.
        </span>
        {mensagemCampo('turmaId')}
      </div>

      <div className="campo">
        <label htmlFor={`${prefixo}-tutorId`}>Professor tutor (opcional)</label>
        <select
          ref={refs.tutorId}
          id={`${prefixo}-tutorId`}
          name="tutorId"
          value={dados.tutorId}
          aria-disabled={somenteLeitura || undefined}
          onChange={aoAlterar('tutorId')}
          {...propsAcessibilidade('tutorId')}
        >
          <option value="">Sem tutor</option>
          {tutores.map((tutor) => (
            <option key={tutor.id} value={String(tutor.id)}>
              {rotuloOpcaoTutor(tutor)}
            </option>
          ))}
        </select>
        <span id={`${prefixo}-tutorId-ajuda`} className="campo__ajuda">
          Só aparecem usuários com perfil Tutor e acesso ativo. Escolha &quot;Sem tutor&quot; para
          deixar o estudante sem tutor.
        </span>
        {mensagemCampo('tutorId')}
      </div>
    </>
  );
}
