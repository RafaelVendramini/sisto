// Controller de ocorrências — somente entrada/saída HTTP (regras em services/ocorrencias.js).
import {
  encerrarOcorrencia,
  listarHistoricoOcorrencia,
  listarOcorrencias,
  obterOcorrencia,
  registrarComunicacao,
  registrarEncaminhamento,
  registrarOcorrencia,
  registrarProvidencia,
} from '../services/ocorrencias.js';

/** GET /ocorrencias — filtros e paginação na query string (Issue #86). */
export async function listar(req, res) {
  const ocorrencias = await listarOcorrencias(req.usuario, req.query);
  res.status(200).json(ocorrencias);
}

/** GET /ocorrencias/:id */
export async function detalhar(req, res) {
  const ocorrencia = await obterOcorrencia(req.params.id, req.usuario);
  res.status(200).json(ocorrencia);
}

/** POST /ocorrencias */
export async function registrar(req, res) {
  const ocorrencia = await registrarOcorrencia(req.body, req.usuario);
  res.status(201).json(ocorrencia);
}

/** POST /ocorrencias/:id/encaminhamentos — 201 com o detalhe completo da ocorrência. */
export async function encaminhar(req, res) {
  const ocorrencia = await registrarEncaminhamento(req.params.id, req.body, req.usuario);
  res.status(201).json(ocorrencia);
}

/** POST /ocorrencias/:id/comunicacoes — 201 com o detalhe completo da ocorrência. */
export async function comunicar(req, res) {
  const ocorrencia = await registrarComunicacao(req.params.id, req.body, req.usuario);
  res.status(201).json(ocorrencia);
}

/** POST /ocorrencias/:id/providencias — 201 com o detalhe completo da ocorrência. */
export async function providenciar(req, res) {
  const ocorrencia = await registrarProvidencia(req.params.id, req.body, req.usuario);
  res.status(201).json(ocorrencia);
}

/** GET /ocorrencias/:id/historico — 200 com o histórico, do mais antigo para o mais novo. */
export async function historico(req, res) {
  const registros = await listarHistoricoOcorrencia(req.params.id, req.usuario);
  res.status(200).json(registros);
}

/** PATCH /ocorrencias/:id/status — 200 com o detalhe completo da ocorrência encerrada. */
export async function encerrar(req, res) {
  const ocorrencia = await encerrarOcorrencia(req.params.id, req.body, req.usuario);
  res.status(200).json(ocorrencia);
}
