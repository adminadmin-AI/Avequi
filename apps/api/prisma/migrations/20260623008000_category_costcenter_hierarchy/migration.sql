-- AlterTable: add categoryId to FinancialEntry
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries"
  ADD CONSTRAINT "gdr_financial_entries_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "gdr_financial_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add parentId to CostCenter for hierarchy
ALTER TABLE "gdr_cost_centers" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gdr_cost_centers_parentId_idx" ON "gdr_cost_centers"("parentId");

-- AddForeignKey
ALTER TABLE "gdr_cost_centers"
  ADD CONSTRAINT "gdr_cost_centers_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "gdr_cost_centers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
