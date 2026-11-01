// Mensagens, rótulos, datas e validação da tela de registro de ocorrência
// (UC01, RN02, RN03, RN06, RN14, RN17, RNF02) e das telas de lista e detalhe
// (UC03, RF05, RN19 — Issue #48): nada técnico aparece na tela.
// A validação daqui é só usabilidade; a definitiva é a do back-end (400), cuja
// mensagem (campo `erro`) é exibida como veio.
import { MENSAGEM_SEM_CONEXAO, MENSAGEM_SEM_PERMISSAO } from './mensagens.js';
import { idParaEnvio, limparTexto } from './mensagensEstudantes.js';

// Limites do back-end (decisões do Rafael na Issue #45), após remover espaços nas pontas.
export const TAMANHO_MAXIMO_LOCAL = 150;
export const TAMANHO_MAXIMO_TEXTO_LONGO = 5000;
export const MAXIMO_ESTUDANTES = 50;
export const MAXIMO_DESTINATARIOS = 10;

/** RN17: a API aceita até 5 minutos à frente do relógio do servidor. */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** RN17: as datas são exibidas no horário de São Paulo. */
export const FUSO_ESCOLA = 'America/Sao_Paulo';

// Destinatários do encaminhamento (Seção 11): valor técnico, rótulo na tela e
// perfil exigido do usuário destinatário (RN03).
export const DESTINATARIOS = Object.freeze([
  Object.freeze({ valor: 'TUTOR', rotulo: 'Tutor', perfilUsuario: 'TUTOR' }),
  Object.freeze({ valor: 'EQUIPE_PEDAGOGICA', rotulo: 'Equipe pedagógica', perfilUsuario: 'PEDAGOGICO' }),
  Object.freeze({ valor: 'GESTAO', rotulo: 'Gestão', perfilUsuario: 'GESTAO' }),
]);

/** Perfil do usuário exigido para o destinatário (ex.: EQUIPE_PEDAGOGICA -> PEDAGOGICO). */
export function perfilDoDestinatario(destinatarioPerfil) {
  return DESTINATARIOS.find((d) => d.valor === destinatarioPerfil)?.perfilUsuario ?? null;
}

/** Rótulo do destinatário na tela (ex.: 'Equipe pedagógica'). */
export function rotuloDestinatario(destinatarioPerfil) {
  return DESTINATARIOS.find((d) => d.valor === destinatarioPerfil)?.rotulo ?? '';
}

// RN06: orientação exibida junto da descrição (o sistema não filtra o texto).
export const ORIENTACAO_REDACAO =
  'Escreva de forma objetiva e descritiva: conte o que aconteceu, sem opiniões. Não use ' +
  'linguagem ofensiva nem classificações que estigmatizem os estudantes.';

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

const MENSAGEM_GENERICA_REGISTRAR =
  'Não foi possível registrar a ocorrência agora. Tente novamente em instantes.';

// ---------------------------------------------------------------------------
// Consulta de ocorrências: lista e detalhe (UC03, RF05, RN19, RN20)
// ---------------------------------------------------------------------------

// Status da ocorrência (Seção 11, RF10): valor técnico e rótulo na tela.
export const STATUS_OCORRENCIA = Object.freeze([
  Object.freeze({ valor: 'ABERTO', rotulo: 'Aberto' }),
  Object.freeze({ valor: 'EM_ACOMPANHAMENTO', rotulo: 'Em acompanhamento' }),
  Object.freeze({ valor: 'ENCERRADO', rotulo: 'Encerrado' }),
]);

/** Rótulo do status na tela (ex.: 'Em acompanhamento'); vazio se desconhecido. */
export function rotuloStatusOcorrencia(status) {
  return STATUS_OCORRENCIA.find((s) => s.valor === status)?.rotulo ?? '';
}

/** Texto exibido no lugar de um campo opcional vazio. */
export const TEXTO_NAO_INFORMADO = 'Não informado';

/** Encaminhamento à equipe inteira (sem usuário destinatário — RN03). */
export const TEXTO_TODA_A_EQUIPE = 'Toda a equipe';

export const MENSAGEM_OCORRENCIA_NAO_ENCONTRADA = 'Ocorrência não encontrada.';
export const MENSAGEM_SEM_OCORRENCIAS = 'Nenhuma ocorrência para mostrar.';
export const MENSAGEM_SEM_ENCAMINHAMENTOS = 'Nenhum encaminhamento registrado.';
export const MENSAGEM_SEM_COMUNICACOES = 'Nenhuma comunicação registrada.';
export const MENSAGEM_SEM_PROVIDENCIAS = 'Nenhuma providência registrada.';

const MENSAGEM_GENERICA_LISTA = 'Não foi possível carregar as ocorrências agora.';
const MENSAGEM_GENERICA_DETALHE = 'Não foi possível carregar a ocorrência agora.';

/**
 * Converte a falha do GET /ocorrencias em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 */
export function mensagemErroListaOcorrencias(falha) {
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_LISTA;
}

/**
 * Converte a falha do GET /ocorrencias/{id} em mensagem para a tela. O 404
 * (inexistente ou fora da visibilidade — RN19) e o 400 (id inválido na URL)
 * têm a mesma mensagem: para o usuário, a ocorrência não existe.
 */
export function mensagemErroDetalheOcorrencia(falha) {
  if ([400, 404].includes(falha?.status)) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  if (falha?.status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (falha?.status === 0) return MENSAGEM_SEM_CONEXAO;
  return MENSAGEM_GENERICA_DETALHE;
}

/** "Este destinatário repete o destinatário 1. Remova um deles." */
export function mensagemDestinatarioRepetido(posicaoOriginal) {
  return `Este destinatário repete o destinatário ${posicaoOriginal}. Remova um deles.`;
}

/** Mensagem de sucesso (RF05): "Ocorrência nº 12 registrada com sucesso." */
export function mensagemOcorrenciaRegistrada(id) {
  return id === undefined || id === null
    ? 'Ocorrência registrada com sucesso.'
    : `Ocorrência nº ${id} registrada com sucesso.`;
}

// ---------------------------------------------------------------------------
// Data e hora no horário de São Paulo (RN17)
// ---------------------------------------------------------------------------

const formatadorFuso = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_ESCOLA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Partes da data/hora de um instante, como aparecem no relógio de São Paulo. */
function partesNoFuso(instanteMs) {
  const partes = {};
  for (const { type, value } of formatadorFuso.formatToParts(new Date(instanteMs))) {
    partes[type] = value;
  }
  return partes;
}

/** Instante (ms, UTC) de uma data/hora "de parede", como se estivesse em UTC. */
function paredeComoUtc(ano, mes, dia, hora, minuto, segundo) {
  const data = new Date(0);
  data.setUTCFullYear(ano, mes - 1, dia);
  data.setUTCHours(hora, minuto, segundo, 0);
  return data.getTime();
}

/** Deslocamento de São Paulo em relação ao UTC, em minutos (ex.: -180), no instante dado. */
function deslocamentoMinutos(instanteMs) {
  const p = partesNoFuso(instanteMs);
  const parede = paredeComoUtc(
    Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second),
  );
  const instanteEmSegundos = Math.floor(instanteMs / 1000) * 1000;
  return Math.round((parede - instanteEmSegundos) / 60000);
}

/**
 * Data e hora de um instante (ISO vindo da API, em UTC) no horário de São
 * Paulo, em formato brasileiro legível (RN17, RNF02).
 * @param {string | number | Date} valor - ex.: "2026-10-30T12:39:00.000Z"
 * @returns {string} ex.: "30/10/2026 às 09:39" (vazio quando ausente ou inválido)
 */
export function formatarDataHora(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  const instanteMs = new Date(valor).getTime();
  if (Number.isNaN(instanteMs)) return '';
  const p = partesNoFuso(instanteMs);
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

/**
 * Data e hora de agora no horário de São Paulo, no formato do campo
 * datetime-local ("2026-10-30T08:00"). Usada como sugestão no formulário.
 */
export function agoraNoFusoDaEscola(agoraMs = Date.now()) {
  const p = partesNoFuso(agoraMs);
  return `${p.year.padStart(4, '0')}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const REGEX_DATA_HORA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

function doisDigitos(numero) {
  return String(numero).padStart(2, '0');
}

/**
 * Converte o valor do campo datetime-local (horário de São Paulo) em ISO 8601
 * com o deslocamento correto daquele momento, calculado pelo Intl (não fixo).
 * @param {string} valor - ex.: "2026-10-30T08:00"
 * @returns {{ iso: string, instanteMs: number } | null} null quando vazio ou inválido
 *   (ex.: { iso: "2026-10-30T08:00:00-03:00", instanteMs: ... })
 */
export function dataHoraParaEnvio(valor) {
  const partes = REGEX_DATA_HORA_LOCAL.exec(String(valor ?? ''));
  if (!partes) return null;
  const [, ano, mes, dia, hora, minuto, segundo = '00'] = partes;
  const parede = paredeComoUtc(
    Number(ano), Number(mes), Number(dia), Number(hora), Number(minuto), Number(segundo),
  );
  if (Number.isNaN(parede)) return null;

  // Duas passadas: o deslocamento é o do instante resultante (vale também se
  // um dia voltar o horário de verão).
  let deslocamento = deslocamentoMinutos(parede);
  deslocamento = deslocamentoMinutos(parede - deslocamento * 60000);
  const instanteMs = parede - deslocamento * 60000;
  if (Number.isNaN(instanteMs)) return null;

  const sinal = deslocamento < 0 ? '-' : '+';
  const absoluto = Math.abs(deslocamento);
  const fuso = `${sinal}${doisDigitos(Math.floor(absoluto / 60))}:${doisDigitos(absoluto % 60)}`;
  return { iso: `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${fuso}`, instanteMs };
}

// ---------------------------------------------------------------------------
// Usuários destinatários e tutores sugeridos (RN03, RN20)
// ---------------------------------------------------------------------------

/**
 * Usuários ativos de um perfil, só com { id, nome }. Quem não é Gestão já
 * recebe só ativos, sem o campo status; a Gestão recebe todos, com status.
 */
export function usuariosAtivosDoPerfil(usuarios, perfil) {
  return (usuarios ?? [])
    .filter((u) => u.perfil === perfil && (u.status === undefined || u.status === 'ATIVO'))
    .map(({ id, nome }) => ({ id, nome }));
}

/**
 * Separa os tutores ativos em "dos estudantes selecionados" (na ordem dos
 * estudantes) e "outros" (na ordem da API). Tutor de estudante que não está
 * entre os ativos não é sugerido (RN03).
 * @returns {{ sugeridos: Array<{id, nome}>, outros: Array<{id, nome}> }}
 */
export function agruparTutores(tutoresAtivos, estudantesSelecionados) {
  const idsSugeridos = [];
  for (const estudante of estudantesSelecionados ?? []) {
    const id = estudante?.tutor?.id;
    if (id !== undefined && id !== null && !idsSugeridos.includes(id)) idsSugeridos.push(id);
  }
  const porId = new Map((tutoresAtivos ?? []).map((t) => [t.id, t]));
  const sugeridos = idsSugeridos.filter((id) => porId.has(id)).map((id) => porId.get(id));
  const outros = (tutoresAtivos ?? []).filter((t) => !idsSugeridos.includes(t.id));
  return { sugeridos, outros };
}

// ---------------------------------------------------------------------------
// Validação e montagem do envio
// ---------------------------------------------------------------------------

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
 * Converte a falha do POST /ocorrencias em mensagem para a tela.
 * O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroRegistro(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if ([400, 409].includes(status) && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA_REGISTRAR;
}

/** Usuários ativos de cada tipo de destinatário (RN03), só { id, nome }. */
export function separarUsuariosPorDestinatario(usuarios) {
  const porTipo = {};
  for (const { valor, perfilUsuario } of DESTINATARIOS) {
    porTipo[valor] = usuariosAtivosDoPerfil(usuarios, perfilUsuario);
  }
  return porTipo;
}

// ---------------------------------------------------------------------------
// Encaminhamento de ocorrência já registrada (UC02, RF08, RN03, RN15 — #50)
// ---------------------------------------------------------------------------

export const MENSAGEM_ENCAMINHAMENTO_REGISTRADO = 'Encaminhamento registrado.';
export const MENSAGEM_RESPONSAVEL_OBRIGATORIO =
  'Escolha o responsável pelo acompanhamento. Ele é obrigatório quando a ocorrência está "Aberto".';
export const MENSAGEM_ENCAMINHAMENTO_CONFLITO =
  'A ocorrência foi encerrada ou alterada por outra pessoa. Atualize a ocorrência e tente novamente.';

const MENSAGEM_GENERICA_ENCAMINHAR =
  'Não foi possível registrar o encaminhamento agora. Tente novamente em instantes.';

/**
 * Pessoas que podem ser responsáveis pelo acompanhamento (RN15): ativas, com
 * perfil Tutor, Pedagógico ou Gestão, agrupadas por perfil. Os tutores dos
 * estudantes da ocorrência vêm primeiro (`tutoresSugeridos`).
 * @param {Array<object>} usuarios - resposta do GET /usuarios
 * @param {Array<object>} estudantesComTutor - estudantes da ocorrência com `tutor`
 * @returns {{ tutoresSugeridos: Array, outrosTutores: Array, pedagogicos: Array, gestao: Array }}
 */
export function agruparResponsaveis(usuarios, estudantesComTutor) {
  const { sugeridos, outros } = agruparTutores(
    usuariosAtivosDoPerfil(usuarios, 'TUTOR'),
    estudantesComTutor,
  );
  return {
    tutoresSugeridos: sugeridos,
    outrosTutores: outros,
    pedagogicos: usuariosAtivosDoPerfil(usuarios, 'PEDAGOGICO'),
    gestao: usuariosAtivosDoPerfil(usuarios, 'GESTAO'),
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

/**
 * A falha do encaminhamento indica que a ocorrência mudou ou sumiu (409:
 * encerrada ou alterada ao mesmo tempo; 404: inexistente ou fora da
 * visibilidade): vale atualizar o detalhe.
 */
export function encaminhamentoPedeAtualizacao(falha) {
  return [404, 409].includes(falha?.status);
}

/**
 * Converte a falha do POST /ocorrencias/{id}/encaminhamentos em mensagem para
 * a tela. O 401 não chega aqui na prática: o tratamento central leva ao login.
 * @param {{ status?: number, message?: string, doServidor?: boolean }} falha
 */
export function mensagemErroEncaminhamento(falha) {
  const status = falha?.status;
  if (status === 403) return MENSAGEM_SEM_PERMISSAO;
  if (status === 0) return MENSAGEM_SEM_CONEXAO;
  if (status === 409) return MENSAGEM_ENCAMINHAMENTO_CONFLITO;
  if (status === 404) return MENSAGEM_OCORRENCIA_NAO_ENCONTRADA;
  if (status === 400 && falha?.doServidor && falha?.message) return falha.message;
  return MENSAGEM_GENERICA_ENCAMINHAR;
}
