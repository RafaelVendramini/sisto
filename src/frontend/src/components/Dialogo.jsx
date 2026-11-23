import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SELETOR_FOCAVEIS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Campos cujo foco é lembrado para voltar a eles depois da confirmação de descarte.
const SELETOR_CAMPOS = 'input, textarea, select';

export const PERGUNTA_DESCARTE = 'Descartar o que foi digitado?';

/**
 * Confirmação antes de fechar um diálogo com texto digitado (#128): Esc e
 * "Cancelar" chamam `pedirFechamento`; sem texto, fecha direto (`aoFechar`);
 * com texto, devolve `confirmacaoDescarte` para o <Dialogo> mostrar a pergunta.
 * @param {object} opcoes
 * @param {boolean} opcoes.temTextoDigitado
 * @param {() => void} opcoes.aoFechar - fecha o diálogo de fato
 * @returns {{ pedirFechamento: () => void,
 *   confirmacaoDescarte: { aoDescartar: () => void, aoContinuar: () => void } | null }}
 */
export function useConfirmacaoDescarte({ temTextoDigitado, aoFechar }) {
  const [confirmando, setConfirmando] = useState(false);
  const pedirFechamento = useCallback(() => {
    if (temTextoDigitado) setConfirmando(true);
    else aoFechar();
  }, [temTextoDigitado, aoFechar]);
  const continuar = useCallback(() => setConfirmando(false), []);
  return {
    pedirFechamento,
    confirmacaoDescarte: confirmando ? { aoDescartar: aoFechar, aoContinuar: continuar } : null,
  };
}

/**
 * Diálogo modal acessível (RNF02):
 * - ao abrir, leva o foco para `focoInicialRef` (ou para o próprio diálogo);
 * - Tab e Shift+Tab ficam presos dentro do diálogo;
 * - Esc chama `aoFechar` (quem usa decide se pode fechar, ex.: durante o envio);
 * - ao fechar, o foco volta ao elemento que abriu o diálogo; se ele não existir
 *   mais (ex.: o botão "Bloquear" some após bloquear), chama `aoRestaurarFoco`.
 * - a página atrás fica `inert` (sem foco, clique ou leitura por leitor de tela)
 *   enquanto o diálogo está aberto; o diálogo é renderizado direto no <body>;
 * - clicar no fundo não fecha (evita perder o que foi digitado) e devolve o
 *   foco para o diálogo.
 * - com `confirmacaoDescarte` (ver useConfirmacaoDescarte — #128), o conteúdo
 *   fica oculto (sem perder o que foi digitado) e o diálogo pergunta se quer
 *   descartar o texto. O foco vai para "Continuar editando"; Esc também
 *   continua editando; ao continuar, o foco volta ao último campo usado.
 *
 * @param {object} props
 * @param {string} props.id - prefixo dos ids internos (título)
 * @param {string} props.titulo - título visível e nome acessível do diálogo
 * @param {string} [props.descricaoId] - id do texto que descreve o diálogo
 * @param {'dialog' | 'alertdialog'} [props.papel='dialog'] - alertdialog para confirmações
 * @param {() => void} props.aoFechar
 * @param {import('react').RefObject<HTMLElement>} [props.focoInicialRef]
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {{ aoDescartar: () => void, aoContinuar: () => void } | null} [props.confirmacaoDescarte]
 */
export default function Dialogo({
  id,
  titulo,
  descricaoId,
  papel = 'dialog',
  aoFechar,
  focoInicialRef,
  aoRestaurarFoco,
  confirmacaoDescarte = null,
  children,
}) {
  const caixaRef = useRef(null);
  const confirmacaoRef = useRef(null);
  const continuarRef = useRef(null);
  const ultimoCampoRef = useRef(null);
  const confirmando = Boolean(confirmacaoDescarte);
  const confirmandoAntes = useRef(false);
  const aoRestaurarFocoRef = useRef(aoRestaurarFoco);

  useEffect(() => {
    aoRestaurarFocoRef.current = aoRestaurarFoco;
  }, [aoRestaurarFoco]);

  useEffect(() => {
    const origem = document.activeElement;
    const fundo = caixaRef.current?.parentElement;

    // Deixa inerte tudo o que está no <body> fora do diálogo, lembrando quem
    // já era inerte para não alterar esses elementos ao fechar.
    const inertizados = Array.from(document.body.children).filter(
      (elemento) => elemento !== fundo && !elemento.hasAttribute('inert'),
    );
    inertizados.forEach((elemento) => elemento.setAttribute('inert', ''));

    (focoInicialRef?.current ?? caixaRef.current)?.focus();
    return () => {
      // Primeiro tira o inert: elemento inerte não recebe foco.
      inertizados.forEach((elemento) => elemento.removeAttribute('inert'));
      if (origem instanceof HTMLElement && origem !== document.body && origem.isConnected) {
        origem.focus();
      } else {
        aoRestaurarFocoRef.current?.();
      }
    };
    // Executa só ao abrir e ao fechar o diálogo (dependências vazias de propósito).
  }, []);

  // Confirmação de descarte: o foco vai para "Continuar editando"; ao voltar,
  // retorna ao último campo usado (ou ao foco inicial do diálogo).
  useEffect(() => {
    if (confirmando) {
      continuarRef.current?.focus();
    } else if (confirmandoAntes.current) {
      const campo = ultimoCampoRef.current;
      const destino = campo?.isConnected ? campo : (focoInicialRef?.current ?? caixaRef.current);
      destino?.focus();
    }
    confirmandoAntes.current = confirmando;
    // focoInicialRef é uma ref estável: o efeito reage só à confirmação.
  }, [confirmando]);

  function aoFocarDentro(evento) {
    if (evento.target instanceof Element && evento.target.matches(SELETOR_CAMPOS)) {
      ultimoCampoRef.current = evento.target;
    }
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      // Na confirmação de descarte, Esc é "Continuar editando".
      if (confirmacaoDescarte) confirmacaoDescarte.aoContinuar();
      else aoFechar?.();
      return;
    }
    if (evento.key !== 'Tab') return;

    const caixa = caixaRef.current;
    // Durante a confirmação, o Tab fica preso nos botões dela.
    const area = (confirmacaoDescarte && confirmacaoRef.current) || caixa;
    const focaveis = Array.from(area.querySelectorAll(SELETOR_FOCAVEIS));
    if (focaveis.length === 0) {
      evento.preventDefault();
      caixa.focus();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const atual = document.activeElement;
    if (evento.shiftKey && (atual === primeiro || atual === caixa || atual === area)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && atual === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  // Clique no fundo: não deixa o foco sair do diálogo.
  function aoPressionarFundo(evento) {
    if (evento.target !== evento.currentTarget) return;
    evento.preventDefault();
    (confirmacaoDescarte ? continuarRef.current : caixaRef.current)?.focus();
  }

  const idTitulo = `${id}-titulo`;
  const idPergunta = `${id}-descarte-pergunta`;
  const idAviso = `${id}-descarte-aviso`;

  return createPortal(
    <div className="dialogo__fundo" onMouseDown={aoPressionarFundo}>
      <div
        ref={caixaRef}
        className="dialogo"
        role={papel}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descricaoId}
        tabIndex={-1}
        onKeyDown={aoTeclar}
        onFocus={aoFocarDentro}
      >
        <h2 id={idTitulo} className="dialogo__titulo">
          {titulo}
        </h2>
        {/* Oculto (e não desmontado) na confirmação: o texto digitado é preservado. */}
        <div className="dialogo__conteudo" hidden={confirmando}>
          {children}
        </div>
        {confirmacaoDescarte && (
          <div
            ref={confirmacaoRef}
            className="dialogo__confirmacao"
            role="alertdialog"
            aria-labelledby={idPergunta}
            aria-describedby={idAviso}
          >
            <p id={idPergunta} className="dialogo__pergunta">
              {PERGUNTA_DESCARTE}
            </p>
            <p id={idAviso} className="mensagem mensagem--aviso">
              O que você escreveu neste formulário será perdido.
            </p>
            <div className="dialogo__acoes">
              <button
                ref={continuarRef}
                type="button"
                className="botao botao--primario"
                onClick={confirmacaoDescarte.aoContinuar}
              >
                Continuar editando
              </button>
              <button
                type="button"
                className="botao botao--secundario"
                onClick={confirmacaoDescarte.aoDescartar}
              >
                Descartar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
