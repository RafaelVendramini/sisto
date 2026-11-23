import { useRef, useState } from 'react';

/**
 * Estado comum dos formulários de cadastro e edição (categorias, turmas e
 * estudantes): valores dos campos, erros por campo, trava de envio e foco no
 * primeiro campo inválido (RNF02).
 *
 * @param {Record<string, string> | (() => Record<string, string>)} valoresIniciais
 * @param {string[]} ordemCampos - ordem dos campos na tela (define o foco)
 * @param {object} [opcoes]
 * @param {(campo: string) => void} [opcoes.aoAlterarCampo] - chamado depois de
 *   cada alteração aceita (ex.: limpar um aviso de conflito)
 * @returns {{
 *   dados: Record<string, string>,
 *   setDados: Function,
 *   errosCampos: Record<string, string>,
 *   setErrosCampos: Function,
 *   enviandoRef: { current: boolean },
 *   refs: Record<string, { current: HTMLElement | null }>,
 *   alterar: (campo: string) => (evento: Event) => void,
 *   focarPrimeiroInvalido: (erros: Record<string, string>) => void,
 * }}
 */
export function useCamposFormulario(valoresIniciais, ordemCampos, { aoAlterarCampo } = {}) {
  const [dados, setDados] = useState(valoresIniciais);
  const [errosCampos, setErrosCampos] = useState({});
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);
  // Um ref por campo, criado uma vez só (passado aos campos pelo `refs`).
  const [refs] = useState(() =>
    Object.fromEntries(ordemCampos.map((campo) => [campo, { current: null }])),
  );

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return; // campos travados durante o envio
      const { value } = evento.target;
      setDados((atual) => ({ ...atual, [campo]: value }));
      // Ao corrigir o campo, a mensagem de erro dele (e o aria-invalid) some.
      setErrosCampos((atual) => {
        if (!atual[campo]) return atual;
        const { [campo]: _removido, ...restantes } = atual;
        return restantes;
      });
      aoAlterarCampo?.(campo);
    };
  }

  function focarPrimeiroInvalido(erros) {
    const campo = ordemCampos.find((nome) => erros[nome]);
    if (campo) refs[campo]?.current?.focus();
  }

  return {
    dados,
    setDados,
    errosCampos,
    setErrosCampos,
    enviandoRef,
    refs,
    alterar,
    focarPrimeiroInvalido,
  };
}
