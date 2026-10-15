import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const SELETOR_FOCAVEIS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
 *
 * @param {object} props
 * @param {string} props.id - prefixo dos ids internos (título)
 * @param {string} props.titulo - título visível e nome acessível do diálogo
 * @param {string} [props.descricaoId] - id do texto que descreve o diálogo
 * @param {'dialog' | 'alertdialog'} [props.papel='dialog'] - alertdialog para confirmações
 * @param {() => void} props.aoFechar
 * @param {import('react').RefObject<HTMLElement>} [props.focoInicialRef]
 * @param {() => void} [props.aoRestaurarFoco]
 */
export default function Dialogo({
  id,
  titulo,
  descricaoId,
  papel = 'dialog',
  aoFechar,
  focoInicialRef,
  aoRestaurarFoco,
  children,
}) {
  const caixaRef = useRef(null);
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

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      evento.stopPropagation();
      aoFechar?.();
      return;
    }
    if (evento.key !== 'Tab') return;

    const caixa = caixaRef.current;
    const focaveis = Array.from(caixa.querySelectorAll(SELETOR_FOCAVEIS));
    if (focaveis.length === 0) {
      evento.preventDefault();
      caixa.focus();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const atual = document.activeElement;
    if (evento.shiftKey && (atual === primeiro || atual === caixa)) {
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
    caixaRef.current?.focus();
  }

  const idTitulo = `${id}-titulo`;

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
      >
        <h2 id={idTitulo} className="dialogo__titulo">
          {titulo}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
