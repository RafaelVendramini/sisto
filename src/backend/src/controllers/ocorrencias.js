// Controller de ocorrências — somente entrada/saída HTTP (regras em services/ocorrencias.js).
import {
  listarOcorrencias,
  obterOcorrencia,
  registrarEncaminhamento,
  registrarOcorrencia,
} from '../services/ocorrencias.js';

/** GET /ocorrencias */
export async function listar(req, res) {
  const ocorrencias = await listarOcorrencias(req.usuario);
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
