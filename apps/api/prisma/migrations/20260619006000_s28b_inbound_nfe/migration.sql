-- S28B: NF-e de Entrada

CREATE TYPE "InboundNfeStatus" AS ENUM ('PENDING', 'MATCHED', 'IMPORTED', 'REJECTED');

CREATE TABLE "gdr_inbound_nfe" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chaveNfe" TEXT NOT NULL,
    "nfeNumber" TEXT,
    "series" TEXT,
    "supplierCnpj" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "totalValue" DECIMAL(14,4),
    "status" "InboundNfeStatus" NOT NULL DEFAULT 'PENDING',
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "xmlContent" TEXT NOT NULL,
    "parsedItems" JSONB NOT NULL DEFAULT '[]',
    "rejectReason" TEXT,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_inbound_nfe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_inbound_nfe_chaveNfe_key" ON "gdr_inbound_nfe"("chaveNfe");
CREATE UNIQUE INDEX "gdr_inbound_nfe_goodsReceiptId_key" ON "gdr_inbound_nfe"("goodsReceiptId");
CREATE INDEX "gdr_inbound_nfe_companyId_status_idx" ON "gdr_inbound_nfe"("companyId", "status");
CREATE INDEX "gdr_inbound_nfe_supplierCnpj_idx" ON "gdr_inbound_nfe"("supplierCnpj");

ALTER TABLE "gdr_inbound_nfe" ADD CONSTRAINT "gdr_inbound_nfe_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_inbound_nfe" ADD CONSTRAINT "gdr_inbound_nfe_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_inbound_nfe" ADD CONSTRAINT "gdr_inbound_nfe_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_inbound_nfe" ADD CONSTRAINT "gdr_inbound_nfe_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
