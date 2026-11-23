// Validação e montagem do envio dos formulários de ocorrência (UC01, UC02,
// UC04, RN02, RN03, RN14, RN15, RN16, RN17): registro, encaminhamento,
// comunicação e providência. É só usabilidade: a validação definitiva é a do
// back-end (400). Separado de mensagensOcorrencias.js (#129), que continua
// reexportando tudo daqui.
import { dataHoraParaEnvio } from './dataHora.js';
import { idParaEnvio, limparTexto } from './mensagensEstudantes.js';
import { perfilDoDestinatario } from './rotulosOcorrencia.js';

// Limites do back-end (decisões do Rafael na Issue #45), após remover espaços nas pontas.
export const TAMANHO_MAXIMO_LOCAL = 150;
export const TAMANHO_MAXIMO_TEXTO_LONGO = 5000;
export const MAXIMO_ESTUDANTES = 50;
export const MAXIMO_DESTINATARIOS = 10;

/** RN17: a API aceita até 5 minutos à frente do relógio do servidor. */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

export const MENSAGEM_TURMA_OBRIGATORIA = 'Selecione a turma da ocorrência.';
export const MENSAGEM_ESTUDANTES_OBRIGATORIOS = 'Selecione ao menos um estudante envolvido.';
export const MENSAGEM_ESTUDANTES_EXCEDIDOS = `Selecione no máximo ${MAXIMO_ESTUDANTES} estudantes por ocorrência.`;
export const MENSAGEM_CATEGORIA_OBRIGATORIA = 'Selecione a categoria da ocorrência.';
export const MENSAGEM_DESCRICAO_OBRIGATORIA = 'Descreva o fato.';
export const MENSAGEM_DATA_HORA_OBRIGATORIA = 'Informe a data e a hora em que o fato aconteceu.';
export const MENSAGEM_DATA_HORA_FUTURA =
  'A data e a hora não podem estar no futuro. Informe quando o fato aconteceu.';
export const MENSAGEM_LOCAL_OBRIGATORIO = 'Informe o local onde o fato aconteceu.';
export const MENSAGEM_DESTINATARIOS_OBRIGATORIOS =
  'Adicione ao menos um destinatário (tutor, equipe pedagógica ou gestão).';
export const MENSAGEM_DESTINATARIOS_EXCEDIDOS = `Adicione no máximo ${MAXIMO_DESTINATARIOS} destinatários.`;
export const MENSAGEM_TIPO_DESTINATARIO_OBRIGATORIO = 'Escolha para quem a ocorrência será encaminhada.';
export const MENSAGEM_TUTOR_OBRIGATORIO = 'Escolha o tutor que vai receber a ocorrência.';
export const MENSAGEM_REVISAR_CAMPOS = 'Confira os campos destacados antes de enviar.';
export const MENSAGEM_RESPONSAVEL_OBRIGATORIO =
  'Escolha o responsável pelo acompanhamento. Ele é obrigatório quando a ocorrência está "Aberto".';
export const MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO = 'Informe com quem foi feito o contato.';
export const MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO = 'Informe por qual meio o contato foi feito.';
export const MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA = 'Descreva o que foi tratado no contato.';
export const MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA = 'Informe a data e a hora do contato.';
export const MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA =
  'A data e a hora não podem estar no futuro. Informe quando o contato foi feito.';
export const MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA = 'Descreva a providência adotada.';
export const MENSAGEM_PROVIDENCIA_DESCRICAO_LONGA = `A descrição deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;

/** Limite de destinatário e meio (decisão do Rafael na Issue #51). */
export const TAMANHO_MAXIMO_DESTINATARIO_MEIO = 150;

/** "Este destinatário repete o destinatário 1. Remova um deles." */
export function mensagemDestinatarioRepetido(posicaoOriginal) {
  return `Este destinatário repete o destinatário ${posicaoOriginal}. Remova um deles.`;
}

/** Texto opcional para envio: limpo, ou null quando vazio. */
export function textoOpcionalParaEnvio(valor) {
  const texto = limparTexto(valor);
  return texto === '' ? null : texto;
}

/**
 * Valida o formulário antes do envio (UC01). É só usabilidade: a validação
 * definitiva é a do back-end (400).
 * @param {object} dados - campos do formulário (texto)
 * @param {Array<object>} estudantes - estudantes selecionados
 * @param {Array<{ chave: number, destinatarioPerfil: string, destinatarioUsuarioId: string }>} destinatarios
 * @param {number} [agoraMs]
 * @returns {{ erros: Record<string, string>, errosDestinatarios: Record<number, Record<string, string>> }}
 */
export function validarRegistro(dados, estudantes, destinatarios, agoraMs = Date.now()) {
  const erros = {};
  const errosDestinatarios = {};

  if (idParaEnvio(dados.turmaId) === null) erros.turmaId = MENSAGEM_TURMA_OBRIGATORIA;

  if (estudantes.length === 0) erros.estudantes = MENSAGEM_ESTUDANTES_OBRIGATORIOS;
  else if (estudantes.length > MAXIMO_ESTUDANTES) erros.estudantes = MENSAGEM_ESTUDANTES_EXCEDIDOS;

  if (idParaEnvio(dados.categoriaId) === null) erros.categoriaId = MENSAGEM_CATEGORIA_OBRIGATORIA;

  const descricao = limparTexto(dados.descricao);
  if (!descricao) erros.descricao = MENSAGEM_DESCRICAO_OBRIGATORIA;
  else if (descricao.length > TAMANHO_MAXIMO_TEXTO_LONGO) {
    erros.descricao = `A descrição deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;
  }

  const dataHora = dataHoraParaEnvio(dados.dataHora);
  if (!dataHora) erros.dataHora = MENSAGEM_DATA_HORA_OBRIGATORIA;
  else if (dataHora.instanteMs > agoraMs + TOLERANCIA_FUTURO_MS) {
    erros.dataHora = MENSAGEM_DATA_HORA_FUTURA;
  }

  const local = limparTexto(dados.local);
  if (!local) erros.local = MENSAGEM_LOCAL_OBRIGATORIO;
  else if (local.length > TAMANHO_MAXIMO_LOCAL) {
    erros.local = `O local deve ter no máximo ${TAMANHO_MAXIMO_LOCAL} caracteres.`;
  }

  for (const campo of ['demaisEnvolvidos', 'testemunhas', 'providenciasImediatas', 'observacoes']) {
    if (limparTexto(dados[campo]).length > TAMANHO_MAXIMO_TEXTO_LONGO) {
      erros[campo] = `Este campo deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;
    }
  }

  if (destinatarios.length === 0) erros.destinatarios = MENSAGEM_DESTINATARIOS_OBRIGATORIOS;
  else if (destinatarios.length > MAXIMO_DESTINATARIOS) {
    erros.destinatarios = MENSAGEM_DESTINATARIOS_EXCEDIDOS;
  }

  // Repetido = mesmo tipo e mesmo usuário ("toda a equipe" também conta),
  // como no back-end (decisão do Rafael na Issue #45).
  const primeiraPosicao = new Map();
  destinatarios.forEach((destinatario, indice) => {
    const errosLinha = {};
    const { destinatarioPerfil } = destinatario;
    const usuarioId = idParaEnvio(destinatario.destinatarioUsuarioId);
    if (!perfilDoDestinatario(destinatarioPerfil)) {
      errosLinha.destinatarioPerfil = MENSAGEM_TIPO_DESTINATARIO_OBRIGATORIO;
    } else if (destinatarioPerfil === 'TUTOR' && usuarioId === null) {
      errosLinha.destinatarioUsuarioId = MENSAGEM_TUTOR_OBRIGATORIO;
    } else {
      const chave = `${destinatarioPerfil}|${usuarioId ?? 'toda-a-equipe'}`;
      if (primeiraPosicao.has(chave)) {
        errosLinha.destinatarioUsuarioId = mensagemDestinatarioRepetido(primeiraPosicao.get(chave));
      } else {
        primeiraPosicao.set(chave, indice + 1);
      }
    }
    if (limparTexto(destinatario.observacao).length > TAMANHO_MAXIMO_TEXTO_LONGO) {
      errosLinha.observacao = `A observação deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;
    }
    if (Object.keys(errosLinha).length > 0) errosDestinatarios[destinatario.chave] = errosLinha;
  });

  return { erros, errosDestinatarios };
}

/** Monta o corpo do POST /ocorrencias a partir do formulário já validado. */
export function montarEnvio(dados, estudantes, destinatarios) {
  return {
    dataHora: dataHoraParaEnvio(dados.dataHora)?.iso ?? null,
    local: limparTexto(dados.local),
    turmaId: idParaEnvio(dados.turmaId),
    categoriaId: idParaEnvio(dados.categoriaId),
    descricao: limparTexto(dados.descricao),
    estudanteIds: estudantes.map((e) => e.id),
    demaisEnvolvidos: textoOpcionalParaEnvio(dados.demaisEnvolvidos),
    testemunhas: textoOpcionalParaEnvio(dados.testemunhas),
    providenciasImediatas: textoOpcionalParaEnvio(dados.providenciasImediatas),
    observacoes: textoOpcionalParaEnvio(dados.observacoes),
    encaminhamentos: destinatarios.map((d) => ({
      destinatarioPerfil: d.destinatarioPerfil,
      destinatarioUsuarioId: idParaEnvio(d.destinatarioUsuarioId),
      observacao: textoOpcionalParaEnvio(d.observacao),
    })),
  };
}

/**
 * Valida o diálogo de encaminhamento antes do envio. É só usabilidade: a
 * validação definitiva é a do back-end (400).
 * @param {{ destinatarioPerfil: string, destinatarioUsuarioId: string,
 *   responsavelAcompanhamentoId: string, observacao: string }} dados
 * @param {string} statusOcorrencia - RN15: com "ABERTO" o responsável é obrigatório
 * @returns {Record<string, string>} erros por campo
 */
export function validarEncaminhamento(dados, statusOcorrencia) {
  const erros = {};
  if (!perfilDoDestinatario(dados.destinatarioPerfil)) {
    erros.destinatarioPerfil = MENSAGEM_TIPO_DESTINATARIO_OBRIGATORIO;
  } else if (dados.destinatarioPerfil === 'TUTOR' && idParaEnvio(dados.destinatarioUsuarioId) === null) {
    erros.destinatarioUsuarioId = MENSAGEM_TUTOR_OBRIGATORIO;
  }
  if (statusOcorrencia === 'ABERTO' && idParaEnvio(dados.responsavelAcompanhamentoId) === null) {
    erros.responsavelAcompanhamentoId = MENSAGEM_RESPONSAVEL_OBRIGATORIO;
  }
  if (limparTexto(dados.observacao).length > TAMANHO_MAXIMO_TEXTO_LONGO) {
    erros.observacao = `A observação deve ter no máximo ${TAMANHO_MAXIMO_TEXTO_LONGO} caracteres.`;
  }
  return erros;
}

/**
 * Monta os dados do POST /ocorrencias/{id}/encaminhamentos a partir do diálogo
 * já validado. Responsável vazio ("Manter o atual") não entra no corpo.
 */
export function montarEnvioEncaminhamento(dados) {
  const envio = {
    destinatarioPerfil: dados.destinatarioPerfil,
    destinatarioUsuarioId: idParaEnvio(dados.destinatarioUsuarioId),
    observacao: textoOpcionalParaEnvio(dados.observacao),
  };
  const responsavel = idParaEnvio(dados.responsavelAcompanhamentoId);
  if (responsavel !== null) envio.responsavelAcompanhamentoId = responsavel;
  return envio;
}

/** Texto só com espaços (ou vazio) conta como não preenchido. */
function textoVazio(valor) {
  return limparTexto(valor) === '';
}

/**
 * Valida o diálogo de comunicação antes do envio. É só usabilidade: a
 * validação definitiva é a do back-end (400). Os tamanhos máximos já são
 * limitados pelo maxLength dos campos.
 * @param {{ destinatario: string, meio: string, descricao: string, dataHora: string }} dados
 * @param {number} [agoraMs]
 * @returns {Record<string, string>} erros por campo
 */
export function validarComunicacao(dados, agoraMs = Date.now()) {
  const erros = {};
  if (textoVazio(dados.destinatario)) erros.destinatario = MENSAGEM_COMUNICACAO_DESTINATARIO_OBRIGATORIO;
  if (textoVazio(dados.meio)) erros.meio = MENSAGEM_COMUNICACAO_MEIO_OBRIGATORIO;
  if (textoVazio(dados.descricao)) erros.descricao = MENSAGEM_COMUNICACAO_DESCRICAO_OBRIGATORIA;

  // RN17: mesma regra do registro da ocorrência (tolerância de 5 minutos).
  const dataHora = dataHoraParaEnvio(dados.dataHora);
  if (!dataHora) erros.dataHora = MENSAGEM_COMUNICACAO_DATA_HORA_OBRIGATORIA;
  else if (dataHora.instanteMs > agoraMs + TOLERANCIA_FUTURO_MS) {
    erros.dataHora = MENSAGEM_COMUNICACAO_DATA_HORA_FUTURA;
  }
  return erros;
}

/**
 * Monta os dados do POST /ocorrencias/{id}/comunicacoes a partir do diálogo já
 * validado. Os textos vão como foram digitados: a normalização (trim) é da API.
 */
export function montarEnvioComunicacao(dados) {
  return {
    destinatario: dados.destinatario,
    meio: dados.meio,
    descricao: dados.descricao,
    dataHora: dataHoraParaEnvio(dados.dataHora)?.iso ?? null,
  };
}

/**
 * Valida o diálogo de providência antes do envio. É só usabilidade: a
 * validação definitiva é a do back-end (400).
 * @param {{ descricao: string }} dados
 * @returns {Record<string, string>} erros por campo
 */
export function validarProvidencia(dados) {
  const erros = {};
  const descricao = limparTexto(dados.descricao);
  if (!descricao) erros.descricao = MENSAGEM_PROVIDENCIA_DESCRICAO_OBRIGATORIA;
  else if (descricao.length > TAMANHO_MAXIMO_TEXTO_LONGO) {
    erros.descricao = MENSAGEM_PROVIDENCIA_DESCRICAO_LONGA;
  }
  return erros;
}
