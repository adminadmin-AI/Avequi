-- S40: Banking Advanced — CreditLimit + PixCharge
-- Migration: 20260622_s40_banking_advanced

-- ─── Enum: CreditLimitStatus ─────────────────────────────────────────────────
CREATE TYPE "CreditLimitStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- ─── Table: gdr_credit_limits ────────────────────────────────────────────────
CREATE TABLE "gdr_credit_limits" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "maxAmount"  DECIMAL(14, 4) NOT NULL,
  "usedAmount" DECIMAL(14, 4) NOT NULL DEFAULT 0,
  "status"     "CreditLimitStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_credit_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_credit_limits_companyId_customerId_key" UNIQUE ("companyId", "customerId"),
  CONSTRAINT "gdr_credit_limits_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gdr_credit_limits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "gdr_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ─── Table: gdr_pix_charges ──────────────────────────────────────────────────
CREATE TABLE "gdr_pix_charges" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "receivableId"  TEXT,
  "txId"          TEXT NOT NULL,
  "amount"        DECIMAL(14, 4) NOT NULL,
  "description"   TEXT,
  "pixKey"        TEXT NOT NULL,
  "qrCode"        TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAt"     TIMESTAMP(3),
  "paidAt"        TIMESTAMP(3),
  "paidAmount"    DECIMAL(14, 4),
  "e2eId"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_pix_charges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_pix_charges_txId_key" UNIQUE ("txId"),
  CONSTRAINT "gdr_pix_charges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gdr_pix_charges_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gdr_pix_charges_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "gdr_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "gdr_pix_charges_companyId_idx" ON "gdr_pix_charges"("companyId");
CREATE INDEX "gdr_pix_charges_txId_idx" ON "gdr_pix_charges"("txId");
