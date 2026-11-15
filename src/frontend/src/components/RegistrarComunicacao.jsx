import { useEffect, useRef, useState } from 'react';
import {
  ORIENTACAO_COMUNICACAO,
  TAMANHO_MAXIMO_DESTINATARIO_MEIO,
  TAMANHO_MAXIMO_TEXTO_LONGO,
  agoraNoFusoDaEscola,
  comunicacaoPedeAtualizacao,
  mensagemErroComunicacao,
  montarEnvioComunicacao,
  validarComunicacao,
} from '../services/mensagensOcorrencias.js';
import { registrarComunicacao } from '../services/ocorrencias.js';
import Dialogo from './Dialogo.jsx';

const PREFIXO = 'comunicacao';
const ID_DIALOGO = 'dialogo-comunicacao';

// Ordem dos campos na tela, usada para focar o primeiro com erro.
const ORDEM_CAMPOS = Object.freeze(['destinatario', 'meio', 'descricao', 'dataHora']);

function idCampo(campo) {
  return `${PREFIXO}-${campo}`;
}

/** Diálogo começa limpo, com a data e a hora de agora no horário de São Paulo. */
function dadosIniciais() {
  return {
    destinatario: '',
    meio: '',
    descricao: '',
    dataHora: agoraNoFusoDaEscola(),
  };
}

/**
 * Diálogo "Registrar comunicação" (RF09, RN16, RN17). Registra um contato
 * feito FORA do sistema (o sistema não envia notificações). Só é aberto para
 * Tutor, Gestão e Pedagógico em ocorrências não encerradas; a proteção real é
 * do back-end (403/404/409).
 * - Destinatário e meio são texto livre (RN16), sem lista fixa.
 * - Data e hora do contato: sugestão "agora" no horário de São Paulo; mais de
 *   5 minutos no futuro é bloqueado (RN17).
 * - Sucesso: devolve ao detalhe a resposta 201 (detalhe completo).
 *
 * @param {object} props
 * @param {object} props.ocorrencia - detalhe atual (id)
 * @param {(detalhe: object | null) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} props.aoAtualizarOcorrencia - recarregar o detalhe (após 404/409)
 * @param {() => void} [props.aoRestaurarFoco]
 */
export default function RegistrarComunicacao({
  ocorrencia,
  aoConcluir,
  aoCancelar,
  aoAtualizarOcorrencia,
  aoRestaurarFoco,
}) {
  const [dados, setDados] = useState(dadosIniciais);
  const [erros, setErros] = useState({});
  const [erro, setErro] = useState('');
  const [pedeAtualizacao, setPedeAtualizacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const montado = useRef(true);
  const refs = {
    destinatario: useRef(null),
    meio: useRef(null),
    descricao: useRef(null),
    dataHora: useRef(null),
  };

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return; // campos travados durante o envio
      const { value } = evento.target;
      setErro('');
      setPedeAtualizacao(false);
      setDados((atual) => ({ ...atual, [campo]: value }));
      setErros((atual) => {
        if (!atual[campo]) return atual;
        const restantes = { ...atual };
        delete restantes[campo];
        return restantes;
      });
    };
  }

  function focarPrimeiroInvalido(novosErros) {
    const campo = ORDEM_CAMPOS.find((nome) => novosErros[nome]);
    if (campo) refs[campo].current?.focus();
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
    const novosErros = validarComunicacao(dados);
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const detalhe = await registrarComunicacao(ocorrencia.id, montarEnvioComunicacao(dados));
      if (montado.current) aoConcluir(detalhe ?? null);
    } catch (falha) {
      enviandoRef.current = false;
      if (!montado.current) return;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      setErro(mensagemErroComunicacao(falha));
      setPedeAtualizacao(comunicacaoPedeAtualizacao(falha));
    }
  }

  function propsAcessibilidade(campo, descricoesExtras = []) {
    const descricoes = [
      ...descricoesExtras,
      idCampo(`${campo}-ajuda`),
      erros[campo] ? idCampo(`${campo}-erro`) : null,
    ].filter(Boolean);
    return {
      id: idCampo(campo),
      name: campo,
      ref: refs[campo],
      value: dados[campo],
      readOnly: enviando,
      onChange: alterar(campo),
      'aria-invalid': Boolean(erros[campo]),
      'aria-describedby': descricoes.join(' '),
    };
  }

  function mensagemCampo(campo) {
    return (
      erros[campo] && (
        <span id={idCampo(`${campo}-erro`)} className="campo__erro">
          {erros[campo]}
        </span>
      )
    );
  }

  return (
    <Dialogo
      id={ID_DIALOGO}
      titulo="Registrar comunicação"
      descricaoId={`${ID_DIALOGO}-descricao`}
      aoFechar={cancelar}
      focoInicialRef={refs.destinatario}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id={`${ID_DIALOGO}-descricao`} className="texto-secundario">
        Registre um contato já feito fora do sistema sobre a ocorrência nº {ocorrencia.id}. O
        sistema não envia mensagens a ninguém.
      </p>

      <form
        className="formulario comunicacao"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby={`${ID_DIALOGO}-titulo`}
      >
        <div className="campo">
          <label htmlFor={idCampo('destinatario')}>Destinatário</label>
          <input
            type="text"
            maxLength={TAMANHO_MAXIMO_DESTINATARIO_MEIO}
            autoComplete="off"
            {...propsAcessibilidade('destinatario')}
          />
          <span id={idCampo('destinatario-ajuda')} className="campo__ajuda">
            Obrigatório. Com quem foi o contato. Ex.: responsável pelo estudante, Conselho Tutelar.
          </span>
          {mensagemCampo('destinatario')}
        </div>

        <div className="campo">
          <label htmlFor={idCampo('meio')}>Meio</label>
          <input
            type="text"
            maxLength={TAMANHO_MAXIMO_DESTINATARIO_MEIO}
            autoComplete="off"
            {...propsAcessibilidade('meio')}
          />
          <span id={idCampo('meio-ajuda')} className="campo__ajuda">
            Obrigatório. Como o contato foi feito. Ex.: telefone, WhatsApp, e-mail, presencial.
          </span>
          {mensagemCampo('meio')}
        </div>

        <div className="campo">
          <label htmlFor={idCampo('descricao')}>Descrição</label>
          <p
            id={idCampo('descricao-orientacao')}
            className="mensagem mensagem--aviso comunicacao__orientacao"
          >
            {ORIENTACAO_COMUNICACAO}
          </p>
          <textarea
            rows={5}
            maxLength={TAMANHO_MAXIMO_TEXTO_LONGO}
            {...propsAcessibilidade('descricao', [idCampo('descricao-orientacao')])}
          />
          <span id={idCampo('descricao-ajuda')} className="campo__ajuda">
            Obrigatório. Até {TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.
          </span>
          {mensagemCampo('descricao')}
        </div>

        <div className="campo">
          <label htmlFor={idCampo('dataHora')}>Data e hora do contato</label>
          <input type="datetime-local" {...propsAcessibilidade('dataHora')} />
          <span id={idCampo('dataHora-ajuda')} className="campo__ajuda">
            Obrigatório. Horário de São Paulo. Não pode ser no futuro.
          </span>
          {mensagemCampo('dataHora')}
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
