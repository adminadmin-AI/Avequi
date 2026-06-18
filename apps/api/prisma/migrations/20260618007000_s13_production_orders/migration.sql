-- S13: Ajustar tabelas de Ordens de Produção ao schema Prisma
-- As tabelas já existem no banco legado com colunas diferentes.

-- ── gdr_production_orders ────────────────────────────────────────────────────

ALTER TABLE "gdr_production_orders"
    ADD COLUMN IF NOT EXISTS "warehouseId"     TEXT,
    ADD COLUMN IF NOT EXISTS "plannedQty"      DECIMAL(14,4),
    ADD COLUMN IF NOT EXISTS "producedQty"     DECIMAL(14,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "mrpSuggestionId" TEXT,
    ADD COLUMN IF NOT EXISTS "scheduledStart"  TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "scheduledEnd"    TIMESTAMP(3);

-- Popula plannedQty a partir da coluna legada quantity (se existir)
UPDATE "gdr_production_orders"
SET "plannedQty" = "quantity"
WHERE "plannedQty" IS NULL AND "quantity" IS NOT NULL;

-- Garante NOT NULL no plannedQty (default 0 para linhas sem quantity)
UPDATE "gdr_production_orders" SET "plannedQty" = 0 WHERE "plannedQty" IS NULL;
ALTER TABLE "gdr_production_orders" ALTER COLUMN "plannedQty" SET NOT NULL;

-- FK warehouseId (opcional, pois pode ser NULL no legado)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_orders_warehouseId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_orders"
            ADD CONSTRAINT "gdr_production_orders_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- FK mrpSuggestionId
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_orders_mrpSuggestionId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_orders"
            ADD CONSTRAINT "gdr_production_orders_mrpSuggestionId_fkey"
            FOREIGN KEY ("mrpSuggestionId") REFERENCES "gdr_mrp_suggestions"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- ── gdr_production_order_items ────────────────────────────────────────────────
-- A coluna legada chama-se "productId" — precisa existir "componentId"

ALTER TABLE "gdr_production_order_items"
    ADD COLUMN IF NOT EXISTS "componentId"  TEXT,
    ADD COLUMN IF NOT EXISTS "plannedQty"   DECIMAL(14,4),
    ADD COLUMN IF NOT EXISTS "consumedQty"  DECIMAL(14,4) NOT NULL DEFAULT 0;

-- Popula componentId e plannedQty a partir das colunas legadas
UPDATE "gdr_production_order_items"
SET
    "componentId" = "productId",
    "plannedQty"  = "qtyPlanned",
    "consumedQty" = "qtyConsumed"
WHERE "componentId" IS NULL;

-- Garante NOT NULL
UPDATE "gdr_production_order_items" SET "plannedQty" = 0 WHERE "plannedQty" IS NULL;
ALTER TABLE "gdr_production_order_items" ALTER COLUMN "plannedQty"  SET NOT NULL;
ALTER TABLE "gdr_production_order_items" ALTER COLUMN "componentId" SET NOT NULL;

-- FK componentId
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_order_items_componentId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_order_items"
            ADD CONSTRAINT "gdr_production_order_items_componentId_fkey"
            FOREIGN KEY ("componentId") REFERENCES "gdr_products"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
