/**
 * Campo de senha com botão "Mostrar senha"/"Ocultar senha" (RNF02).
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
 * @param {string} props.autoComplete - ex.: "current-password" ou "off"
 * Demais props (name, value, onChange, aria-*) vão direto para o <input>.
 */
export default function CampoSenha({ id, mostrar, aoAlternar, inputRef, ...propsInput }) {
  return (
    <div className="campo__senha">
      <input ref={inputRef} id={id} {...propsInput} type={mostrar ? 'text' : 'password'} />
      <button
        type="button"
        className="botao botao--secundario"
        aria-controls={id}
        aria-pressed={mostrar}
        onClick={aoAlternar}
      >
        {mostrar ? 'Ocultar senha' : 'Mostrar senha'}
      </button>
    </div>
  );
}
