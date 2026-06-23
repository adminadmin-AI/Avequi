-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL');

-- AlterTable: adicionar campos fiscais e endereço à Company
ALTER TABLE "gdr_companies" ADD COLUMN "razaoSocial" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "ie" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "im" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "crt" INTEGER;
ALTER TABLE "gdr_companies" ADD COLUMN "taxRegime" "TaxRegime";
ALTER TABLE "gdr_companies" ADD COLUMN "suframa" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "cnae" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "street" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "number" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "complement" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "neighborhood" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "city" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "state" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "zipCode" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "ibgeCode" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "phone" TEXT;
ALTER TABLE "gdr_companies" ADD COLUMN "email" TEXT;
