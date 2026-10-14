import { useRef, useState } from 'react';
import { ROTULOS_PERFIL } from '../services/perfis.js';
import {
  ehConflitoDeEmail,
  listaPodeEstarDesatualizada,
  mensagemErroAlteracaoUsuario,
} from '../services/mensagensUsuarios.js';
import { atualizarUsuario } from '../services/usuarios.js';
import Dialogo from './Dialogo.jsx';
import { validarDadosUsuario } from './FormularioUsuario.jsx';

const ORDEM_CAMPOS = ['nome', 'email', 'perfil'];
const MENSAGEM_SEM_ALTERACAO =
  'Nenhum dado foi alterado. Altere algum campo ou clique em "Cancelar".';

/**
 * Diálogo "Editar usuário" (RF04): nome, e-mail e perfil, pré-preenchidos.
 * Mesmas validações do cadastro; a senha não é alterada aqui.
 * Envia ao PUT /usuarios/{id} somente os campos alterados.
 * RN11: no próprio usuário logado, o perfil não pode ser trocado.
 *
 * @param {object} props
 * @param {{ id: number, nome: string, email: string, perfil: string, status: string }} props.usuario
 * @param {boolean} props.ehProprioUsuario
 * @param {(atualizado: object) => void} props.aoSalvar
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404 ou 409 de alteração simultânea
 */
export default function FormularioEdicaoUsuario({
  usuario,
  ehProprioUsuario,
  aoSalvar,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const [dados, setDados] = useState({
    nome: usuario.nome ?? '',
    email: usuario.email ?? '',
    perfil: usuario.perfil ?? '',
  });
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const refs = {
    nome: useRef(null),
    email: useRef(null),
    perfil: useRef(null),
  };

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return; // campos travados durante o envio
      const { value } = evento.target;
      setDados((atual) => ({ ...atual, [campo]: value }));
    };
  }

  function focarPrimeiroInvalido(erros) {
    const campo = ORDEM_CAMPOS.find((nome) => erros[nome]);
    if (campo) refs[campo].current?.focus();
  }

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    const novosErros = validarDadosUsuario(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    const alteracoes = {};
    const nome = dados.nome.trim();
    const email = dados.email.trim();
    if (nome !== usuario.nome) alteracoes.nome = nome;
    if (email !== usuario.email) alteracoes.email = email;
    if (!ehProprioUsuario && dados.perfil !== usuario.perfil) alteracoes.perfil = dados.perfil;

    if (Object.keys(alteracoes).length === 0) {
      setErro(MENSAGEM_SEM_ALTERACAO);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const atualizado = await atualizarUsuario(usuario.id, alteracoes);
      aoSalvar(atualizado ?? { ...usuario, ...alteracoes });
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (listaPodeEstarDesatualizada(falha)) aoListaDesatualizada?.();
      if (ehConflitoDeEmail(falha)) {
        const errosApi = { email: falha.message };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else {
        setErro(mensagemErroAlteracaoUsuario(falha));
      }
    }
  }

  function propsAcessibilidade(campo, ajuda) {
    const descricoes = [ajuda, errosCampos[campo] ? `edicao-${campo}-erro` : null].filter(Boolean);
    return {
      'aria-invalid': Boolean(errosCampos[campo]),
      'aria-describedby': descricoes.length > 0 ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      errosCampos[campo] && (
        <span id={`edicao-${campo}-erro`} className="campo__erro">
          {errosCampos[campo]}
        </span>
      )
    );
  }

  return (
    <Dialogo
      id="dialogo-editar-usuario"
      titulo="Editar usuário"
      descricaoId="dialogo-editar-usuario-descricao"
      aoFechar={cancelar}
      focoInicialRef={refs.nome}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <p id="dialogo-editar-usuario-descricao" className="texto-secundario">
        Altere os dados de {usuario.nome} e clique em &quot;Salvar alterações&quot;. A senha não é
        alterada nesta tela.
      </p>

      {erro && (
        <p className="mensagem mensagem--erro" role="alert">
          {erro}
        </p>
      )}

      <form
        className="formulario"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby="dialogo-editar-usuario-titulo"
      >
        <div className="campo">
          <label htmlFor="edicao-nome">Nome completo</label>
          <input
            ref={refs.nome}
            id="edicao-nome"
            name="nome"
            type="text"
            autoComplete="off"
            value={dados.nome}
            readOnly={enviando}
            onChange={alterar('nome')}
            {...propsAcessibilidade('nome')}
          />
          {mensagemCampo('nome')}
        </div>

        <div className="campo">
          <label htmlFor="edicao-email">E-mail</label>
          <input
            ref={refs.email}
            id="edicao-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={dados.email}
            readOnly={enviando}
            onChange={alterar('email')}
            {...propsAcessibilidade('email')}
          />
          {mensagemCampo('email')}
        </div>

        <div className="campo">
          <label htmlFor="edicao-perfil">Perfil</label>
          <select
            ref={refs.perfil}
            id="edicao-perfil"
            name="perfil"
            value={dados.perfil}
            onChange={alterar('perfil')}
            disabled={ehProprioUsuario}
            aria-readonly={enviando || undefined}
            {...propsAcessibilidade('perfil', ehProprioUsuario ? 'edicao-perfil-ajuda' : undefined)}
          >
            <option value="">Selecione o perfil</option>
            {Object.entries(ROTULOS_PERFIL).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          {ehProprioUsuario && (
            <span id="edicao-perfil-ajuda" className="campo__ajuda">
              Você não pode alterar o seu próprio perfil. Peça a outro usuário da Gestão, se
              necessário.
            </span>
          )}
          {mensagemCampo('perfil')}
        </div>

        <div className="dialogo__acoes">
          <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
            {enviando ? 'Salvando...' : 'Salvar alterações'}
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
