-- Phase 4: Produção Avançada
-- Issues #180-#186

-- Product: lote mínimo/múltiplo (#181), lead time (#183), inspeção final (#185)
ALTER TABLE "gdr_products" ADD COLUMN "minOrderQty" DECIMAL(14,4);
ALTER TABLE "gdr_products" ADD COLUMN "orderMultiple" DECIMAL(14,4);
ALTER TABLE "gdr_products" ADD COLUMN "minProductionQty" DECIMAL(14,4);
ALTER TABLE "gdr_products" ADD COLUMN "productionMultiple" DECIMAL(14,4);
ALTER TABLE "gdr_products" ADD COLUMN "leadTimeDays" INTEGER DEFAULT 0;
ALTER TABLE "gdr_products" ADD COLUMN "requiresFinalInspection" BOOLEAN NOT NULL DEFAULT false;

-- WorkCenter: custo/hora (#182)
ALTER TABLE "gdr_work_centers" ADD COLUMN "costPerHour" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- ProductionLog: tempo + refugo (#184)
ALTER TABLE "gdr_production_log" ADD COLUMN "scrapQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "gdr_production_log" ADD COLUMN "scrapReason" TEXT;
ALTER TABLE "gdr_production_log" ADD COLUMN "startTime" TIMESTAMP(3);
ALTER TABLE "gdr_production_log" ADD COLUMN "endTime" TIMESTAMP(3);
ALTER TABLE "gdr_production_log" ADD COLUMN "hoursWorked" DECIMAL(10,2);

-- ProductionOrderStatus: PENDING_INSPECTION (#185)
ALTER TYPE "ProductionOrderStatus" ADD VALUE 'PENDING_INSPECTION';

-- SerialComponent: rastreabilidade componente ↔ chassi (#186)
CREATE TABLE "gdr_serial_components" (
    "id" TEXT NOT NULL,
    "serialId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "batchId" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_serial_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_serial_components_serialId_idx" ON "gdr_serial_components"("serialId");
CREATE INDEX "gdr_serial_components_batchId_idx" ON "gdr_serial_components"("batchId");
CREATE INDEX "gdr_serial_components_productionOrderId_idx" ON "gdr_serial_components"("productionOrderId");

ALTER TABLE "gdr_serial_components" ADD CONSTRAINT "gdr_serial_components_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "gdr_serial_number"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_serial_components" ADD CONSTRAINT "gdr_serial_components_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_serial_components" ADD CONSTRAINT "gdr_serial_components_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gdr_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_serial_components" ADD CONSTRAINT "gdr_serial_components_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "gdr_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
