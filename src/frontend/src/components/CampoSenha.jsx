/**
 * Campo de senha com botão de olho para mostrar/ocultar a senha (RNF02).
 * O botão fica dentro do campo, à direita: olho aberto = "Mostrar senha",
 * olho cortado = "Ocultar senha". O texto não aparece na tela, mas é o nome
 * acessível do botão (aria-label), lido por leitores de tela.
 * O rótulo (<label htmlFor={id}>) e as mensagens de erro ficam com quem usa.
 * A visibilidade é controlada pelo formulário (`mostrar`/`aoAlternar`), para que
 * ele possa voltar a mascarar a senha (ex.: após erro de login ou cadastro).
 * O botão é type="button": alternar nunca envia o formulário.
 *
 * @param {object} props
 * @param {string} props.id - id do input (usado no aria-controls do botão)
 * @param {boolean} props.mostrar - true exibe a senha em texto
 * @param {() => void} props.aoAlternar - chamado ao clicar no botão
 * @param {import('react').Ref<HTMLInputElement>} [props.inputRef]
 * @param {string} props.autoComplete - "current-password" (login) ou "new-password"
 *   (senha nova ou temporária: o navegador não preenche com a senha salva — #56)
 * Demais props (name, value, onChange, aria-*) vão direto para o <input>.
 */
export default function CampoSenha({ id, mostrar, aoAlternar, inputRef, ...propsInput }) {
  // O nome acessível descreve a ação do próximo clique (sem aria-pressed, para
  // não combinar rótulo que muda com estado de alternância). O title mostra
  // a dica ao passar o mouse.
  const rotulo = mostrar ? 'Ocultar senha' : 'Mostrar senha';
  return (
    <div className="campo__senha">
      <input ref={inputRef} id={id} {...propsInput} type={mostrar ? 'text' : 'password'} />
      <button
        type="button"
        className="campo__senha-botao"
        aria-label={rotulo}
        title={rotulo}
        aria-controls={id}
        onClick={aoAlternar}
      >
        {mostrar ? <IconeOlhoCortado /> : <IconeOlho />}
      </button>
    </div>
  );
}

// Ícones em SVG inline (sem dependência nova); decorativos para leitores de tela.
const PROPS_ICONE = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

function IconeOlho() {
  return (
    <svg {...PROPS_ICONE} data-icone="olho">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconeOlhoCortado() {
  return (
    <svg {...PROPS_ICONE} data-icone="olho-cortado">
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.9" />
      <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
