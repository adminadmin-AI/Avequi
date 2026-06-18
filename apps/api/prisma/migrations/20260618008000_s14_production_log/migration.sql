-- S14: Apontamento de Produção — estender gdr_production_log com etapa do roteiro

-- Renomeia production_order_id → productionOrderId (snake → camel para Prisma)
-- e adiciona colunas novas mantendo dados legados

-- 1. Adiciona colunas novas
ALTER TABLE "gdr_production_log"
    ADD COLUMN IF NOT EXISTS "productionOrderId" TEXT,
    ADD COLUMN IF NOT EXISTS "routingStepId"     TEXT,
    ADD COLUMN IF NOT EXISTS "stepOrder"         INTEGER,
    ADD COLUMN IF NOT EXISTS "qty"               DECIMAL(14,4),
    ADD COLUMN IF NOT EXISTS "userId"            TEXT,
    ADD COLUMN IF NOT EXISTS "workCenter"        TEXT;

-- 2. Migra dados legados para as novas colunas
UPDATE "gdr_production_log"
SET
    "productionOrderId" = "production_order_id",
    "qty"               = "quantity",
    "userId"            = "user_id",
    "workCenter"        = "work_center"
WHERE "productionOrderId" IS NULL;

-- 3. Garante NOT NULL onde necessário
UPDATE "gdr_production_log" SET "qty" = 0 WHERE "qty" IS NULL;
UPDATE "gdr_production_log" SET "productionOrderId" = "production_order_id" WHERE "productionOrderId" IS NULL;
ALTER TABLE "gdr_production_log" ALTER COLUMN "productionOrderId" SET NOT NULL;
ALTER TABLE "gdr_production_log" ALTER COLUMN "qty" SET NOT NULL;

-- 4. Renomeia coluna loggedAt (já existe como logged_at com timezone)
--    Adicionamos alias via coluna nova se necessário — Prisma usará "loggedAt" via @map
--    Na verdade o Prisma pode mapear snake_case, mas preferimos manter o nome "loggedAt"
--    O modelo Prisma usará @@map("gdr_production_log") e as colunas serão mapeadas pelo Prisma

-- 5. FKs novas
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_log_productionOrderId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_log"
            ADD CONSTRAINT "gdr_production_log_productionOrderId_fkey"
            FOREIGN KEY ("productionOrderId") REFERENCES "gdr_production_orders"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_log_routingStepId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_log"
            ADD CONSTRAINT "gdr_production_log_routingStepId_fkey"
            FOREIGN KEY ("routingStepId") REFERENCES "gdr_routing_steps"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_log_userId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_log"
            ADD CONSTRAINT "gdr_production_log_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "gdr_users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 6. Índice
CREATE INDEX IF NOT EXISTS "gdr_production_log_productionOrderId_idx"
    ON "gdr_production_log"("productionOrderId");
