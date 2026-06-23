-- CreateEnum
CREATE TYPE "TaxOperationType" AS ENUM (
  'VENDA_INTERNA',
  'VENDA_INTERESTADUAL',
  'DEVOLUCAO_VENDA',
  'TRANSFERENCIA_INTERNA',
  'TRANSFERENCIA_INTERESTADUAL',
  'COMPRA_INTERNA',
  'COMPRA_INTERESTADUAL',
  'INDUSTRIALIZACAO'
);

-- CreateTable
CREATE TABLE "gdr_tax_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "operationType" "TaxOperationType" NOT NULL,
    "ncm" TEXT,
    "productType" "ProductType",
    "ufOrigem" TEXT,
    "ufDestino" TEXT,
    "cfop" TEXT NOT NULL,
    "icmsCst" TEXT NOT NULL,
    "icmsAliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "icmsBaseReducao" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "ipiCst" TEXT NOT NULL DEFAULT '99',
    "ipiAliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "pisCst" TEXT NOT NULL DEFAULT '01',
    "pisAliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cofinsCst" TEXT NOT NULL DEFAULT '01',
    "cofinsAliquota" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_tax_rules_companyId_operationType_idx" ON "gdr_tax_rules"("companyId", "operationType");

-- CreateIndex (unique constraint)
CREATE UNIQUE INDEX "gdr_tax_rules_companyId_operationType_ncm_productType_ufOri_key"
  ON "gdr_tax_rules"("companyId", "operationType", "ncm", "productType", "ufOrigem", "ufDestino");

-- AddForeignKey
ALTER TABLE "gdr_tax_rules" ADD CONSTRAINT "gdr_tax_rules_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
