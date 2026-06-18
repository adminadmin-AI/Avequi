-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'CONVERTED', 'CANCELLED');

-- CreateTable: solicitação de compra
CREATE TABLE "gdr_purchase_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "neededBy" TIMESTAMP(3),
    "justification" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" TEXT,
    "convertedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable: histórico de preços de fornecedores
CREATE TABLE "gdr_supplier_price_history" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "goodsReceiptId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_supplier_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_purchase_requests_companyId_status_idx" ON "gdr_purchase_requests"("companyId", "status");
CREATE INDEX "gdr_supplier_price_history_supplierId_productId_idx" ON "gdr_supplier_price_history"("supplierId", "productId");
CREATE INDEX "gdr_supplier_price_history_companyId_idx" ON "gdr_supplier_price_history"("companyId");

-- AddForeignKey
ALTER TABLE "gdr_purchase_requests" ADD CONSTRAINT "gdr_purchase_requests_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_purchase_requests" ADD CONSTRAINT "gdr_purchase_requests_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_purchase_requests" ADD CONSTRAINT "gdr_purchase_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gdr_purchase_requests" ADD CONSTRAINT "gdr_purchase_requests_convertedToId_fkey"
  FOREIGN KEY ("convertedToId") REFERENCES "gdr_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gdr_supplier_price_history" ADD CONSTRAINT "gdr_supplier_price_history_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_supplier_price_history" ADD CONSTRAINT "gdr_supplier_price_history_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gdr_supplier_price_history" ADD CONSTRAINT "gdr_supplier_price_history_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
