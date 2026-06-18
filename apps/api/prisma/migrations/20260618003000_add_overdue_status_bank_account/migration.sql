-- AlterEnum: adiciona OVERDUE ao FinancialEntryStatus
ALTER TYPE "FinancialEntryStatus" ADD VALUE IF NOT EXISTS 'OVERDUE';

-- CreateTable: conta bancária (IF NOT EXISTS — pode já existir no Supabase)
CREATE TABLE IF NOT EXISTS "gdr_bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank" TEXT,
    "agency" TEXT,
    "account" TEXT,
    "balance" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "gdr_bank_accounts_companyId_idx" ON "gdr_bank_accounts"("companyId");

-- AddForeignKey (ignora se já existir)
DO $$ BEGIN
  ALTER TABLE "gdr_bank_accounts" ADD CONSTRAINT "gdr_bank_accounts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
