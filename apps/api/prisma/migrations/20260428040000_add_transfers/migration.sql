-- S10: Transferência fábrica → loja com estoque em trânsito e NF-e

-- 1. Adicionar inTransit ao StockBalance
ALTER TABLE "stock_balances" ADD COLUMN "inTransit" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- 2. Tornar salesOrderId nullable no FiscalDocument e reservar coluna storeTransferId
ALTER TABLE "fiscal_documents" ALTER COLUMN "salesOrderId" DROP NOT NULL;
ALTER TABLE "fiscal_documents" ADD COLUMN "storeTransferId" TEXT;

-- 3. StoreTransfer
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "store_transfers" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "fromWarehouseId" TEXT NOT NULL,
  "toWarehouseId"   TEXT NOT NULL,
  "status"          "TransferStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"           TEXT,
  "requestedById"   TEXT,
  "dispatchedById"  TEXT,
  "dispatchedAt"    TIMESTAMP(3),
  "receivedById"    TEXT,
  "receivedAt"      TIMESTAMP(3),
  "cancelledAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "store_transfers_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "store_transfers_companyId_fkey"       FOREIGN KEY ("companyId")       REFERENCES "companies"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "store_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "store_transfers_toWarehouseId_fkey"   FOREIGN KEY ("toWarehouseId")   REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "store_transfers_requestedById_fkey"   FOREIGN KEY ("requestedById")   REFERENCES "users"("id")      ON DELETE SET NULL  ON UPDATE CASCADE,
  CONSTRAINT "store_transfers_dispatchedById_fkey"  FOREIGN KEY ("dispatchedById")  REFERENCES "users"("id")      ON DELETE SET NULL  ON UPDATE CASCADE,
  CONSTRAINT "store_transfers_receivedById_fkey"    FOREIGN KEY ("receivedById")    REFERENCES "users"("id")      ON DELETE SET NULL  ON UPDATE CASCADE
);

CREATE INDEX "store_transfers_companyId_idx" ON "store_transfers"("companyId");
CREATE INDEX "store_transfers_status_idx"    ON "store_transfers"("status");

-- 4. StoreTransferItem
CREATE TABLE "store_transfer_items" (
  "id"              TEXT NOT NULL,
  "storeTransferId" TEXT NOT NULL,
  "productId"       TEXT NOT NULL,
  "quantity"        DECIMAL(14,4) NOT NULL,
  "unit"            "UnitOfMeasure" NOT NULL DEFAULT 'UN',

  CONSTRAINT "store_transfer_items_pkey"                PRIMARY KEY ("id"),
  CONSTRAINT "store_transfer_items_storeTransferId_fkey" FOREIGN KEY ("storeTransferId") REFERENCES "store_transfers"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "store_transfer_items_productId_fkey"       FOREIGN KEY ("productId")       REFERENCES "products"("id")        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 5. FK de FiscalDocument → StoreTransfer (agora que a tabela existe)
ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_documents_storeTransferId_fkey"
  FOREIGN KEY ("storeTransferId") REFERENCES "store_transfers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "fiscal_documents_storeTransferId_key"
  ON "fiscal_documents"("storeTransferId")
  WHERE "storeTransferId" IS NOT NULL;
