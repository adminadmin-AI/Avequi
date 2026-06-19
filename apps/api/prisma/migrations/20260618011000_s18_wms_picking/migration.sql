-- S18: WMS Saída e Expedição — PickingOrder + PickTask

-- Enums
CREATE TYPE "PickingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');
CREATE TYPE "PickTaskStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- PickingOrder
CREATE TABLE "gdr_picking_orders" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "salesOrderId" TEXT NOT NULL,
  "warehouseId"  TEXT NOT NULL,
  "status"       "PickingStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_picking_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_picking_orders_salesOrderId_key" ON "gdr_picking_orders"("salesOrderId");
CREATE INDEX "gdr_picking_orders_companyId_status_idx" ON "gdr_picking_orders"("companyId", "status");

-- PickTask
CREATE TABLE "gdr_pick_tasks" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "pickingOrderId" TEXT NOT NULL,
  "productId"      TEXT NOT NULL,
  "qty"            DECIMAL(14,4) NOT NULL,
  "locationId"     TEXT,
  "notes"          TEXT,
  "status"         "PickTaskStatus" NOT NULL DEFAULT 'PENDING',
  "confirmedById"  TEXT,
  "confirmedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_pick_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_pick_tasks_pickingOrderId_idx" ON "gdr_pick_tasks"("pickingOrderId");
CREATE INDEX "gdr_pick_tasks_companyId_status_idx" ON "gdr_pick_tasks"("companyId", "status");

-- Foreign keys
ALTER TABLE "gdr_picking_orders"
  ADD CONSTRAINT "gdr_picking_orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_picking_orders_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_picking_orders_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_pick_tasks"
  ADD CONSTRAINT "gdr_pick_tasks_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_pick_tasks_pickingOrderId_fkey"
    FOREIGN KEY ("pickingOrderId") REFERENCES "gdr_picking_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_pick_tasks_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_pick_tasks_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "gdr_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "gdr_pick_tasks_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
