-- S30: BI Foundations — Fact Tables

-- ─── gdr_fact_sales_daily ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gdr_fact_sales_daily" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "period"     TEXT NOT NULL,
  "productId"  TEXT,
  "customerId" TEXT,
  "categoryId" TEXT,
  "region"     TEXT,
  "state"      TEXT,
  "city"       TEXT,
  "revenue"    DECIMAL(14,4) NOT NULL,
  "quantity"   DECIMAL(14,4) NOT NULL,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "avgTicket"  DECIMAL(14,4),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gdr_fact_sales_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_fact_sales_daily_companyId_period_productId_customerId_key"
  ON "gdr_fact_sales_daily"("companyId","period","productId","customerId");
CREATE INDEX IF NOT EXISTS "gdr_fact_sales_daily_companyId_period_idx"
  ON "gdr_fact_sales_daily"("companyId","period");
CREATE INDEX IF NOT EXISTS "gdr_fact_sales_daily_productId_idx"
  ON "gdr_fact_sales_daily"("productId");
CREATE INDEX IF NOT EXISTS "gdr_fact_sales_daily_customerId_idx"
  ON "gdr_fact_sales_daily"("customerId");

ALTER TABLE "gdr_fact_sales_daily"
  ADD CONSTRAINT "gdr_fact_sales_daily_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── gdr_fact_inventory_daily ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gdr_fact_inventory_daily" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "period"      TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "categoryId"  TEXT,
  "quantity"    DECIMAL(14,4) NOT NULL,
  "value"       DECIMAL(14,4) NOT NULL,
  "avgCost"     DECIMAL(14,4),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gdr_fact_inventory_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_fact_inventory_daily_companyId_period_productId_warehouseId_key"
  ON "gdr_fact_inventory_daily"("companyId","period","productId","warehouseId");
CREATE INDEX IF NOT EXISTS "gdr_fact_inventory_daily_companyId_period_idx"
  ON "gdr_fact_inventory_daily"("companyId","period");
CREATE INDEX IF NOT EXISTS "gdr_fact_inventory_daily_warehouseId_idx"
  ON "gdr_fact_inventory_daily"("warehouseId");

ALTER TABLE "gdr_fact_inventory_daily"
  ADD CONSTRAINT "gdr_fact_inventory_daily_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── gdr_fact_production_daily ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gdr_fact_production_daily" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "period"       TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "workCenterId" TEXT,
  "quantity"     DECIMAL(14,4) NOT NULL,
  "materialCost" DECIMAL(14,4) NOT NULL,
  "laborCost"    DECIMAL(14,4) NOT NULL,
  "totalCost"    DECIMAL(14,4) NOT NULL,
  "orderCount"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gdr_fact_production_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_fact_production_daily_companyId_period_productId_workCenterId_key"
  ON "gdr_fact_production_daily"("companyId","period","productId","workCenterId");
CREATE INDEX IF NOT EXISTS "gdr_fact_production_daily_companyId_period_idx"
  ON "gdr_fact_production_daily"("companyId","period");

ALTER TABLE "gdr_fact_production_daily"
  ADD CONSTRAINT "gdr_fact_production_daily_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── gdr_fact_financial_daily ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gdr_fact_financial_daily" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "period"        TEXT NOT NULL,
  "bankAccountId" TEXT,
  "categoryId"    TEXT,
  "type"          TEXT NOT NULL,
  "amount"        DECIMAL(14,4) NOT NULL,
  "count"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gdr_fact_financial_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_fact_financial_daily_companyId_period_bankAccountId_categoryId_type_key"
  ON "gdr_fact_financial_daily"("companyId","period","bankAccountId","categoryId","type");
CREATE INDEX IF NOT EXISTS "gdr_fact_financial_daily_companyId_period_idx"
  ON "gdr_fact_financial_daily"("companyId","period");

ALTER TABLE "gdr_fact_financial_daily"
  ADD CONSTRAINT "gdr_fact_financial_daily_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
