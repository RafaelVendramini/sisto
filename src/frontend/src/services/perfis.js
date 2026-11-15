// Rótulos amigáveis dos perfis (SSD, Seção 11). A API trafega os valores
// técnicos; a interface sempre mostra o rótulo correspondente (RNF02).
export const ROTULOS_PERFIL = Object.freeze({
  PROFESSOR: 'Professor',
  TUTOR: 'Tutor',
  GESTAO: 'Gestão',
  PEDAGOGICO: 'Pedagógico',
  TECNICO_ADMINISTRATIVO: 'Técnico-administrativo',
});

/**
 * Converte o valor técnico do perfil no rótulo exibido na tela.
 * @param {string} perfil - ex.: 'GESTAO'
 * @returns {string} ex.: 'Gestão' (ou string vazia se desconhecido)
 */
export function rotuloPerfil(perfil) {
  return ROTULOS_PERFIL[perfil] ?? '';
}

// Rótulos amigáveis do status do usuário (SSD, Seção 11; RN07).
export const ROTULOS_STATUS = Object.freeze({
  ATIVO: 'Ativo',
  BLOQUEADO: 'Bloqueado',
  DESATIVADO: 'Desativado',
});

/**
 * Converte o valor técnico do status no rótulo exibido na tela.
 * @param {string} status - ex.: 'BLOQUEADO'
 * @returns {string} ex.: 'Bloqueado' (ou string vazia se desconhecido)
 */
export function rotuloStatus(status) {
  return ROTULOS_STATUS[status] ?? '';
}

// Perfis que acessam a gestão de usuários (RF01, matriz da Seção 4).
// Usado no menu e na rota; a proteção real é do back-end (403).
export const PERFIS_GESTAO_USUARIOS = Object.freeze(['GESTAO']);

/** Indica se o perfil pode ver a página de usuários. */
export function podeGerenciarUsuarios(perfil) {
  return PERFIS_GESTAO_USUARIOS.includes(perfil);
}

// Perfis que criam e editam categorias de ocorrência (RF07, matriz da Seção 4).
// Usado no menu e na rota; a proteção real é do back-end (403).
export const PERFIS_GESTAO_CATEGORIAS = Object.freeze(['GESTAO', 'PEDAGOGICO']);

/** Indica se o perfil pode ver a página de categorias. */
export function podeGerenciarCategorias(perfil) {
  return PERFIS_GESTAO_CATEGORIAS.includes(perfil);
}

// Perfis que cadastram e editam turmas (RF15, matriz da Seção 4: "Gerenciar
// usuários, turmas e estudantes"). Usado no menu e na rota; a proteção real é
// do back-end (403).
export const PERFIS_GESTAO_TURMAS = Object.freeze(['GESTAO']);

/** Indica se o perfil pode ver a página de turmas. */
export function podeGerenciarTurmas(perfil) {
  return PERFIS_GESTAO_TURMAS.includes(perfil);
}

// Perfis que cadastram e editam estudantes e o vínculo com o tutor (RF15,
// RF16, matriz da Seção 4: "Gerenciar usuários, turmas e estudantes"). Usado
// no menu e na rota; a proteção real é do back-end (403).
export const PERFIS_GESTAO_ESTUDANTES = Object.freeze(['GESTAO']);

/** Indica se o perfil pode ver a página de estudantes. */
export function podeGerenciarEstudantes(perfil) {
  return PERFIS_GESTAO_ESTUDANTES.includes(perfil);
}

// Perfis que registram ocorrências (UC01, RF05, matriz da Seção 4): todos os
// cinco. Usado no menu e na rota; a proteção real é do back-end (403).
export const PERFIS_REGISTRO_OCORRENCIA = Object.freeze([
  'PROFESSOR',
  'TUTOR',
  'GESTAO',
  'PEDAGOGICO',
  'TECNICO_ADMINISTRATIVO',
]);

/** Indica se o perfil pode ver a página de registro de ocorrência. */
export function podeRegistrarOcorrencia(perfil) {
  return PERFIS_REGISTRO_OCORRENCIA.includes(perfil);
}

// Perfis que consultam ocorrências (UC03, RF05, matriz da Seção 4): todos os
// cinco. O que cada um vê é decidido pelo back-end (RN19). Usado no menu e na
// rota; a proteção real é do back-end.
export const PERFIS_CONSULTA_OCORRENCIAS = Object.freeze([
  'PROFESSOR',
  'TUTOR',
  'GESTAO',
  'PEDAGOGICO',
  'TECNICO_ADMINISTRATIVO',
]);

/** Indica se o perfil pode ver a lista e o detalhe de ocorrências. */
export function podeConsultarOcorrencias(perfil) {
  return PERFIS_CONSULTA_OCORRENCIAS.includes(perfil);
}

// Perfis que encaminham uma ocorrência já registrada (UC02, RF08, RN15,
// matriz da Seção 4): Gestão e Equipe Pedagógica. Usado para mostrar o botão
// "Encaminhar" no detalhe; a proteção real é do back-end (403).
export const PERFIS_ENCAMINHAMENTO_OCORRENCIA = Object.freeze(['GESTAO', 'PEDAGOGICO']);

/** Indica se o perfil pode encaminhar ocorrências já registradas. */
export function podeEncaminharOcorrencia(perfil) {
  return PERFIS_ENCAMINHAMENTO_OCORRENCIA.includes(perfil);
}

// Perfis que registram comunicações feitas fora do sistema (RF09, RN16,
// matriz da Seção 4): Tutor, Gestão e Equipe Pedagógica. O Tutor só nas
// ocorrências que pode ver (RN19), o que o back-end garante (404). Usado para
// mostrar o botão "Registrar comunicação" no detalhe; a proteção real é do
// back-end (403).
export const PERFIS_COMUNICACAO_OCORRENCIA = Object.freeze(['TUTOR', 'GESTAO', 'PEDAGOGICO']);

/** Indica se o perfil pode registrar comunicações numa ocorrência. */
export function podeRegistrarComunicacao(perfil) {
  return PERFIS_COMUNICACAO_OCORRENCIA.includes(perfil);
}

// Perfis que registram providência e encerram QUALQUER ocorrência em
// acompanhamento (RN04, RN22, matriz da Seção 4: "Atualizar/encerrar
// ocorrência"). Além deles, o responsável pelo acompanhamento da ocorrência.
export const PERFIS_ATUALIZACAO_OCORRENCIA = Object.freeze(['GESTAO', 'PEDAGOGICO']);

/**
 * Indica se o usuário logado vê os botões "Registrar providência" e "Encerrar
 * ocorrência" (RN04, RN22): só com a ocorrência "Em acompanhamento", para a
 * Gestão, o Pedagógico e quem é o responsável pelo acompanhamento
 * (`responsavelAcompanhamento.id`). É só usabilidade: a proteção real é do
 * back-end (403/409).
 * @param {{ id: number, perfil: string } | null} usuario - usuário logado
 * @param {object | null} ocorrencia - detalhe da ocorrência
 */
export function podeAtualizarOcorrencia(usuario, ocorrencia) {
  if (!usuario || ocorrencia?.status !== 'EM_ACOMPANHAMENTO') return false;
  if (PERFIS_ATUALIZACAO_OCORRENCIA.includes(usuario.perfil)) return true;
  const responsavelId = ocorrencia.responsavelAcompanhamento?.id;
  return responsavelId !== undefined && responsavelId !== null && responsavelId === usuario.id;
}
