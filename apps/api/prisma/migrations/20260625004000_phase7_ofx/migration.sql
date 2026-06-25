-- Phase 7: OFX Import + Auto-Match (#197)

CREATE TABLE "gdr_bank_statements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DEBIT',
    "fitId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedEntryId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_bank_statements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_bank_statements_companyId_bankAccountId_idx" ON "gdr_bank_statements"("companyId", "bankAccountId");
CREATE INDEX "gdr_bank_statements_matchStatus_idx" ON "gdr_bank_statements"("matchStatus");
ALTER TABLE "gdr_bank_statements" ADD CONSTRAINT "gdr_bank_statements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_bank_statements" ADD CONSTRAINT "gdr_bank_statements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "gdr_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
