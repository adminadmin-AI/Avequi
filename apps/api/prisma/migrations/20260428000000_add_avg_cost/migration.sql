-- S06: Add avgCost to products for weighted average cost tracking
ALTER TABLE "products" ADD COLUMN "avgCost" DECIMAL(14,4);
