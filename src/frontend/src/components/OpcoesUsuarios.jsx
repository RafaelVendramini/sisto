// Opções (<option>/<optgroup>) dos seletores de usuário dos encaminhamentos,
// compartilhadas pelo registro (#46) e pelo encaminhamento no detalhe (#50).
// Só recebem usuários já filtrados (ativos, só { id, nome }).

/** Lista de <option> com os usuários informados. */
export function OpcoesDeUsuarios({ usuarios }) {
  return usuarios.map((u) => (
    <option key={u.id} value={String(u.id)}>
      {u.nome}
    </option>
  ));
}

/**
 * Tutores em dois grupos (RN03): primeiro os sugeridos (tutores dos estudantes
 * envolvidos), depois os demais. Sem sugeridos, um único grupo "Tutores".
 * @param {object} props
 * @param {Array<{ id: number, nome: string }>} props.sugeridos
 * @param {Array<{ id: number, nome: string }>} props.outros
 * @param {string} props.rotuloSugeridos - ex.: 'Tutores dos estudantes selecionados'
 */
export function OpcoesTutores({ sugeridos, outros, rotuloSugeridos }) {
  return (
    <>
      {sugeridos.length > 0 && (
        <optgroup label={rotuloSugeridos}>
          <OpcoesDeUsuarios usuarios={sugeridos} />
        </optgroup>
      )}
      {outros.length > 0 && (
        <optgroup label={sugeridos.length > 0 ? 'Outros tutores' : 'Tutores'}>
          <OpcoesDeUsuarios usuarios={outros} />
        </optgroup>
      )}
    </>
  );
}

/** Equipe pedagógica ou Gestão: "Toda a equipe" (valor vazio) e as pessoas ativas do perfil. */
export function OpcoesEquipe({ usuarios }) {
  return (
    <>
      <option value="">Toda a equipe</option>
      <OpcoesDeUsuarios usuarios={usuarios} />
    </>
  );
}
