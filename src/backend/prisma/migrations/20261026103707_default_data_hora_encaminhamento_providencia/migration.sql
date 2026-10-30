-- Issue #45 (RN17): a data/hora do encaminhamento e a da providência são o
-- momento do registro, preenchido pelo sistema. Só define o valor padrão das
-- colunas; nenhuma linha existente é alterada ou apagada.

-- AlterTable
ALTER TABLE "encaminhamentos" ALTER COLUMN "data_hora" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "providencias" ALTER COLUMN "data_hora" SET DEFAULT CURRENT_TIMESTAMP;
