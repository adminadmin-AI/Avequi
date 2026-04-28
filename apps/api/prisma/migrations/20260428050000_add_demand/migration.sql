-- S11: Registro e consolidação de demanda das lojas

CREATE TABLE "demand_forecasts" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "period"      TEXT NOT NULL,          -- formato YYYY-MM (ex: 2026-05)
  "quantity"    DECIMAL(14,4) NOT NULL,
  "notes"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "demand_forecasts_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "demand_forecasts_companyId_fkey" FOREIGN KEY ("companyId")   REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "demand_forecasts_productId_fkey" FOREIGN KEY ("productId")   REFERENCES "products"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "demand_forecasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id")   ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "demand_forecasts_company_product_period_key"
  ON "demand_forecasts"("companyId", "productId", "period");

CREATE INDEX "demand_forecasts_companyId_idx" ON "demand_forecasts"("companyId");
CREATE INDEX "demand_forecasts_period_idx"    ON "demand_forecasts"("period");
CREATE INDEX "demand_forecasts_productId_idx" ON "demand_forecasts"("productId");
