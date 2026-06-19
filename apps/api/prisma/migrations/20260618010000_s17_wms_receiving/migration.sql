-- S17: WMS — Entrada e Endereçamento

-- 1. Warehouse: flag de WMS
ALTER TABLE "gdr_warehouses" ADD COLUMN IF NOT EXISTS "wmsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 2. StockBalance: estoque aguardando putaway
ALTER TABLE "gdr_stock_balances" ADD COLUMN IF NOT EXISTS "pendingPutaway" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- 3. Enums
DO $$ BEGIN
  CREATE TYPE "LocationType" AS ENUM ('RECEIVING', 'STORAGE', 'STAGING');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ReceivingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "PutawayStatus" AS ENUM ('PENDING', 'CONFIRMED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4. Tabela de endereços físicos
CREATE TABLE IF NOT EXISTS "gdr_locations" (
    "id"          TEXT          NOT NULL,
    "companyId"   TEXT          NOT NULL,
    "warehouseId" TEXT          NOT NULL,
    "code"        TEXT          NOT NULL,
    "description" TEXT,
    "type"        "LocationType" NOT NULL DEFAULT 'STORAGE',
    "isActive"    BOOLEAN       NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_locations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "gdr_locations" ADD CONSTRAINT "gdr_locations_warehouseId_code_key" UNIQUE ("warehouseId", "code");
CREATE INDEX IF NOT EXISTS "gdr_locations_companyId_idx" ON "gdr_locations"("companyId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_locations_companyId_fkey') THEN
    ALTER TABLE "gdr_locations" ADD CONSTRAINT "gdr_locations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_locations_warehouseId_fkey') THEN
    ALTER TABLE "gdr_locations" ADD CONSTRAINT "gdr_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Ordens de recebimento
CREATE TABLE IF NOT EXISTS "gdr_receiving_orders" (
    "id"             TEXT             NOT NULL,
    "companyId"      TEXT             NOT NULL,
    "goodsReceiptId" TEXT             NOT NULL,
    "warehouseId"    TEXT             NOT NULL,
    "status"         "ReceivingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_receiving_orders_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "gdr_receiving_orders" ADD CONSTRAINT "gdr_receiving_orders_goodsReceiptId_key" UNIQUE ("goodsReceiptId");
CREATE INDEX IF NOT EXISTS "gdr_receiving_orders_companyId_status_idx" ON "gdr_receiving_orders"("companyId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_receiving_orders_companyId_fkey') THEN
    ALTER TABLE "gdr_receiving_orders" ADD CONSTRAINT "gdr_receiving_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_receiving_orders_goodsReceiptId_fkey') THEN
    ALTER TABLE "gdr_receiving_orders" ADD CONSTRAINT "gdr_receiving_orders_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_receiving_orders_warehouseId_fkey') THEN
    ALTER TABLE "gdr_receiving_orders" ADD CONSTRAINT "gdr_receiving_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Tarefas de putaway
CREATE TABLE IF NOT EXISTS "gdr_putaway_tasks" (
    "id"               TEXT           NOT NULL,
    "companyId"        TEXT           NOT NULL,
    "receivingOrderId" TEXT           NOT NULL,
    "productId"        TEXT           NOT NULL,
    "qty"              DECIMAL(14,4)  NOT NULL,
    "locationId"       TEXT,
    "status"           "PutawayStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedById"    TEXT,
    "confirmedAt"      TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_putaway_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "gdr_putaway_tasks_receivingOrderId_idx" ON "gdr_putaway_tasks"("receivingOrderId");
CREATE INDEX IF NOT EXISTS "gdr_putaway_tasks_companyId_status_idx" ON "gdr_putaway_tasks"("companyId", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_putaway_tasks_companyId_fkey') THEN
    ALTER TABLE "gdr_putaway_tasks" ADD CONSTRAINT "gdr_putaway_tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_putaway_tasks_receivingOrderId_fkey') THEN
    ALTER TABLE "gdr_putaway_tasks" ADD CONSTRAINT "gdr_putaway_tasks_receivingOrderId_fkey" FOREIGN KEY ("receivingOrderId") REFERENCES "gdr_receiving_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_putaway_tasks_productId_fkey') THEN
    ALTER TABLE "gdr_putaway_tasks" ADD CONSTRAINT "gdr_putaway_tasks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_putaway_tasks_locationId_fkey') THEN
    ALTER TABLE "gdr_putaway_tasks" ADD CONSTRAINT "gdr_putaway_tasks_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "gdr_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdr_putaway_tasks_confirmedById_fkey') THEN
    ALTER TABLE "gdr_putaway_tasks" ADD CONSTRAINT "gdr_putaway_tasks_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
