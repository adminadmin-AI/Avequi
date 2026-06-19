-- S28A: Orçamentos e Propostas Comerciais

CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED');

CREATE TABLE "gdr_quotations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "salesOrderId" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gdr_quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    CONSTRAINT "gdr_quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_quotations_salesOrderId_key" ON "gdr_quotations"("salesOrderId");
CREATE INDEX "gdr_quotations_companyId_status_idx" ON "gdr_quotations"("companyId", "status");
CREATE INDEX "gdr_quotations_customerId_idx" ON "gdr_quotations"("customerId");
CREATE INDEX "gdr_quotation_items_quotationId_idx" ON "gdr_quotation_items"("quotationId");

ALTER TABLE "gdr_quotations" ADD CONSTRAINT "gdr_quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_quotations" ADD CONSTRAINT "gdr_quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "gdr_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_quotations" ADD CONSTRAINT "gdr_quotations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_quotations" ADD CONSTRAINT "gdr_quotations_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_quotations" ADD CONSTRAINT "gdr_quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_quotation_items" ADD CONSTRAINT "gdr_quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "gdr_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_quotation_items" ADD CONSTRAINT "gdr_quotation_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
