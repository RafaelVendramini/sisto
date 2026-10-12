// Normalização de e-mail — Sisto.
// Reutilizada pelo seed (#9) e pelo login (#10): o e-mail é o identificador
// de login (RF02) e é sempre gravado/buscado já normalizado.

/** Normaliza e-mail: remove espaços nas pontas e converte para minúsculas (RF02). */
export function normalizarEmail(email) {
  return String(email).trim().toLowerCase();
}
