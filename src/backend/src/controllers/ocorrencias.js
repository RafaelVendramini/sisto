// Controller de ocorrências — somente entrada/saída HTTP (regras em services/ocorrencias.js).
import { registrarOcorrencia } from '../services/ocorrencias.js';

/** POST /ocorrencias */
export async function registrar(req, res) {
  const ocorrencia = await registrarOcorrencia(req.body, req.usuario);
  res.status(201).json(ocorrencia);
}
