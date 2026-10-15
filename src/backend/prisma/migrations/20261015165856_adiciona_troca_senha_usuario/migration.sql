-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "senha_alterada_em" TIMESTAMP(3),
ADD COLUMN     "troca_senha_obrigatoria" BOOLEAN NOT NULL DEFAULT false;
