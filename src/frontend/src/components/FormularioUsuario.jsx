import { useRef, useState } from 'react';
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from '../services/mensagens.js';
import { MENSAGEM_EMAIL_DUPLICADO } from '../services/mensagensUsuarios.js';
import { ROTULOS_PERFIL } from '../services/perfis.js';
import { cadastrarUsuario } from '../services/usuarios.js';
import {
  TAMANHO_MAXIMO_SENHA_BYTES,
  TAMANHO_MINIMO_SENHA,
  problemaNaSenha,
} from '../services/senha.js';
import CampoSenha from './CampoSenha.jsx';

export { TAMANHO_MAXIMO_SENHA_BYTES, TAMANHO_MINIMO_SENHA };
export const TAMANHO_MAXIMO_NOME = 150;
export const TAMANHO_MAXIMO_EMAIL = 254;

const MENSAGEM_GENERICA = 'Não foi possível cadastrar o usuário agora. Tente novamente em instantes.';

// Mesmo formato aceito pelo back-end (algo@dominio.ext, sem pontos seguidos no
// domínio); a validação definitiva continua sendo a do back-end.
const FORMATO_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const VAZIO = { nome: '', email: '', perfil: '', senha: '' };
const ORDEM_CAMPOS = ['nome', 'email', 'perfil', 'senha'];

/**
 * Valida nome, e-mail e perfil (usada no cadastro e na edição — RF01, RF04).
 * Retorna { campo: mensagem }.
 */
export function validarDadosUsuario({ nome, email, perfil }) {
  const erros = {};
  const nomeLimpo = String(nome ?? '').trim();
  const emailLimpo = String(email ?? '').trim();

  if (!nomeLimpo) erros.nome = 'Informe o nome.';
  else if (nomeLimpo.length > TAMANHO_MAXIMO_NOME) {
    erros.nome = `O nome deve ter no máximo ${TAMANHO_MAXIMO_NOME} caracteres.`;
  }

  if (!emailLimpo) erros.email = 'Informe o e-mail.';
  else if (emailLimpo.length > TAMANHO_MAXIMO_EMAIL) {
    erros.email = `O e-mail deve ter no máximo ${TAMANHO_MAXIMO_EMAIL} caracteres.`;
  } else if (!FORMATO_EMAIL.test(emailLimpo)) {
    erros.email = 'Informe um e-mail em formato válido (ex.: nome@escola.com).';
  }

  if (!perfil) erros.perfil = 'Selecione o perfil.';
  else if (!Object.hasOwn(ROTULOS_PERFIL, perfil)) erros.perfil = 'Selecione um perfil da lista.';

  return erros;
}

/**
 * Confirmação do cadastro (RF01, RN10): o usuário é criado com troca de senha
 * obrigatória, então a Gestão é avisada de que a senha temporária será trocada
 * no primeiro acesso. A senha nunca aparece na mensagem.
 */
export function mensagemCadastroConcluido(nome) {
  return `Usuário ${nome} cadastrado com sucesso. Entregue a senha temporária pessoalmente: no primeiro acesso, será obrigatório trocá-la.`;
}

/** Valida os dados do cadastro antes do envio (RN10). Retorna { campo: mensagem }. */
export function validarCadastro({ nome, email, perfil, senha }) {
  const erros = validarDadosUsuario({ nome, email, perfil });

  if (!senha) erros.senha = 'Informe a senha temporária.';
  else if (problemaNaSenha(senha)) erros.senha = problemaNaSenha(senha);

  return erros;
}

/**
 * Formulário "Cadastrar usuário" (RF01, RN10). Envia POST /usuarios e avisa
 * a página pelo `aoCadastrar` com o usuário criado (sem a senha).
 * A senha temporária fica apenas no estado do campo e é apagada após o sucesso.
 */
export default function FormularioUsuario({ aoCadastrar }) {
  const [dados, setDados] = useState(VAZIO);
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const refs = {
    nome: useRef(null),
    email: useRef(null),
    perfil: useRef(null),
    senha: useRef(null),
  };

  function alterar(campo) {
    return (evento) => setDados((atual) => ({ ...atual, [campo]: evento.target.value }));
  }

  function focarPrimeiroInvalido(erros) {
    const campo = ORDEM_CAMPOS.find((nome) => erros[nome]);
    if (campo) refs[campo].current?.focus();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviando) return;

    setErro('');
    setSucesso('');
    const novosErros = validarCadastro(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    setEnviando(true);
    try {
      const criado = await cadastrarUsuario({
        nome: dados.nome.trim(),
        email: dados.email.trim(),
        perfil: dados.perfil,
        senha: dados.senha,
      });
      setDados(VAZIO);
      setMostrarSenha(false);
      setSucesso(mensagemCadastroConcluido(criado?.nome ?? dados.nome.trim()));
      aoCadastrar?.(criado);
      refs.nome.current?.focus();
    } catch (falha) {
      const status = falha?.status;
      if (status === 401) return; // tratamento central: volta ao login com aviso
      if (status === 409) {
        const errosApi = { email: MENSAGEM_EMAIL_DUPLICADO };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else if (status === 400 && falha?.doServidor && falha?.message) {
        setErro(falha.message);
      } else if (status === 403) {
        setErro(MENSAGEM_SEM_PERMISSAO);
      } else if (status === 0) {
        setErro(MENSAGEM_SEM_CONEXAO);
      } else {
        setErro(MENSAGEM_GENERICA);
      }
    } finally {
      setEnviando(false);
    }
  }

  function propsAcessibilidade(campo, ajuda) {
    const descricoes = [ajuda, errosCampos[campo] ? `usuario-${campo}-erro` : null].filter(Boolean);
    return {
      'aria-invalid': Boolean(errosCampos[campo]),
      'aria-describedby': descricoes.length > 0 ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      errosCampos[campo] && (
        <span id={`usuario-${campo}-erro`} className="campo__erro">
          {errosCampos[campo]}
        </span>
      )
    );
  }

  return (
    <>
      <div role="status" aria-live="polite">
        {sucesso && <p className="mensagem mensagem--sucesso">{sucesso}</p>}
      </div>

      {erro && (
        <p className="mensagem mensagem--erro" role="alert">
          {erro}
        </p>
      )}

      <form
        className="formulario formulario--usuario"
        onSubmit={aoEnviar}
        noValidate
        aria-busy={enviando}
        aria-labelledby="titulo-cadastrar-usuario"
      >
        <div className="campo">
          <label htmlFor="usuario-nome">Nome completo</label>
          <input
            ref={refs.nome}
            id="usuario-nome"
            name="nome"
            type="text"
            autoComplete="off"
            value={dados.nome}
            onChange={alterar('nome')}
            {...propsAcessibilidade('nome')}
          />
          {mensagemCampo('nome')}
        </div>

        <div className="campo">
          <label htmlFor="usuario-email">E-mail</label>
          <input
            ref={refs.email}
            id="usuario-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={dados.email}
            onChange={alterar('email')}
            {...propsAcessibilidade('email')}
          />
          {mensagemCampo('email')}
        </div>

        <div className="campo">
          <label htmlFor="usuario-perfil">Perfil</label>
          <select
            ref={refs.perfil}
            id="usuario-perfil"
            name="perfil"
            value={dados.perfil}
            onChange={alterar('perfil')}
            {...propsAcessibilidade('perfil')}
          >
            <option value="">Selecione o perfil</option>
            {Object.entries(ROTULOS_PERFIL).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
          {mensagemCampo('perfil')}
        </div>

        <div className="campo">
          <label htmlFor="usuario-senha">Senha temporária</label>
          <CampoSenha
            inputRef={refs.senha}
            id="usuario-senha"
            name="senha"
            autoComplete="new-password"
            value={dados.senha}
            onChange={alterar('senha')}
            mostrar={mostrarSenha}
            aoAlternar={() => setMostrarSenha((atual) => !atual)}
            {...propsAcessibilidade('senha', 'usuario-senha-ajuda')}
          />
          <span id="usuario-senha-ajuda" className="campo__ajuda">
            De {TAMANHO_MINIMO_SENHA} a {TAMANHO_MAXIMO_SENHA_BYTES} caracteres (letras acentuadas
            contam como 2). Entregue essa senha ao novo usuário: no primeiro acesso, será
            obrigatório trocá-la.
          </span>
          {mensagemCampo('senha')}
        </div>

        <button type="submit" className="botao botao--primario" disabled={enviando}>
          {enviando ? 'Cadastrando...' : 'Cadastrar usuário'}
        </button>
      </form>
    </>
  );
}
