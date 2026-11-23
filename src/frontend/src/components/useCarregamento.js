import { useCallback, useEffect, useRef } from 'react';

/**
 * true quando a falha deve aparecer na tela. O 401 não aparece: o tratamento
 * central (Sessao.jsx) já leva ao login com aviso.
 * @param {{ status?: number } | undefined} falha
 * @returns {boolean}
 */
export function exibirFalha(falha) {
  return falha?.status !== 401;
}

/**
 * Controle comum das telas que buscam dados na API:
 * - `montado`: ref que fica false quando a tela sai, para não atualizar estado
 *   de um componente desmontado (também em StrictMode, que monta duas vezes);
 * - `novaRequisicao()`: marca uma nova busca e devolve `vigente()`, que só é
 *   true enquanto a tela está montada e nenhuma busca mais nova começou
 *   (a resposta atrasada de uma busca antiga é descartada).
 *
 * Chame o hook antes dos efeitos que fazem a primeira busca: os efeitos rodam
 * na ordem em que são declarados, e `montado` precisa estar true antes.
 */
export function useCarregamento() {
  const montado = useRef(true);
  const ultimaRequisicao = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const novaRequisicao = useCallback(() => {
    ultimaRequisicao.current += 1;
    const requisicao = ultimaRequisicao.current;
    return () => montado.current && requisicao === ultimaRequisicao.current;
  }, []);

  return { montado, novaRequisicao };
}
