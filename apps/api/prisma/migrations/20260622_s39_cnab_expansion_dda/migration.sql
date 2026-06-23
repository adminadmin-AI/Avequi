-- S39: CNAB Expansion + DDA
-- Creates DDA mandate and debit tables

-- ─── Enum: DdaConsentStatus ────────────────────────────────────────────────

CREATE TYPE "DdaConsentStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'CANCELLED',
  'EXPIRED'
);

-- ─── Table: gdr_dda_mandates ───────────────────────────────────────────────

CREATE TABLE "gdr_dda_mandates" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"     TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "consentStatus" "DdaConsentStatus" NOT NULL DEFAULT 'PENDING',
  "maxAmount"     DECIMAL(14,4),
  "startDate"     TIMESTAMP(3) NOT NULL,
  "endDate"       TIMESTAMP(3),
  "cancelledAt"   TIMESTAMP(3),
  "reference"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_dda_mandates_pkey" PRIMARY KEY ("id")
);

-- Foreign keys for gdr_dda_mandates
ALTER TABLE "gdr_dda_mandates"
  ADD CONSTRAINT "gdr_dda_mandates_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_dda_mandates"
  ADD CONSTRAINT "gdr_dda_mandates_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "gdr_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_dda_mandates"
  ADD CONSTRAINT "gdr_dda_mandates_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index
CREATE INDEX "gdr_dda_mandates_companyId_idx" ON "gdr_dda_mandates"("companyId");

-- ─── Table: gdr_dda_debits ─────────────────────────────────────────────────

CREATE TABLE "gdr_dda_debits" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "mandateId"    TEXT NOT NULL,
  "amount"       DECIMAL(14,4) NOT NULL,
  "debitDate"    TIMESTAMP(3) NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "processedAt"  TIMESTAMP(3),
  "failReason"   TEXT,
  "receivableId" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_dda_debits_pkey" PRIMARY KEY ("id")
);

-- Foreign keys for gdr_dda_debits
ALTER TABLE "gdr_dda_debits"
  ADD CONSTRAINT "gdr_dda_debits_mandateId_fkey"
    FOREIGN KEY ("mandateId") REFERENCES "gdr_dda_mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_dda_debits"
  ADD CONSTRAINT "gdr_dda_debits_receivableId_fkey"
    FOREIGN KEY ("receivableId") REFERENCES "gdr_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index
CREATE INDEX "gdr_dda_debits_mandateId_idx" ON "gdr_dda_debits"("mandateId");
