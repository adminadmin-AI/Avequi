-- S16: Produção — Encerramento e Custo
-- Cria tabela gdr_production_costs para registrar o custo real de cada OP ao encerrar

CREATE TABLE IF NOT EXISTS "gdr_production_costs" (
    "id"                TEXT            NOT NULL,
    "productionOrderId" TEXT            NOT NULL,
    "materialCost"      DECIMAL(14,4)   NOT NULL DEFAULT 0,
    "laborCost"         DECIMAL(14,4)   NOT NULL DEFAULT 0,
    "totalCost"         DECIMAL(14,4)   NOT NULL DEFAULT 0,
    "costPerUnit"       DECIMAL(14,4)   NOT NULL DEFAULT 0,
    "breakdown"         JSONB           NOT NULL DEFAULT '[]',
    "createdAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_production_costs_pkey" PRIMARY KEY ("id")
);

-- Unicidade: 1 custo por OP
ALTER TABLE "gdr_production_costs"
    ADD CONSTRAINT "gdr_production_costs_productionOrderId_key" UNIQUE ("productionOrderId");

-- FK → gdr_production_orders (cascade delete junto com a OP)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'gdr_production_costs_productionOrderId_fkey'
    ) THEN
        ALTER TABLE "gdr_production_costs"
            ADD CONSTRAINT "gdr_production_costs_productionOrderId_fkey"
            FOREIGN KEY ("productionOrderId")
            REFERENCES "gdr_production_orders"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
