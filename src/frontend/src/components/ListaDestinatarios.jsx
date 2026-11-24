import {
  DESTINATARIOS,
  MAXIMO_DESTINATARIOS,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  agruparTutores,
  destinatarioExigeJustificativa,
  perguntaTrocaDestinatario,
} from '../services/mensagensOcorrencias.js';
import CampoJustificativaPsicologo from './CampoJustificativaPsicologo.jsx';
import ConfirmarTrocaDestinatario from './ConfirmarTrocaDestinatario.jsx';
import { OpcoesDeUsuarios, OpcoesEquipe, OpcoesTutores } from './OpcoesUsuarios.jsx';

/** Id de um campo da linha do destinatário (usado também para levar o foco ao erro). */
export function idCampoDestinatario(chave, campo) {
  return `destinatario-${chave}-${campo}`;
}

/** Ordem dos campos de cada linha (para focar o primeiro com erro). */
export const CAMPOS_DESTINATARIO = Object.freeze([
  'destinatarioPerfil',
  'destinatarioUsuarioId',
  'observacao',
]);

/**
 * Destinatários do encaminhamento inicial (UC01 passo 7, RN03): linhas que
 * podem ser adicionadas e removidas, cada uma com o tipo (Tutor, Psicólogo
 * escolar, Equipe pedagógica ou Gestão), o usuário e uma observação opcional.
 * - Tutor: o usuário é obrigatório. A lista mostra primeiro os tutores dos
 *   estudantes selecionados (entre os tutores ativos) e depois os demais;
 *   nada é escolhido automaticamente (decisão do Rafael na Issue #46).
 * - Psicólogo escolar (v1.18, Issue #152): o usuário é obrigatório, entre os
 *   psicólogos ativos, e a observação vira a "Justificativa para o psicólogo
 *   escolar", obrigatória, com a orientação de redação (RN06) e o aviso de
 *   quem pode lê-la (RN24).
 * - Equipe pedagógica e Gestão: usuário opcional ("Toda a equipe"), entre os
 *   ativos do perfil correspondente.
 *
 * @param {object} props
 * @param {Array<{ chave: number, destinatarioPerfil: string, destinatarioUsuarioId: string,
 *   observacao: string }>} props.destinatarios
 * @param {(chave: number, campo: string, valor: string) => void} props.aoAlterar
 * @param {() => void} props.aoAdicionar
 * @param {(chave: number) => void} props.aoRemover
 * @param {{ TUTOR: Array, PSICOLOGO: Array, EQUIPE_PEDAGOGICA: Array, GESTAO: Array }} props.usuariosPorDestinatario
 *   - usuários ativos de cada tipo, só { id, nome }
 * @param {boolean} [props.usuariosIndisponiveis] - a lista de usuários não carregou (#128):
 *   a ajuda do tutor e a do psicólogo não dizem que não há ninguém cadastrado
 * @param {Array<object>} props.estudantesSelecionados - para sugerir os tutores
 * @param {Record<number, Record<string, string>>} props.erros - por chave da linha
 * @param {string} [props.erroGeral] - ex.: nenhum destinatário
 * @param {{ chave: number, destinatarioPerfil: string } | null} [props.trocaPendente] - troca de
 *   tipo à espera de confirmação, porque apagaria o texto digitado (RN24 — #154)
 * @param {() => void} [props.aoConfirmarTroca]
 * @param {() => void} [props.aoCancelarTroca]
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function ListaDestinatarios({
  destinatarios,
  aoAlterar,
  aoAdicionar,
  aoRemover,
  usuariosPorDestinatario,
  usuariosIndisponiveis = false,
  estudantesSelecionados,
  erros,
  erroGeral,
  trocaPendente = null,
  aoConfirmarTroca,
  aoCancelarTroca,
  somenteLeitura,
}) {
  const { sugeridos, outros } = agruparTutores(
    usuariosPorDestinatario.TUTOR,
    estudantesSelecionados,
  );
  const podeAdicionar = destinatarios.length < MAXIMO_DESTINATARIOS;

  function propsAcessibilidade(chave, campo, ajuda) {
    const erro = erros[chave]?.[campo];
    const descricoes = [
      ajuda ? idCampoDestinatario(chave, `${campo}-ajuda`) : null,
      erro ? idCampoDestinatario(chave, `${campo}-erro`) : null,
    ].filter(Boolean);
    return {
      id: idCampoDestinatario(chave, campo),
      'aria-invalid': Boolean(erro),
      'aria-describedby': descricoes.length ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(chave, campo) {
    const erro = erros[chave]?.[campo];
    return (
      erro && (
        <span id={idCampoDestinatario(chave, `${campo}-erro`)} className="campo__erro">
          {erro}
        </span>
      )
    );
  }

  function campoUsuario(destinatario) {
    const { chave, destinatarioPerfil, destinatarioUsuarioId } = destinatario;
    if (!destinatarioPerfil) return null;
    const ehTutor = destinatarioPerfil === 'TUTOR';
    const ehPsicologo = destinatarioPerfil === 'PSICOLOGO';
    const lista = usuariosPorDestinatario[destinatarioPerfil] ?? [];
    let ajuda;
    if (ehTutor && usuariosIndisponiveis) {
      ajuda =
        'Obrigatório. A lista de tutores não carregou: carregue a lista de usuários de novo ou escolha outro destinatário.';
    } else if (ehTutor) {
      ajuda =
        lista.length === 0
          ? 'Obrigatório. Nenhum tutor ativo cadastrado: escolha outro destinatário.'
          : 'Obrigatório. Só aparecem tutores com acesso ativo.';
    } else if (ehPsicologo && usuariosIndisponiveis) {
      ajuda =
        'Obrigatório. A lista de psicólogos escolares não carregou: carregue a lista de usuários de novo ou escolha outro destinatário.';
    } else if (ehPsicologo) {
      ajuda =
        lista.length === 0
          ? 'Obrigatório. Nenhum psicólogo escolar ativo cadastrado: escolha outro destinatário.'
          : 'Obrigatório. Só aparecem psicólogos escolares com acesso ativo.';
    } else {
      ajuda = 'Opcional. Deixe "Toda a equipe" para encaminhar à equipe inteira.';
    }

    let rotulo = 'Pessoa da equipe (opcional)';
    let opcoes = <OpcoesEquipe usuarios={lista} />;
    if (ehTutor) {
      rotulo = 'Tutor que vai receber';
      opcoes = (
        <>
          <option value="">Selecione o tutor</option>
          <OpcoesTutores
            sugeridos={sugeridos}
            outros={outros}
            rotuloSugeridos="Tutores dos estudantes selecionados"
          />
        </>
      );
    } else if (ehPsicologo) {
      rotulo = 'Psicólogo escolar que vai receber';
      opcoes = (
        <>
          <option value="">Selecione o psicólogo escolar</option>
          <OpcoesDeUsuarios usuarios={lista} />
        </>
      );
    }
    return (
      <div className="campo">
        <label htmlFor={idCampoDestinatario(chave, 'destinatarioUsuarioId')}>{rotulo}</label>
        <select
          name="destinatarioUsuarioId"
          value={destinatarioUsuarioId}
          aria-disabled={somenteLeitura || undefined}
          onChange={(evento) => aoAlterar(chave, 'destinatarioUsuarioId', evento.target.value)}
          {...propsAcessibilidade(chave, 'destinatarioUsuarioId', true)}
        >
          {opcoes}
        </select>
        <span
          id={idCampoDestinatario(chave, 'destinatarioUsuarioId-ajuda')}
          className="campo__ajuda"
        >
          {ajuda}
        </span>
        {mensagemCampo(chave, 'destinatarioUsuarioId')}
      </div>
    );
  }

  return (
    <div className="lista-destinatarios">
      {destinatarios.length === 0 && (
        <p className="texto-secundario">Nenhum destinatário adicionado.</p>
      )}

      {destinatarios.map((destinatario, indice) => {
        const { chave, destinatarioPerfil, observacao } = destinatario;
        return (
          <fieldset key={chave} className="lista-destinatarios__item">
            <legend>Destinatário {indice + 1}</legend>

            <div className="campo">
              <label htmlFor={idCampoDestinatario(chave, 'destinatarioPerfil')}>
                Encaminhar para
              </label>
              <select
                name="destinatarioPerfil"
                value={destinatarioPerfil}
                aria-disabled={somenteLeitura || undefined}
                onChange={(evento) => aoAlterar(chave, 'destinatarioPerfil', evento.target.value)}
                {...propsAcessibilidade(chave, 'destinatarioPerfil', false)}
              >
                <option value="">Selecione</option>
                {DESTINATARIOS.map((d) => (
                  <option key={d.valor} value={d.valor}>
                    {d.rotulo}
                  </option>
                ))}
              </select>
              {mensagemCampo(chave, 'destinatarioPerfil')}
              {trocaPendente?.chave === chave && (
                <ConfirmarTrocaDestinatario
                  id={idCampoDestinatario(chave, 'troca')}
                  pergunta={perguntaTrocaDestinatario(destinatarioPerfil)}
                  aoConfirmar={aoConfirmarTroca}
                  aoCancelar={aoCancelarTroca}
                />
              )}
            </div>

            {campoUsuario(destinatario)}

            {destinatarioExigeJustificativa(destinatarioPerfil) ? (
              <CampoJustificativaPsicologo
                prefixoId={idCampoDestinatario(chave, 'observacao')}
                valor={observacao}
                aoAlterar={(valor) => aoAlterar(chave, 'observacao', valor)}
                erro={erros[chave]?.observacao}
                somenteLeitura={somenteLeitura}
              />
            ) : (
              <div className="campo">
                <label htmlFor={idCampoDestinatario(chave, 'observacao')}>
                  Observação para o destinatário (opcional)
                </label>
                <textarea
                  name="observacao"
                  rows={2}
                  maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
                  value={observacao}
                  readOnly={somenteLeitura}
                  onChange={(evento) => aoAlterar(chave, 'observacao', evento.target.value)}
                  {...propsAcessibilidade(chave, 'observacao', false)}
                />
                {mensagemCampo(chave, 'observacao')}
              </div>
            )}

            <button
              type="button"
              className="botao botao--secundario botao--compacto lista-destinatarios__remover"
              aria-label={`Remover destinatário ${indice + 1}`}
              aria-disabled={somenteLeitura || undefined}
              onClick={() => aoRemover(chave)}
            >
              Remover destinatário
            </button>
          </fieldset>
        );
      })}

      {erroGeral && (
        <p id="destinatarios-erro" className="campo__erro">
          {erroGeral}
        </p>
      )}

      {podeAdicionar ? (
        <button
          id="destinatarios-adicionar"
          type="button"
          className="botao botao--secundario"
          aria-disabled={somenteLeitura || undefined}
          aria-describedby={erroGeral ? 'destinatarios-erro' : undefined}
          onClick={aoAdicionar}
        >
          Adicionar destinatário
        </button>
      ) : (
        <p className="texto-secundario">
          Limite de {MAXIMO_DESTINATARIOS} destinatários atingido.
        </p>
      )}
    </div>
  );
}
