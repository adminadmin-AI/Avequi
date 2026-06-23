-- AlterEnum: add PARTIALLY_PAID to FinancialEntryStatus
ALTER TYPE "FinancialEntryStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID' BEFORE 'PAID';

-- CreateEnum: PaymentMethod
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('BOLETO', 'PIX', 'TED', 'DINHEIRO', 'CARTAO', 'CHEQUE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: add parentEntryId to FinancialEntry
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "parentEntryId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gdr_financial_entries_parentEntryId_idx" ON "gdr_financial_entries"("parentEntryId");

-- AddForeignKey
ALTER TABLE "gdr_financial_entries"
  ADD CONSTRAINT "gdr_financial_entries_parentEntryId_fkey"
  FOREIGN KEY ("parentEntryId") REFERENCES "gdr_financial_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: Payment
CREATE TABLE IF NOT EXISTS "gdr_payments" (
  "id" TEXT NOT NULL,
  "financialEntryId" TEXT NOT NULL,
  "amount" DECIMAL(14,4) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "bankAccountId" TEXT,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gdr_payments_financialEntryId_idx" ON "gdr_payments"("financialEntryId");
CREATE INDEX IF NOT EXISTS "gdr_payments_bankAccountId_idx" ON "gdr_payments"("bankAccountId");

-- AddForeignKeys
ALTER TABLE "gdr_payments"
  ADD CONSTRAINT "gdr_payments_financialEntryId_fkey"
  FOREIGN KEY ("financialEntryId") REFERENCES "gdr_financial_entries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_payments"
  ADD CONSTRAINT "gdr_payments_bankAccountId_fkey"
  FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
