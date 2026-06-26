-- #224: Add warehouseId to PriceTable for per-store/branch pricing
ALTER TABLE "gdr_price_tables" ADD COLUMN "warehouseId" TEXT;

ALTER TABLE "gdr_price_tables"
  ADD CONSTRAINT "gdr_price_tables_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gdr_price_tables_companyId_warehouseId_isActive_idx"
  ON "gdr_price_tables"("companyId", "warehouseId", "isActive");
