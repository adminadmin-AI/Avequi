-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('MATRIZ', 'FILIAL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'PRODUCTION', 'QUALITY', 'WAREHOUSE', 'FINANCIAL', 'STORE', 'READER');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('RAW_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD', 'CONSUMABLE', 'SERVICE');

-- CreateEnum
CREATE TYPE "UnitOfMeasure" AS ENUM ('UN', 'KG', 'G', 'M', 'M2', 'M3', 'L', 'PC', 'CX', 'PR');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'REVERSAL', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'RESERVED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('NFE', 'NFCE');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'ERROR');

-- CreateEnum
CREATE TYPE "FinancialEntryType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "FinancialEntryStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "gdr_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL DEFAULT 'MATRIZ',
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'READER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "companyId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_products" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ProductType" NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "ncm" TEXT,
    "costPrice" DECIMAL(14,4),
    "salePrice" DECIMAL(14,4),
    "avgCost" DECIMAL(14,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_customers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_bom_versions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_bom_items" (
    "id" TEXT NOT NULL,
    "bomVersionId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "scrapPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',

    CONSTRAINT "gdr_bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_routing_steps" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "workCenter" TEXT,
    "setupTimeMin" INTEGER NOT NULL DEFAULT 0,
    "runTimeMin" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_routing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_warehouses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_stock_balances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "available" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "inTransit" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_stock_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "reversedById" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_purchase_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_po_items" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',

    CONSTRAINT "gdr_po_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_goods_receipts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_gr_items" (
    "id" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyOrdered" DECIMAL(14,4) NOT NULL,
    "qtyReceived" DECIMAL(14,4) NOT NULL,
    "divergenceReason" TEXT,

    CONSTRAINT "gdr_gr_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_sales_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_sale_items" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',

    CONSTRAINT "gdr_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_fiscal_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "storeTransferId" TEXT,
    "type" "FiscalDocumentType" NOT NULL DEFAULT 'NFCE',
    "status" "FiscalStatus" NOT NULL DEFAULT 'PENDING',
    "focusRef" TEXT,
    "chave" TEXT,
    "xml" TEXT,
    "rejectionCode" TEXT,
    "rejectionReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_financial_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "FinancialEntryType" NOT NULL,
    "status" "FinancialEntryStatus" NOT NULL DEFAULT 'OPEN',
    "amount" DECIMAL(14,4) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "salesOrderId" TEXT,
    "purchaseOrderId" TEXT,
    "goodsReceiptId" TEXT,
    "fiscalDocumentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,4),
    "paymentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_financial_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_store_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "requestedById" TEXT,
    "dispatchedById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_store_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_store_transfer_items" (
    "id" TEXT NOT NULL,
    "storeTransferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" "UnitOfMeasure" NOT NULL DEFAULT 'UN',

    CONSTRAINT "gdr_store_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_demand_forecasts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_demand_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_companies_cnpj_key" ON "gdr_companies"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_users_email_key" ON "gdr_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_refresh_tokens_token_key" ON "gdr_refresh_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_products_companyId_sku_key" ON "gdr_products"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_suppliers_companyId_cnpj_key" ON "gdr_suppliers"("companyId", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_customers_companyId_document_key" ON "gdr_customers"("companyId", "document");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_bom_versions_productId_version_key" ON "gdr_bom_versions"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_routing_steps_productId_stepOrder_key" ON "gdr_routing_steps"("productId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_warehouses_companyId_code_key" ON "gdr_warehouses"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_stock_balances_warehouseId_productId_key" ON "gdr_stock_balances"("warehouseId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_fiscal_documents_salesOrderId_key" ON "gdr_fiscal_documents"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_fiscal_documents_storeTransferId_key" ON "gdr_fiscal_documents"("storeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_financial_entries_salesOrderId_key" ON "gdr_financial_entries"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_financial_entries_goodsReceiptId_key" ON "gdr_financial_entries"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_financial_entries_fiscalDocumentId_key" ON "gdr_financial_entries"("fiscalDocumentId");

-- CreateIndex
CREATE INDEX "gdr_financial_entries_companyId_idx" ON "gdr_financial_entries"("companyId");

-- CreateIndex
CREATE INDEX "gdr_financial_entries_type_status_idx" ON "gdr_financial_entries"("type", "status");

-- CreateIndex
CREATE INDEX "gdr_financial_entries_dueDate_idx" ON "gdr_financial_entries"("dueDate");

-- CreateIndex
CREATE INDEX "gdr_store_transfers_companyId_idx" ON "gdr_store_transfers"("companyId");

-- CreateIndex
CREATE INDEX "gdr_store_transfers_status_idx" ON "gdr_store_transfers"("status");

-- CreateIndex
CREATE INDEX "gdr_demand_forecasts_companyId_idx" ON "gdr_demand_forecasts"("companyId");

-- CreateIndex
CREATE INDEX "gdr_demand_forecasts_period_idx" ON "gdr_demand_forecasts"("period");

-- CreateIndex
CREATE INDEX "gdr_demand_forecasts_productId_idx" ON "gdr_demand_forecasts"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_demand_forecasts_companyId_productId_period_key" ON "gdr_demand_forecasts"("companyId", "productId", "period");

-- AddForeignKey
ALTER TABLE "gdr_companies" ADD CONSTRAINT "gdr_companies_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "gdr_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_users" ADD CONSTRAINT "gdr_users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_refresh_tokens" ADD CONSTRAINT "gdr_refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_audit_logs" ADD CONSTRAINT "gdr_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_audit_logs" ADD CONSTRAINT "gdr_audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_products" ADD CONSTRAINT "gdr_products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_suppliers" ADD CONSTRAINT "gdr_suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_customers" ADD CONSTRAINT "gdr_customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_bom_versions" ADD CONSTRAINT "gdr_bom_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_bom_versions" ADD CONSTRAINT "gdr_bom_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_bom_items" ADD CONSTRAINT "gdr_bom_items_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "gdr_bom_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_bom_items" ADD CONSTRAINT "gdr_bom_items_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_routing_steps" ADD CONSTRAINT "gdr_routing_steps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_routing_steps" ADD CONSTRAINT "gdr_routing_steps_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_warehouses" ADD CONSTRAINT "gdr_warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_balances" ADD CONSTRAINT "gdr_stock_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_balances" ADD CONSTRAINT "gdr_stock_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_balances" ADD CONSTRAINT "gdr_stock_balances_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_movements" ADD CONSTRAINT "gdr_stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_movements" ADD CONSTRAINT "gdr_stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_movements" ADD CONSTRAINT "gdr_stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_stock_movements" ADD CONSTRAINT "gdr_stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_purchase_orders" ADD CONSTRAINT "gdr_purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_purchase_orders" ADD CONSTRAINT "gdr_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_purchase_orders" ADD CONSTRAINT "gdr_purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_purchase_orders" ADD CONSTRAINT "gdr_purchase_orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_po_items" ADD CONSTRAINT "gdr_po_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_po_items" ADD CONSTRAINT "gdr_po_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_goods_receipts" ADD CONSTRAINT "gdr_goods_receipts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_goods_receipts" ADD CONSTRAINT "gdr_goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_goods_receipts" ADD CONSTRAINT "gdr_goods_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_goods_receipts" ADD CONSTRAINT "gdr_goods_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_gr_items" ADD CONSTRAINT "gdr_gr_items_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_gr_items" ADD CONSTRAINT "gdr_gr_items_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "gdr_po_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_gr_items" ADD CONSTRAINT "gdr_gr_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sales_orders" ADD CONSTRAINT "gdr_sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sales_orders" ADD CONSTRAINT "gdr_sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "gdr_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sales_orders" ADD CONSTRAINT "gdr_sales_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sales_orders" ADD CONSTRAINT "gdr_sales_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sale_items" ADD CONSTRAINT "gdr_sale_items_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_sale_items" ADD CONSTRAINT "gdr_sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_fiscal_documents" ADD CONSTRAINT "gdr_fiscal_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_fiscal_documents" ADD CONSTRAINT "gdr_fiscal_documents_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_fiscal_documents" ADD CONSTRAINT "gdr_fiscal_documents_storeTransferId_fkey" FOREIGN KEY ("storeTransferId") REFERENCES "gdr_store_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "gdr_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "gdr_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "gdr_fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "gdr_warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfers" ADD CONSTRAINT "gdr_store_transfers_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfer_items" ADD CONSTRAINT "gdr_store_transfer_items_storeTransferId_fkey" FOREIGN KEY ("storeTransferId") REFERENCES "gdr_store_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_store_transfer_items" ADD CONSTRAINT "gdr_store_transfer_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_demand_forecasts" ADD CONSTRAINT "gdr_demand_forecasts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_demand_forecasts" ADD CONSTRAINT "gdr_demand_forecasts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_demand_forecasts" ADD CONSTRAINT "gdr_demand_forecasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

