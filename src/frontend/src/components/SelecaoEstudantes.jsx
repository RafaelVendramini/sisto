import { useCallback, useEffect, useRef, useState } from 'react';
import { listarEstudantes } from '../services/estudantes.js';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from '../services/mensagens.js';
import { rotuloTurma } from '../services/mensagensEstudantes.js';

const MENSAGEM_GENERICA_LISTA = 'Não foi possível carregar os estudantes desta turma agora.';

function mensagemErroCarga(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_LISTA;
}

/**
 * Guarda só o necessário para o registro (minimização, LGPD): id, nome,
 * turma e o tutor (id e nome), usado na sugestão de destinatário (RN03).
 */
function camposUsados({ id, nomeCompleto, turma, tutor }) {
  return {
    id,
    nomeCompleto,
    turma: turma ? { id: turma.id, nome: turma.nome, etapa: turma.etapa, anoLetivo: turma.anoLetivo } : null,
    tutor: tutor ? { id: tutor.id, nome: tutor.nome } : null,
  };
}

/**
 * Seleção dos estudantes envolvidos (UC01 passo 3, RF06, RN14). O filtro
 * "Mostrar estudantes da turma" só escolhe qual lista aparece: trocar o
 * filtro não muda a turma da ocorrência nem tira os já escolhidos, o que
 * permite incluir estudantes de turmas diferentes.
 *
 * @param {object} props
 * @param {Array<object>} props.turmas - de GET /turmas
 * @param {string} props.filtroTurma - id (texto) da turma mostrada, ou ''
 * @param {(valor: string) => void} props.aoAlterarFiltro
 * @param {string} props.turmaOcorrenciaId - id (texto) da turma da ocorrência
 * @param {Array<object>} props.selecionados - estudantes escolhidos
 * @param {(estudante: object) => void} props.aoAlternar - marca/desmarca
 * @param {(id: number) => void} props.aoRemover
 * @param {string} [props.erro] - mensagem de validação do campo
 * @param {import('react').RefObject} props.refFiltro - foco quando há erro
 * @param {boolean} [props.somenteLeitura] - durante o envio
 */
export default function SelecaoEstudantes({
  turmas,
  filtroTurma,
  aoAlterarFiltro,
  turmaOcorrenciaId,
  selecionados,
  aoAlternar,
  aoRemover,
  erro,
  refFiltro,
  somenteLeitura,
}) {
  const [estudantes, setEstudantes] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erroCarga, setErroCarga] = useState('');

  const montado = useRef(true);
  // Só a resposta da consulta mais recente atualiza a lista (troca rápida de filtro).
  const consultaAtual = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const carregar = useCallback(async (turmaId) => {
    const consulta = ++consultaAtual.current;
    if (!turmaId) {
      setEstudantes([]);
      setErroCarga('');
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErroCarga('');
    try {
      const lista = await listarEstudantes({ turmaId });
      if (montado.current && consulta === consultaAtual.current) {
        setEstudantes(lista.map(camposUsados));
      }
    } catch (falha) {
      // 401: o tratamento central já leva ao login com aviso.
      if (montado.current && consulta === consultaAtual.current && falha?.status !== 401) {
        setEstudantes([]);
        setErroCarga(mensagemErroCarga(falha));
      }
    } finally {
      if (montado.current && consulta === consultaAtual.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar(filtroTurma);
  }, [filtroTurma, carregar]);

  const idsSelecionados = new Set(selecionados.map((e) => e.id));
  const turmaFiltrada = turmas.find((t) => String(t.id) === filtroTurma);
  const descricoes = ['estudantes-filtro-ajuda', erro ? 'estudantes-erro' : null].filter(Boolean);

  function listaDaTurma() {
    if (!filtroTurma) {
      return (
        <p className="texto-secundario">
          Selecione uma turma acima para ver os estudantes.
        </p>
      );
    }
    if (carregando) {
      return (
        <p className="texto-secundario" role="status">
          Carregando estudantes...
        </p>
      );
    }
    if (erroCarga) {
      return (
        <div className="mensagem mensagem--erro" role="alert">
          <p>{erroCarga}</p>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => carregar(filtroTurma)}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    if (estudantes.length === 0) {
      return <p className="texto-secundario">Nenhum estudante cadastrado nesta turma.</p>;
    }
    return (
      <fieldset className="selecao-estudantes__lista">
        <legend>Estudantes da turma {rotuloTurma(turmaFiltrada)}</legend>
        {estudantes.map((estudante) => (
          <label key={estudante.id} className="selecao-estudantes__opcao">
            <input
              type="checkbox"
              checked={idsSelecionados.has(estudante.id)}
              aria-disabled={somenteLeitura || undefined}
              onChange={() => aoAlternar(estudante)}
            />
            <span>{estudante.nomeCompleto}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <div className="selecao-estudantes">
      <div className="campo">
        <label htmlFor="ocorrencia-filtroTurma">Mostrar estudantes da turma</label>
        <select
          ref={refFiltro}
          id="ocorrencia-filtroTurma"
          name="filtroTurma"
          value={filtroTurma}
          aria-disabled={somenteLeitura || undefined}
          aria-invalid={Boolean(erro)}
          aria-describedby={descricoes.join(' ')}
          onChange={(evento) => aoAlterarFiltro(evento.target.value)}
        >
          <option value="">Selecione a turma</option>
          {turmas.map((turma) => (
            <option key={turma.id} value={String(turma.id)}>
              {rotuloTurma(turma)}
            </option>
          ))}
        </select>
        <span id="estudantes-filtro-ajuda" className="campo__ajuda">
          Começa igual à turma da ocorrência. Para incluir estudantes de outra turma, troque aqui: os
          já escolhidos continuam na lista e a turma da ocorrência não muda.
        </span>
      </div>

      {listaDaTurma()}

      <div className="selecao-estudantes__escolhidos">
        <h3 id="titulo-estudantes-selecionados">
          Estudantes envolvidos ({selecionados.length})
        </h3>
        {selecionados.length === 0 ? (
          <p className="texto-secundario">Nenhum estudante selecionado.</p>
        ) : (
          <ul className="selecao-estudantes__itens" aria-labelledby="titulo-estudantes-selecionados">
            {selecionados.map((estudante) => {
              const outraTurma =
                turmaOcorrenciaId && String(estudante.turma?.id) !== turmaOcorrenciaId;
              return (
                <li key={estudante.id} className="selecao-estudantes__item">
                  <span className="selecao-estudantes__nome">
                    {estudante.nomeCompleto}
                    {outraTurma && estudante.turma && (
                      <span className="selecao-estudantes__turma">
                        {' '}
                        (turma {rotuloTurma(estudante.turma)})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="botao botao--secundario botao--compacto"
                    aria-label={`Remover ${estudante.nomeCompleto}`}
                    aria-disabled={somenteLeitura || undefined}
                    onClick={() => aoRemover(estudante.id)}
                  >
                    Remover
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {erro && (
          <span id="estudantes-erro" className="campo__erro">
            {erro}
          </span>
        )}
      </div>
    </div>
  );
}
