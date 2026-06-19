-- S19: WMS Inventário Cíclico e Geral

-- Enums
CREATE TYPE "InventoryCountType" AS ENUM ('CYCLIC', 'FULL');
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'RECONCILED');
CREATE TYPE "InventoryItemStatus" AS ENUM ('PENDING', 'COUNTED');

-- InventoryCount
CREATE TABLE "gdr_inventory_counts" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "warehouseId"    TEXT NOT NULL,
  "type"           "InventoryCountType"   NOT NULL DEFAULT 'CYCLIC',
  "status"         "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"          TEXT,
  "createdById"    TEXT,
  "reconciledById" TEXT,
  "reconciledAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_inventory_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_inventory_counts_companyId_status_idx" ON "gdr_inventory_counts"("companyId", "status");
CREATE INDEX "gdr_inventory_counts_warehouseId_idx" ON "gdr_inventory_counts"("warehouseId");

-- InventoryCountItem
CREATE TABLE "gdr_inventory_count_items" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "inventoryCountId" TEXT NOT NULL,
  "productId"        TEXT NOT NULL,
  "systemQty"        DECIMAL(14,4) NOT NULL,
  "countedQty"       DECIMAL(14,4),
  "variance"         DECIMAL(14,4),
  "status"           "InventoryItemStatus" NOT NULL DEFAULT 'PENDING',
  "countedById"      TEXT,
  "countedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_inventory_count_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_inventory_count_items_inventoryCountId_productId_key"
  ON "gdr_inventory_count_items"("inventoryCountId", "productId");
CREATE INDEX "gdr_inventory_count_items_inventoryCountId_idx"
  ON "gdr_inventory_count_items"("inventoryCountId");
CREATE INDEX "gdr_inventory_count_items_companyId_status_idx"
  ON "gdr_inventory_count_items"("companyId", "status");

-- Foreign keys: InventoryCount
ALTER TABLE "gdr_inventory_counts"
  ADD CONSTRAINT "gdr_inventory_counts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_counts_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_counts_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_counts_reconciledById_fkey"
    FOREIGN KEY ("reconciledById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: InventoryCountItem
ALTER TABLE "gdr_inventory_count_items"
  ADD CONSTRAINT "gdr_inventory_count_items_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_count_items_inventoryCountId_fkey"
    FOREIGN KEY ("inventoryCountId") REFERENCES "gdr_inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_count_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_inventory_count_items_countedById_fkey"
    FOREIGN KEY ("countedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
