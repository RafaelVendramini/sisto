import { useEffect, useRef, useState } from 'react';
import CampoSenha from '../components/CampoSenha.jsx';
import { useSessao } from '../components/Sessao.jsx';
import {
  MENSAGEM_NOVA_SENHA_IGUAL_ATUAL,
  MENSAGEM_SENHA_ATUAL_INCORRETA,
  trocarPropriaSenha,
} from '../services/conta.js';
import {
  MENSAGEM_SEM_CONEXAO,
  MENSAGEM_SEM_PERMISSAO,
  MENSAGEM_TROCA_SENHA_PENDENTE,
} from '../services/mensagens.js';
import {
  TAMANHO_MAXIMO_SENHA_BYTES,
  TAMANHO_MINIMO_SENHA,
  problemaNaSenha,
} from '../services/senha.js';

const VAZIO = { senhaAtual: '', novaSenha: '', confirmacao: '' };
const ORDEM_CAMPOS = ['senhaAtual', 'novaSenha', 'confirmacao'];
const MENSAGEM_GENERICA = 'Não foi possível alterar a senha agora. Tente novamente em instantes.';

/**
 * Valida os campos antes do envio (RN10, RNF02). A confirmação existe só
 * no front-end, para evitar erro de digitação; não vai para a API.
 * @returns {Record<string, string>} { campo: mensagem }
 */
export function validarTrocaSenha({ senhaAtual, novaSenha, confirmacao }) {
  const erros = {};
  if (!senhaAtual) erros.senhaAtual = 'Informe a sua senha atual.';

  if (!novaSenha) erros.novaSenha = 'Informe a nova senha.';
  else {
    const problema = problemaNaSenha(novaSenha);
    if (problema) erros.novaSenha = problema;
    else if (senhaAtual && novaSenha === senhaAtual) {
      erros.novaSenha = MENSAGEM_NOVA_SENHA_IGUAL_ATUAL;
    }
  }

  if (!confirmacao) erros.confirmacao = 'Repita a nova senha para confirmar.';
  else if (novaSenha && confirmacao !== novaSenha) {
    erros.confirmacao = 'A confirmação não é igual à nova senha. Digite a mesma senha nos dois campos.';
  }
  return erros;
}

// Tela "Alterar minha senha" (RF03): todos os perfis. Também é a tela da troca
// obrigatória depois de uma redefinição pela Gestão (RN10). Após a troca, o
// token atual deixa de valer (RN12): a sessão é descartada e o usuário entra
// de novo. As senhas ficam só no estado dos campos, nunca no navegador.
export default function AlterarSenha() {
  const { trocaSenhaPendente, concluirTrocaSenha } = useSessao();
  const [dados, setDados] = useState(VAZIO);
  const [errosCampos, setErrosCampos] = useState({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mostrar, setMostrar] = useState({ senhaAtual: false, novaSenha: false, confirmacao: false });
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const refs = {
    senhaAtual: useRef(null),
    novaSenha: useRef(null),
    confirmacao: useRef(null),
  };

  useEffect(() => {
    refs.senhaAtual.current?.focus();
    // Só ao abrir a tela (dependências vazias de propósito).
  }, []);

  function alterar(campo) {
    return (evento) => {
      if (enviandoRef.current) return;
      const { value } = evento.target;
      setDados((atual) => ({ ...atual, [campo]: value }));
    };
  }

  function alternar(campo) {
    return () => setMostrar((atual) => ({ ...atual, [campo]: !atual[campo] }));
  }

  function focarPrimeiroInvalido(erros) {
    const campo = ORDEM_CAMPOS.find((nome) => erros[nome]);
    if (campo) refs[campo].current?.focus();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    const novosErros = validarTrocaSenha(dados);
    setErrosCampos(novosErros);
    if (Object.keys(novosErros).length > 0) {
      focarPrimeiroInvalido(novosErros);
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      await trocarPropriaSenha({ senhaAtual: dados.senhaAtual, novaSenha: dados.novaSenha });
      // 204: o token usado deixou de valer (RN12) — volta ao login.
      concluirTrocaSenha();
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      const status = falha?.status;
      if (status === 401) return; // tratamento central: volta ao login com aviso
      // Após erro, as senhas voltam a ficar mascaradas.
      setMostrar({ senhaAtual: false, novaSenha: false, confirmacao: false });
      const mensagemServidor = falha?.doServidor ? falha.message : '';
      if (status === 400 && mensagemServidor === MENSAGEM_SENHA_ATUAL_INCORRETA) {
        setDados((atual) => ({ ...atual, senhaAtual: '' }));
        const errosApi = { senhaAtual: mensagemServidor };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else if (status === 400 && mensagemServidor === MENSAGEM_NOVA_SENHA_IGUAL_ATUAL) {
        const errosApi = { novaSenha: mensagemServidor };
        setErrosCampos(errosApi);
        focarPrimeiroInvalido(errosApi);
      } else if ((status === 400 || status === 409) && mensagemServidor) {
        setErro(mensagemServidor);
      } else if (status === 403) {
        setErro(MENSAGEM_SEM_PERMISSAO);
      } else if (status === 0) {
        setErro(MENSAGEM_SEM_CONEXAO);
      } else {
        setErro(MENSAGEM_GENERICA);
      }
    }
  }

  function propsAcessibilidade(campo, ajuda) {
    const descricoes = [ajuda, errosCampos[campo] ? `conta-${campo}-erro` : null].filter(Boolean);
    return {
      'aria-invalid': Boolean(errosCampos[campo]),
      'aria-describedby': descricoes.length > 0 ? descricoes.join(' ') : undefined,
    };
  }

  function mensagemCampo(campo) {
    return (
      errosCampos[campo] && (
        <span id={`conta-${campo}-erro`} className="campo__erro">
          {errosCampos[campo]}
        </span>
      )
    );
  }

  return (
    <section className="cartao cartao--login" aria-labelledby="titulo-alterar-senha">
      <h1 id="titulo-alterar-senha">Alterar minha senha</h1>

      {trocaSenhaPendente ? (
        <div className="mensagem mensagem--aviso" role="note">
          <p>{MENSAGEM_TROCA_SENHA_PENDENTE}</p>
          <p>
            Em &quot;Senha atual&quot;, use a senha temporária que a Gestão entregou a você. Depois
            da troca, entre de novo com a nova senha.
          </p>
        </div>
      ) : (
        <p className="texto-secundario">
          Informe a sua senha atual e escolha uma nova. Depois da troca, você vai precisar entrar
          de novo com a nova senha.
        </p>
      )}

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
        aria-labelledby="titulo-alterar-senha"
      >
        <div className="campo">
          <label htmlFor="conta-senha-atual">Senha atual</label>
          <CampoSenha
            inputRef={refs.senhaAtual}
            id="conta-senha-atual"
            name="senhaAtual"
            autoComplete="current-password"
            value={dados.senhaAtual}
            readOnly={enviando}
            onChange={alterar('senhaAtual')}
            mostrar={mostrar.senhaAtual}
            aoAlternar={alternar('senhaAtual')}
            {...propsAcessibilidade('senhaAtual')}
          />
          {mensagemCampo('senhaAtual')}
        </div>

        <div className="campo">
          <label htmlFor="conta-nova-senha">Nova senha</label>
          <CampoSenha
            inputRef={refs.novaSenha}
            id="conta-nova-senha"
            name="novaSenha"
            autoComplete="new-password"
            value={dados.novaSenha}
            readOnly={enviando}
            onChange={alterar('novaSenha')}
            mostrar={mostrar.novaSenha}
            aoAlternar={alternar('novaSenha')}
            {...propsAcessibilidade('novaSenha', 'conta-nova-senha-ajuda')}
          />
          <span id="conta-nova-senha-ajuda" className="campo__ajuda">
            De {TAMANHO_MINIMO_SENHA} a {TAMANHO_MAXIMO_SENHA_BYTES} caracteres (letras acentuadas
            contam como 2), diferente da senha atual.
          </span>
          {mensagemCampo('novaSenha')}
        </div>

        <div className="campo">
          <label htmlFor="conta-confirmacao">Confirme a nova senha</label>
          <CampoSenha
            inputRef={refs.confirmacao}
            id="conta-confirmacao"
            name="confirmacao"
            autoComplete="new-password"
            value={dados.confirmacao}
            readOnly={enviando}
            onChange={alterar('confirmacao')}
            mostrar={mostrar.confirmacao}
            aoAlternar={alternar('confirmacao')}
            {...propsAcessibilidade('confirmacao')}
          />
          {mensagemCampo('confirmacao')}
        </div>

        <button type="submit" className="botao botao--primario botao--largo" disabled={enviando}>
          {enviando ? 'Alterando...' : 'Alterar senha'}
        </button>
      </form>
    </section>
  );
}
