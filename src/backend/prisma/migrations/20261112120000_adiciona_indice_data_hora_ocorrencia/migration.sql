-- Issue #86 (RF11): índice em ocorrencias.data_hora, usado na ordenação da
-- lista (data/hora do fato desc) e no filtro por período do GET /ocorrencias.
-- Gerado com `prisma migrate diff`; só cria o índice, sem alterar dados.
-- CreateIndex
CREATE INDEX "ocorrencias_data_hora_idx" ON "ocorrencias"("data_hora");
