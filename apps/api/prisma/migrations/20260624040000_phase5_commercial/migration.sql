-- Phase 5: Commercial
-- #190 Partial receiving, #187 Credit policy, #189 Price tables,
-- #191 Commissions, #192 RFQ

-- #190: Add PARTIALLY_RECEIVED to PurchaseOrderStatus
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_RECEIVED' BEFORE 'RECEIVED';

-- #190: Add receivedQuantity to POItem
ALTER TABLE "gdr_po_items" ADD COLUMN "receivedQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- #187: Add CREDIT_HOLD to SalesOrderStatus
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'CREDIT_HOLD' BEFORE 'RESERVED';

-- #189: PriceTable types
CREATE TYPE "PriceTableType" AS ENUM ('STANDARD', 'PROMOTIONAL', 'CUSTOMER_SPECIFIC');

-- #189: PriceTable
CREATE TABLE "gdr_price_tables" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PriceTableType" NOT NULL DEFAULT 'STANDARD',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_price_tables_pkey" PRIMARY KEY ("id")
);

-- #189: PriceTableItem
CREATE TABLE "gdr_price_table_items" (
    "id" TEXT NOT NULL,
    "priceTableId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "minQuantity" DECIMAL(14,4),
    "discountPercent" DECIMAL(5,2),

    CONSTRAINT "gdr_price_table_items_pkey" PRIMARY KEY ("id")
);

-- #191: Commission types
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED');

-- #191: CommissionRule
CREATE TABLE "gdr_commission_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productCategoryId" TEXT,
    "percentRate" DECIMAL(5,2) NOT NULL,
    "fixedAmount" DECIMAL(14,4),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_commission_rules_pkey" PRIMARY KEY ("id")
);

-- #191: Commission
CREATE TABLE "gdr_commissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "payableId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_commissions_pkey" PRIMARY KEY ("id")
);

-- #192: RFQ types
CREATE TYPE "RfqStatus" AS ENUM ('DRAFT', 'SENT', 'QUOTED', 'AWARDED', 'CANCELLED');

-- #192: RequestForQuotation
CREATE TABLE "gdr_rfqs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'DRAFT',
    "deadline" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_rfqs_pkey" PRIMARY KEY ("id")
);

-- #192: RfqItem
CREATE TABLE "gdr_rfq_items" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "specs" TEXT,

    CONSTRAINT "gdr_rfq_items_pkey" PRIMARY KEY ("id")
);

-- #192: RfqQuote
CREATE TABLE "gdr_rfq_quotes" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,4),
    "deliveryDays" INTEGER,
    "paymentTerms" TEXT,
    "validUntil" TIMESTAMP(3),
    "isAwarded" BOOLEAN NOT NULL DEFAULT false,
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_rfq_quotes_pkey" PRIMARY KEY ("id")
);

-- #192: RfqQuoteItem
CREATE TABLE "gdr_rfq_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "gdr_rfq_quote_items_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "gdr_price_tables_companyId_isActive_idx" ON "gdr_price_tables"("companyId", "isActive");
CREATE INDEX "gdr_price_tables_customerId_idx" ON "gdr_price_tables"("customerId");
CREATE UNIQUE INDEX "gdr_price_table_items_priceTableId_productId_minQuantity_key" ON "gdr_price_table_items"("priceTableId", "productId", "minQuantity");
CREATE INDEX "gdr_commission_rules_companyId_userId_idx" ON "gdr_commission_rules"("companyId", "userId");
CREATE INDEX "gdr_commissions_companyId_userId_idx" ON "gdr_commissions"("companyId", "userId");
CREATE INDEX "gdr_commissions_salesOrderId_idx" ON "gdr_commissions"("salesOrderId");
CREATE INDEX "gdr_rfqs_companyId_status_idx" ON "gdr_rfqs"("companyId", "status");
CREATE INDEX "gdr_rfq_quotes_rfqId_supplierId_idx" ON "gdr_rfq_quotes"("rfqId", "supplierId");

-- Foreign keys
ALTER TABLE "gdr_price_tables" ADD CONSTRAINT "gdr_price_tables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_price_tables" ADD CONSTRAINT "gdr_price_tables_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "gdr_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_price_table_items" ADD CONSTRAINT "gdr_price_table_items_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "gdr_price_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_price_table_items" ADD CONSTRAINT "gdr_price_table_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commission_rules" ADD CONSTRAINT "gdr_commission_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commission_rules" ADD CONSTRAINT "gdr_commission_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commissions" ADD CONSTRAINT "gdr_commissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commissions" ADD CONSTRAINT "gdr_commissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commissions" ADD CONSTRAINT "gdr_commissions_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_commissions" ADD CONSTRAINT "gdr_commissions_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "gdr_payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_rfqs" ADD CONSTRAINT "gdr_rfqs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_rfqs" ADD CONSTRAINT "gdr_rfqs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_items" ADD CONSTRAINT "gdr_rfq_items_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "gdr_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_items" ADD CONSTRAINT "gdr_rfq_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_quotes" ADD CONSTRAINT "gdr_rfq_quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "gdr_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_quotes" ADD CONSTRAINT "gdr_rfq_quotes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_quotes" ADD CONSTRAINT "gdr_rfq_quotes_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_quote_items" ADD CONSTRAINT "gdr_rfq_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "gdr_rfq_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_rfq_quote_items" ADD CONSTRAINT "gdr_rfq_quote_items_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "gdr_rfq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
