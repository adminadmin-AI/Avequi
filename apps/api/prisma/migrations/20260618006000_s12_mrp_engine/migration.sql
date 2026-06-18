-- S12: MRP Engine — MrpRun + MrpSuggestion

CREATE TYPE "MrpRunStatus" AS ENUM ('RUNNING', 'DONE', 'ERROR');
CREATE TYPE "MrpSuggestionType" AS ENUM ('PURCHASE', 'PRODUCTION');

CREATE TABLE "gdr_mrp_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "status" "MrpRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_mrp_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_mrp_runs_companyId_idx" ON "gdr_mrp_runs"("companyId");

ALTER TABLE "gdr_mrp_runs"
    ADD CONSTRAINT "gdr_mrp_runs_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_mrp_runs"
    ADD CONSTRAINT "gdr_mrp_runs_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "gdr_mrp_suggestions" (
    "id" TEXT NOT NULL,
    "mrpRunId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "MrpSuggestionType" NOT NULL,
    "grossQty" DECIMAL(14,4) NOT NULL,
    "stockOnHand" DECIMAL(14,4) NOT NULL,
    "netQty" DECIMAL(14,4) NOT NULL,
    "bomLevel" INTEGER NOT NULL DEFAULT 0,
    "suggestedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_mrp_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_mrp_suggestions_mrpRunId_idx" ON "gdr_mrp_suggestions"("mrpRunId");
CREATE INDEX "gdr_mrp_suggestions_productId_idx" ON "gdr_mrp_suggestions"("productId");

ALTER TABLE "gdr_mrp_suggestions"
    ADD CONSTRAINT "gdr_mrp_suggestions_mrpRunId_fkey"
    FOREIGN KEY ("mrpRunId") REFERENCES "gdr_mrp_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gdr_mrp_suggestions"
    ADD CONSTRAINT "gdr_mrp_suggestions_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
