-- S28D: Gestão de Lotes

CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'QUARANTINE', 'CONSUMED', 'EXPIRED', 'SCRAPPED');
CREATE TYPE "BatchEventType" AS ENUM ('RECEIPT', 'TRANSFER', 'CONSUMPTION', 'ADJUSTMENT', 'QUARANTINE', 'RELEASE', 'EXPIRY', 'SCRAP');

CREATE TABLE "gdr_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "supplierId" TEXT,
    "goodsReceiptId" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "initialQty" DECIMAL(14,4) NOT NULL,
    "currentQty" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "manufacturingDate" TIMESTAMP(3),
    "expirationDate" TIMESTAMP(3),
    "warehouseId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gdr_batch_events" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "BatchEventType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "qtyBefore" DECIMAL(14,4) NOT NULL,
    "qtyAfter" DECIMAL(14,4) NOT NULL,
    "productionOrderId" TEXT,
    "warehouseFromId" TEXT,
    "warehouseTo" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_batch_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_batches_companyId_batchNumber_productId_key" ON "gdr_batches"("companyId", "batchNumber", "productId");
CREATE INDEX "gdr_batches_companyId_status_idx" ON "gdr_batches"("companyId", "status");
CREATE INDEX "gdr_batches_productId_idx" ON "gdr_batches"("productId");
CREATE INDEX "gdr_batches_expirationDate_idx" ON "gdr_batches"("expirationDate");
CREATE INDEX "gdr_batch_events_batchId_idx" ON "gdr_batch_events"("batchId");
CREATE INDEX "gdr_batch_events_productionOrderId_idx" ON "gdr_batch_events"("productionOrderId");

ALTER TABLE "gdr_batches" ADD CONSTRAINT "gdr_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_batches" ADD CONSTRAINT "gdr_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_batches" ADD CONSTRAINT "gdr_batches_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_batches" ADD CONSTRAINT "gdr_batches_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_batches" ADD CONSTRAINT "gdr_batches_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_batch_events" ADD CONSTRAINT "gdr_batch_events_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "gdr_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_batch_events" ADD CONSTRAINT "gdr_batch_events_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "gdr_production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_batch_events" ADD CONSTRAINT "gdr_batch_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
