-- Phase 7: Orçamento Empresarial (#195)

CREATE TABLE "gdr_budgets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "costCenterId" TEXT,
    "categoryId" TEXT,
    "amount" DECIMAL(14,4) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_budgets_companyId_year_month_costCenterId_categoryId_key" ON "gdr_budgets"("companyId", "year", "month", "costCenterId", "categoryId");
CREATE INDEX "gdr_budgets_companyId_year_idx" ON "gdr_budgets"("companyId", "year");
ALTER TABLE "gdr_budgets" ADD CONSTRAINT "gdr_budgets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_budgets" ADD CONSTRAINT "gdr_budgets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "gdr_cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_budgets" ADD CONSTRAINT "gdr_budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "gdr_financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
