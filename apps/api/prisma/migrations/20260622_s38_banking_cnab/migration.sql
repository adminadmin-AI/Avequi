-- S38 Banking — CNAB 240 Core
-- Migration: 20260622_s38_banking_cnab

-- Enums

CREATE TYPE "CnabRemessaStatus" AS ENUM ('PENDING', 'GENERATED', 'SENT', 'ERROR');
CREATE TYPE "CnabRetornoStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'ERROR');
CREATE TYPE "BoletoStatus" AS ENUM ('PENDING', 'REGISTERED', 'PAID', 'CANCELLED', 'OVERDUE', 'WRITTEN_OFF');

-- gdr_boletos

CREATE TABLE "gdr_boletos" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "receivableId"  TEXT,
  "nossoNumero"   TEXT NOT NULL,
  "seuNumero"     TEXT,
  "amount"        DECIMAL(14, 4) NOT NULL,
  "dueDate"       TIMESTAMP(3) NOT NULL,
  "status"        "BoletoStatus" NOT NULL DEFAULT 'PENDING',
  "payerName"     TEXT NOT NULL,
  "payerDocument" TEXT NOT NULL,
  "payerAddress"  TEXT,
  "payerCity"     TEXT,
  "payerState"    TEXT,
  "payerZipCode"  TEXT,
  "registeredAt"  TIMESTAMP(3),
  "paidAt"        TIMESTAMP(3),
  "paidAmount"    DECIMAL(14, 4),
  "cancelledAt"   TIMESTAMP(3),
  "instructions"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_boletos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_boletos_bankAccountId_nossoNumero_key" UNIQUE ("bankAccountId", "nossoNumero")
);

CREATE INDEX "gdr_boletos_companyId_status_idx" ON "gdr_boletos"("companyId", "status");

ALTER TABLE "gdr_boletos"
  ADD CONSTRAINT "gdr_boletos_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_boletos"
  ADD CONSTRAINT "gdr_boletos_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_boletos"
  ADD CONSTRAINT "gdr_boletos_receivableId_fkey"
    FOREIGN KEY ("receivableId") REFERENCES "gdr_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- gdr_cnab_remessas

CREATE TABLE "gdr_cnab_remessas" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "bankAccountId"  TEXT NOT NULL,
  "fileName"       TEXT NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "totalBoletos"   INTEGER NOT NULL,
  "totalAmount"    DECIMAL(14, 4) NOT NULL,
  "status"         "CnabRemessaStatus" NOT NULL DEFAULT 'PENDING',
  "fileContent"    TEXT,
  "errorMessage"   TEXT,
  "generatedAt"    TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_cnab_remessas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_cnab_remessas_companyId_idx" ON "gdr_cnab_remessas"("companyId");

ALTER TABLE "gdr_cnab_remessas"
  ADD CONSTRAINT "gdr_cnab_remessas_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_cnab_remessas"
  ADD CONSTRAINT "gdr_cnab_remessas_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- gdr_cnab_remessa_items

CREATE TABLE "gdr_cnab_remessa_items" (
  "id"          TEXT NOT NULL,
  "remessaId"   TEXT NOT NULL,
  "boletoId"    TEXT NOT NULL,
  "segmento"    TEXT NOT NULL,
  "lineNumber"  INTEGER NOT NULL,
  "lineContent" TEXT NOT NULL,

  CONSTRAINT "gdr_cnab_remessa_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gdr_cnab_remessa_items"
  ADD CONSTRAINT "gdr_cnab_remessa_items_remessaId_fkey"
    FOREIGN KEY ("remessaId") REFERENCES "gdr_cnab_remessas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gdr_cnab_remessa_items"
  ADD CONSTRAINT "gdr_cnab_remessa_items_boletoId_fkey"
    FOREIGN KEY ("boletoId") REFERENCES "gdr_boletos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- gdr_cnab_retornos

CREATE TABLE "gdr_cnab_retornos" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "bankAccountId"  TEXT NOT NULL,
  "fileName"       TEXT NOT NULL,
  "processedAt"    TIMESTAMP(3),
  "matchedCount"   INTEGER NOT NULL DEFAULT 0,
  "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
  "totalAmount"    DECIMAL(14, 4),
  "status"         "CnabRetornoStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_cnab_retornos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_cnab_retornos_companyId_idx" ON "gdr_cnab_retornos"("companyId");

ALTER TABLE "gdr_cnab_retornos"
  ADD CONSTRAINT "gdr_cnab_retornos_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_cnab_retornos"
  ADD CONSTRAINT "gdr_cnab_retornos_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- gdr_cnab_retorno_items

CREATE TABLE "gdr_cnab_retorno_items" (
  "id"             TEXT NOT NULL,
  "retornoId"      TEXT NOT NULL,
  "boletoId"       TEXT,
  "nossoNumero"    TEXT NOT NULL,
  "occurrence"     TEXT NOT NULL,
  "occurrenceDesc" TEXT,
  "amount"         DECIMAL(14, 4),
  "paidAmount"     DECIMAL(14, 4),
  "paidAt"         TIMESTAMP(3),
  "matched"        BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "gdr_cnab_retorno_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gdr_cnab_retorno_items"
  ADD CONSTRAINT "gdr_cnab_retorno_items_retornoId_fkey"
    FOREIGN KEY ("retornoId") REFERENCES "gdr_cnab_retornos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gdr_cnab_retorno_items"
  ADD CONSTRAINT "gdr_cnab_retorno_items_boletoId_fkey"
    FOREIGN KEY ("boletoId") REFERENCES "gdr_boletos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- gdr_reconciliation_items

CREATE TABLE "gdr_reconciliation_items" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "date"          TIMESTAMP(3) NOT NULL,
  "description"   TEXT NOT NULL,
  "amount"        DECIMAL(14, 4) NOT NULL,
  "type"          TEXT NOT NULL,
  "matched"       BOOLEAN NOT NULL DEFAULT false,
  "matchedToId"   TEXT,
  "matchedToType" TEXT,
  "importSource"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_reconciliation_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_reconciliation_items_companyId_bankAccountId_idx" ON "gdr_reconciliation_items"("companyId", "bankAccountId");
CREATE INDEX "gdr_reconciliation_items_date_idx" ON "gdr_reconciliation_items"("date");

ALTER TABLE "gdr_reconciliation_items"
  ADD CONSTRAINT "gdr_reconciliation_items_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_reconciliation_items"
  ADD CONSTRAINT "gdr_reconciliation_items_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
