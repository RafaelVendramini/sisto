import { useRef, useState } from 'react';
import { mensagemErroRedefinicaoSenha } from '../services/mensagensUsuarios.js';
import { rotuloStatus } from '../services/perfis.js';
import {
  TAMANHO_MAXIMO_SENHA_BYTES,
  TAMANHO_MINIMO_SENHA,
  problemaNaSenha,
} from '../services/senha.js';
import { redefinirSenhaUsuario } from '../services/usuarios.js';
import CampoSenha from './CampoSenha.jsx';
import Dialogo from './Dialogo.jsx';

/**
 * Diálogo "Redefinir senha" (RF03, RN10, RN12): a Gestão define uma nova senha
 * temporária para OUTRO usuário. Ao abrir a tela de usuários, o botão não
 * aparece para o próprio usuário logado (o back-end responde 409 nesse caso).
 * Usuário bloqueado ou desativado continua sem acesso até ser reativado (RN09).
 * A senha fica só no estado do campo: não vai para o armazenamento do
 * navegador, para log nem para a mensagem de sucesso.
 *
 * @param {object} props
 * @param {{ id: number, nome: string, status: string }} props.usuario
 * @param {(usuario: object) => void} props.aoConcluir
 * @param {() => void} props.aoCancelar
 * @param {() => void} [props.aoRestaurarFoco]
 * @param {() => void} [props.aoListaDesatualizada] - chamado após 404
 */
export default function RedefinirSenhaUsuario({
  usuario,
  aoConcluir,
  aoCancelar,
  aoRestaurarFoco,
  aoListaDesatualizada,
}) {
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroCampo, setErroCampo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const senhaRef = useRef(null);
  // Trava síncrona contra duplo envio (o estado só muda no próximo render).
  const enviandoRef = useRef(false);

  const semAcesso = usuario.status === 'BLOQUEADO' || usuario.status === 'DESATIVADO';

  function cancelar() {
    if (enviandoRef.current) return;
    aoCancelar();
  }

  async function aoEnviar(evento) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    setErro('');
    const problema = senha ? problemaNaSenha(senha) : 'Informe a nova senha temporária.';
    setErroCampo(problema);
    if (problema) {
      senhaRef.current?.focus();
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      await redefinirSenhaUsuario(usuario.id, senha);
      setSenha('');
      aoConcluir(usuario);
    } catch (falha) {
      enviandoRef.current = false;
      setEnviando(false);
      setMostrarSenha(false);
      if (falha?.status === 401) return; // tratamento central: volta ao login com aviso
      if (falha?.status === 404) aoListaDesatualizada?.();
      const mensagem = mensagemErroRedefinicaoSenha(falha);
      if (falha?.status === 400) {
        setErroCampo(mensagem);
        senhaRef.current?.focus();
      } else {
        setErro(mensagem);
      }
    }
  }

  const descricoes = ['redefinir-senha-ajuda', erroCampo ? 'redefinir-senha-erro' : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Dialogo
      id="dialogo-redefinir-senha"
      titulo="Redefinir senha"
      descricaoId="dialogo-redefinir-senha-descricao"
      aoFechar={cancelar}
      focoInicialRef={senhaRef}
      aoRestaurarFoco={aoRestaurarFoco}
    >
      <div id="dialogo-redefinir-senha-descricao">
        <p className="dialogo__pergunta">Definir uma nova senha temporária para {usuario.nome}.</p>
        <p>
          Entregue a nova senha pessoalmente a {usuario.nome}. No próximo acesso, será obrigatório
          trocá-la por uma senha pessoal. As sessões abertas desse usuário serão encerradas.
        </p>
        {semAcesso && (
          <p className="mensagem mensagem--aviso">
            {usuario.nome} está {rotuloStatus(usuario.status).toLowerCase()}: mesmo com a nova
            senha, continuará sem acesso ao Sisto até ser reativado.
          </p>
        )}
      </div>

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
        aria-labelledby="dialogo-redefinir-senha-titulo"
      >
        <div className="campo">
          <label htmlFor="redefinir-senha">Nova senha temporária</label>
          <CampoSenha
            inputRef={senhaRef}
            id="redefinir-senha"
            name="novaSenha"
            autoComplete="off"
            value={senha}
            readOnly={enviando}
            onChange={(e) => {
              if (!enviandoRef.current) setSenha(e.target.value);
            }}
            mostrar={mostrarSenha}
            aoAlternar={() => setMostrarSenha((atual) => !atual)}
            aria-invalid={Boolean(erroCampo)}
            aria-describedby={descricoes}
          />
          <span id="redefinir-senha-ajuda" className="campo__ajuda">
            De {TAMANHO_MINIMO_SENHA} a {TAMANHO_MAXIMO_SENHA_BYTES} caracteres (letras acentuadas
            contam como 2).
          </span>
          {erroCampo && (
            <span id="redefinir-senha-erro" className="campo__erro">
              {erroCampo}
            </span>
          )}
        </div>

        <div className="dialogo__acoes">
          <button type="submit" className="botao botao--primario" aria-disabled={enviando}>
            {enviando ? 'Redefinindo...' : 'Redefinir senha'}
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
