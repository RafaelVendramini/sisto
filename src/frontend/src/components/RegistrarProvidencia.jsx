import { useEffect, useRef, useState } from 'react';
import {
  TAMANHO_MAXIMO_TEXTO_LONGO,
  atualizacaoOcorrenciaPedeAtualizacao,
  mensagemErroProvidencia,
  validarProvidencia,
} from '../services/mensagensOcorrencias.js';
import { registrarProvidencia } from '../services/ocorrencias.js';
import Dialogo from './Dialogo.jsx';

const ID_DIALOGO = 'dialogo-providencia';
const ID_CAMPO = 'providencia-descricao';

/**
 * Diálogo "Registrar providência" (UC04, RF12, RN04, RN22). Só é aberto com a
 * ocorrência "Em acompanhamento", para Gestão, Pedagógico e o responsável pelo
 * acompanhamento; a proteção real é do back-end (403/404/409).
 * - Descrição obrigatória, até 5000 caracteres (maxLength no campo).
 * - Data/hora e autor são definidos pelo sistema (RN17).
 * - Sucesso: devolve ao detalhe a resposta 201 (detalhe completo).
 *
 * @param {object} props
 * @param {object} props.ocorrencia - detalhe atual (id)
 * @param {(detalhe: object | null) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} props.aoAtualizarOcorrencia - recarregar o detalhe (após 404/409)
 * @param {() => void} [props.aoRestaurarFoco]
 */
export default function RegistrarProvidencia({
  ocorrencia,
  aoConcluir,
  aoCancelar,
  aoAtualizarOcorrencia,
  aoRestaurarFoco,
}) {
  const [descricao, setDescricao] = useState('');
  const [erroCampo, setErroCampo] = useState('');
  const [erro, setErro] = useState('');
  const [pedeAtualizacao, setPedeAtualizacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);
  const montado = useRef(true);
  const refDescricao = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  function alterar(evento) {
    if (enviandoRef.current) return; // campo travado durante o envio
    setErro('');
    setPedeAtualizacao(false);
    setErroCampo('');
    setDescricao(evento.target.value);
  }

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  function atualizarOcorrencia() {
    if (enviandoRef.current) return;
    aoAtualizarOcorrencia();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    setPedeAtualizacao(false);
    const erros = validarProvidencia({ descricao });
    setErroCampo(erros.descricao ?? '');
    if (erros.descricao) {
      refDescricao.current?.focus();
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      // O texto vai como foi digitado: a normalização (trim) é da API.
      const detalhe = await registrarProvidencia(ocorrencia.id, { descricao });
      if (montado.current) aoConcluir(detalhe ?? null);
    } catch (falha) {
      enviandoRef.current = false;
      if (!montado.current) return;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      setErro(mensagemErroProvidencia(falha));
      setPedeAtualizacao(atualizacaoOcorrenciaPedeAtualizacao(falha));
    }
  }

  const descricoes = [`${ID_CAMPO}-ajuda`, erroCampo ? `${ID_CAMPO}-erro` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Dialogo
      id={ID_DIALOGO}
      titulo="Registrar providência"
      descricaoId={`${ID_DIALOGO}-descricao`}
      aoFechar={cancelar}
      focoInicialRef={refDescricao}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id={`${ID_DIALOGO}-descricao`} className="texto-secundario">
        Registre o que foi feito para tratar a ocorrência nº {ocorrencia.id}. A data e a hora são
        as do registro.
      </p>

      <form
        className="formulario providencia"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby={`${ID_DIALOGO}-titulo`}
      >
        <div className="campo">
          <label htmlFor={ID_CAMPO}>Descrição da providência</label>
          <textarea
            id={ID_CAMPO}
            name="descricao"
            ref={refDescricao}
            rows={5}
            maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
            value={descricao}
            readOnly={enviando}
            onChange={alterar}
            aria-invalid={Boolean(erroCampo)}
            aria-describedby={descricoes}
          />
          <span id={`${ID_CAMPO}-ajuda`} className="campo__ajuda">
            Obrigatório. Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres. Escreva de forma objetiva,
            sem opiniões.
          </span>
          {erroCampo && (
            <span id={`${ID_CAMPO}-erro`} className="campo__erro">
              {erroCampo}
            </span>
          )}
        </div>

        {erro && (
          <div className="mensagem mensagem--erro" role="alert">
            <p>{erro}</p>
            {pedeAtualizacao && (
              <button type="button" className="botao botao--secundario" onClick={atualizarOcorrencia}>
                Atualizar a ocorrência
              </button>
            )}
          </div>
        )}

        <div className="dialogo__acoes">
          <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
            {enviando ? 'Registrando...' : 'Registrar'}
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={cancelar}
            aria-disabled={enviando}
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}
