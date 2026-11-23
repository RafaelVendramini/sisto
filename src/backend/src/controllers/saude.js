// Controller da verificação de saúde da API (Issue #138) — somente HTTP.
//
// IMPORTANTE: este módulo NÃO importa o Prisma nem nenhum service. A rota é
// chamada por um cron externo a cada 10 minutos só para manter a API da
// homologação acordada no Render; tocar o banco acordaria o Neon e gastaria
// as horas dele. Também não devolve versão, ambiente, uptime nem nenhum
// outro dado interno.

/** Corpo fixo da resposta de GET /saude. */
export const RESPOSTA_SAUDE = Object.freeze({ status: 'ok' });

/** GET /saude (o Express responde HEAD /saude pelo mesmo handler, sem corpo). */
export function verificarSaude(req, res) {
  res.status(200).json(RESPOSTA_SAUDE);
}
