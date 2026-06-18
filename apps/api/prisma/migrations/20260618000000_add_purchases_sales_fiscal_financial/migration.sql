-- Migration: S05-S10 — Compras, Vendas, Fiscal, Financeiro, Transferência
-- Cobertura: SupplierPrice, PurchaseOrder, GoodsReceipt,
--            SalesOrder, FiscalDocument, BankAccount,
--            FinancialCategory, CostCenter, Payable, Receivable,
--            PaymentEntry, StockTransfer + campos legacyId nas tabelas existentes

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER tabelas existentes — adicionar colunas novas
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "legacyId" TEXT;

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "legacyId" TEXT;

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "sourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceId"   TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Novos ENUMs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED');
CREATE TYPE "GoodsReceiptStatus"  AS ENUM ('PENDING', 'INSPECTING', 'APPROVED', 'REJECTED');
CREATE TYPE "SalesOrderStatus"    AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'INVOICED', 'DELIVERED', 'CANCELLED');
CREATE TYPE "SalesOrderOrigin"    AS ENUM ('INTERNAL', 'SP_SYSTEM', 'NFE', 'ECOMMERCE');
CREATE TYPE "FiscalDocumentType"      AS ENUM ('NFE', 'NFCE', 'CTE', 'NFSE');
CREATE TYPE "FiscalDocumentDirection" AS ENUM ('OUTBOUND', 'INBOUND');
CREATE TYPE "FiscalDocumentStatus"    AS ENUM ('DRAFT', 'PENDING', 'AUTHORIZED', 'CANCELLED', 'DENIED', 'REJECTED');
CREATE TYPE "FiscalEventType"     AS ENUM ('CANCELLATION', 'CORRECTION', 'DENIAL', 'OTHER');
CREATE TYPE "BankAccountType"     AS ENUM ('CHECKING', 'SAVINGS', 'CASH', 'DIGITAL', 'INVESTMENT');
CREATE TYPE "FinancialCategoryType" AS ENUM ('REVENUE', 'EXPENSE', 'TRANSFER', 'GROUP');
CREATE TYPE "PayableStatus"       AS ENUM ('OPEN', 'PAID', 'PARTIAL', 'CANCELLED', 'OVERDUE');
CREATE TYPE "ReceivableStatus"    AS ENUM ('OPEN', 'PAID', 'PARTIAL', 'CANCELLED', 'OVERDUE');
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. system_parameters
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "system_parameters" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_parameters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_parameters_companyId_key_key" ON "system_parameters"("companyId", "key");

ALTER TABLE "system_parameters"
  ADD CONSTRAINT "system_parameters_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. supplier_prices  (S02 complemento — histórico de preços)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "supplier_prices" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "supplierId"   TEXT NOT NULL,
    "productId"    TEXT NOT NULL,
    "price"        DECIMAL(14,4) NOT NULL,
    "minQty"       DECIMAL(14,4) NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "validFrom"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo"      TIMESTAMP(3),
    "legacyId"     TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_prices_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "supplier_prices"
  ADD CONSTRAINT "supplier_prices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_prices_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_prices_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. purchase_orders + purchase_order_items  (S05)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "purchase_orders" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "supplierId"  TEXT NOT NULL,
    "number"      TEXT NOT NULL,
    "status"      "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedAt"  TIMESTAMP(3),
    "notes"       TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "legacyId"    TEXT,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_orders_companyId_number_key" ON "purchase_orders"("companyId", "number");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_orders_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_orders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "purchase_order_items" (
    "id"              TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId"       TEXT NOT NULL,
    "quantity"        DECIMAL(14,4) NOT NULL,
    "unitPrice"       DECIMAL(14,4) NOT NULL,
    "totalPrice"      DECIMAL(14,2) NOT NULL,
    "receivedQty"     DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unit"            "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. goods_receipts + goods_receipt_items  (S06)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "goods_receipts" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "warehouseId"     TEXT NOT NULL,
    "status"          "GoodsReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "supplierNfeKey"  TEXT,
    "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes"           TEXT,
    "legacyId"        TEXT,
    "receivedById"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "goods_receipts_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "goods_receipts_receivedById_fkey"
    FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "goods_receipt_items" (
    "id"             TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "productId"      TEXT NOT NULL,
    "quantity"       DECIMAL(14,4) NOT NULL,
    "unitPrice"      DECIMAL(14,4),
    "unit"           "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "lotNumber"      TEXT,
    "expiresAt"      TIMESTAMP(3),
    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "goods_receipt_items"
  ADD CONSTRAINT "goods_receipt_items_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "goods_receipt_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. sales_orders + sales_order_items + sales_order_serials  (S07)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sales_orders" (
    "id"           TEXT NOT NULL,
    "companyId"    TEXT NOT NULL,
    "customerId"   TEXT NOT NULL,
    "number"       TEXT NOT NULL,
    "status"       "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "origin"       "SalesOrderOrigin" NOT NULL DEFAULT 'INTERNAL',
    "deliveryDate" TIMESTAMP(3),
    "notes"        TEXT,
    "totalAmount"  DECIMAL(14,2) NOT NULL DEFAULT 0,
    "legacyId"     TEXT,
    "createdById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_orders_companyId_number_key" ON "sales_orders"("companyId", "number");

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_orders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sales_order_items" (
    "id"           TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId"    TEXT NOT NULL,
    "quantity"     DECIMAL(14,4) NOT NULL,
    "unitPrice"    DECIMAL(14,4) NOT NULL,
    "totalPrice"   DECIMAL(14,2) NOT NULL,
    "unit"         "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "legacyId"     TEXT,
    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sales_order_serials" (
    "id"           TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId"    TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "legacyId"     TEXT,
    CONSTRAINT "sales_order_serials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_order_serials_productId_serialNumber_key"
  ON "sales_order_serials"("productId", "serialNumber");

ALTER TABLE "sales_order_serials"
  ADD CONSTRAINT "sales_order_serials_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_order_serials_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. fiscal_documents + items + taxes + events  (S08)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "fiscal_documents" (
    "id"             TEXT NOT NULL,
    "companyId"      TEXT NOT NULL,
    "salesOrderId"   TEXT,
    "type"           "FiscalDocumentType" NOT NULL DEFAULT 'NFE',
    "direction"      "FiscalDocumentDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status"         "FiscalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "accessKey"      TEXT,
    "number"         TEXT,
    "series"         TEXT,
    "issuedAt"       TIMESTAMP(3),
    "totalAmount"    DECIMAL(14,2),
    "operationDesc"  TEXT,
    "recipientTaxId" TEXT,
    "recipientName"  TEXT,
    "issuerTaxId"    TEXT,
    "issuerName"     TEXT,
    "xmlContent"     TEXT,
    "focusNfeId"     TEXT,
    "legacyId"       TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_documents_accessKey_key" ON "fiscal_documents"("accessKey");

ALTER TABLE "fiscal_documents"
  ADD CONSTRAINT "fiscal_documents_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fiscal_documents_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fiscal_document_items" (
    "id"               TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "productId"        TEXT,
    "lineNumber"       INTEGER NOT NULL,
    "description"      TEXT NOT NULL,
    "ncm"              TEXT,
    "cfop"             TEXT,
    "quantity"         DECIMAL(14,4) NOT NULL,
    "unit"             TEXT NOT NULL DEFAULT 'UN',
    "unitPrice"        DECIMAL(14,4) NOT NULL,
    "totalPrice"       DECIMAL(14,2) NOT NULL,
    "legacyId"         TEXT,
    CONSTRAINT "fiscal_document_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fiscal_document_items"
  ADD CONSTRAINT "fiscal_document_items_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "fiscal_document_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "fiscal_document_item_taxes" (
    "id"                   TEXT NOT NULL,
    "fiscalDocumentItemId" TEXT NOT NULL,
    "taxType"              TEXT NOT NULL,
    "cst"                  TEXT,
    "baseAmount"           DECIMAL(14,2),
    "rate"                 DECIMAL(7,4),
    "amount"               DECIMAL(14,2),
    CONSTRAINT "fiscal_document_item_taxes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fiscal_document_item_taxes"
  ADD CONSTRAINT "fiscal_document_item_taxes_fiscalDocumentItemId_fkey"
    FOREIGN KEY ("fiscalDocumentItemId") REFERENCES "fiscal_document_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiscal_events" (
    "id"               TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "type"             "FiscalEventType" NOT NULL,
    "protocol"         TEXT,
    "description"      TEXT,
    "occurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyId"         TEXT,
    CONSTRAINT "fiscal_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fiscal_events"
  ADD CONSTRAINT "fiscal_events_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Financeiro: bank_accounts, financial_categories, cost_centers  (S09)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "bank_accounts" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "bankCode"         TEXT,
    "agency"           TEXT,
    "accountNumber"    TEXT,
    "type"             "BankAccountType" NOT NULL DEFAULT 'CHECKING',
    "initialBalance"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "initialBalanceAt" TIMESTAMP(3),
    "isActive"         BOOLEAN NOT NULL DEFAULT true,
    "legacyId"         TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "financial_categories" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "type"      "FinancialCategoryType" NOT NULL,
    "parentId"  TEXT,
    "dreCode"   TEXT,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "legacyId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_categories_companyId_code_key" ON "financial_categories"("companyId", "code");

ALTER TABLE "financial_categories"
  ADD CONSTRAINT "financial_categories_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "financial_categories_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cost_centers" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "legacyId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cost_centers_companyId_code_key" ON "cost_centers"("companyId", "code");

ALTER TABLE "cost_centers"
  ADD CONSTRAINT "cost_centers_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. payables + rateios + payment_entries  (S09)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "payables" (
    "id"          TEXT NOT NULL,
    "companyId"   TEXT NOT NULL,
    "supplierId"  TEXT,
    "description" TEXT NOT NULL,
    "amount"      DECIMAL(14,2) NOT NULL,
    "dueDate"     TIMESTAMP(3) NOT NULL,
    "status"      "PayableStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt"      TIMESTAMP(3),
    "paidAmount"  DECIMAL(14,2),
    "barcode"     TEXT,
    "originRef"   TEXT,
    "legacyId"    TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payables"
  ADD CONSTRAINT "payables_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payables_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payable_categories" (
    "id"                  TEXT NOT NULL,
    "payableId"           TEXT NOT NULL,
    "financialCategoryId" TEXT NOT NULL,
    "percentage"          DECIMAL(5,2) NOT NULL,
    "amount"              DECIMAL(14,2) NOT NULL,
    "legacyId"            TEXT,
    CONSTRAINT "payable_categories_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payable_categories"
  ADD CONSTRAINT "payable_categories_payableId_fkey"
    FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payable_categories_financialCategoryId_fkey"
    FOREIGN KEY ("financialCategoryId") REFERENCES "financial_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payable_departments" (
    "id"           TEXT NOT NULL,
    "payableId"    TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "percentage"   DECIMAL(5,2) NOT NULL,
    "amount"       DECIMAL(14,2) NOT NULL,
    "legacyId"     TEXT,
    CONSTRAINT "payable_departments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payable_departments"
  ADD CONSTRAINT "payable_departments_payableId_fkey"
    FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payable_departments_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. receivables  (S09 — reconstruído de movimentos_financeiros)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "receivables" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "customerId"          TEXT,
    "fiscalDocumentId"    TEXT,
    "financialCategoryId" TEXT,
    "description"         TEXT NOT NULL,
    "amount"              DECIMAL(14,2) NOT NULL,
    "dueDate"             TIMESTAMP(3) NOT NULL,
    "status"              "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt"              TIMESTAMP(3),
    "paidAmount"          DECIMAL(14,2),
    "legacyId"            TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivables_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "receivables_fiscalDocumentId_fkey"
    FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "receivables_financialCategoryId_fkey"
    FOREIGN KEY ("financialCategoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. payment_entries  (S09 — lançamentos de liquidação CP + CR)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "payment_entries" (
    "id"            TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "payableId"     TEXT,
    "receivableId"  TEXT,
    "bankAccountId" TEXT,
    "amount"        DECIMAL(14,2) NOT NULL,
    "paidAt"        TIMESTAMP(3) NOT NULL,
    "method"        TEXT,
    "legacyId"      TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "payment_entries"
  ADD CONSTRAINT "payment_entries_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_entries_payableId_fkey"
    FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_entries_receivableId_fkey"
    FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payment_entries_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. stock_transfers + stock_transfer_items  (S10)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "stock_transfers" (
    "id"              TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId"   TEXT NOT NULL,
    "number"          TEXT NOT NULL,
    "status"          "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "fiscalNfeKey"    TEXT,
    "notes"           TEXT,
    "shippedAt"       TIMESTAMP(3),
    "receivedAt"      TIMESTAMP(3),
    "legacyId"        TEXT,
    "createdById"     TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_companyId_number_key" ON "stock_transfers"("companyId", "number");

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_transfers_fromWarehouseId_fkey"
    FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_transfers_toWarehouseId_fkey"
    FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_transfers_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_items" (
    "id"              TEXT NOT NULL,
    "stockTransferId" TEXT NOT NULL,
    "productId"       TEXT NOT NULL,
    "quantity"        DECIMAL(14,4) NOT NULL,
    "unit"            "UnitOfMeasure" NOT NULL DEFAULT 'UN',
    "serialNumber"    TEXT,
    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_stockTransferId_fkey"
    FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_transfer_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Índices de performance para os campos mais consultados
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX "fiscal_documents_companyId_direction_idx" ON "fiscal_documents"("companyId", "direction");
CREATE INDEX "fiscal_documents_issuedAt_idx"            ON "fiscal_documents"("issuedAt");
CREATE INDEX "fiscal_documents_legacyId_idx"            ON "fiscal_documents"("legacyId");

CREATE INDEX "payables_companyId_status_idx"   ON "payables"("companyId", "status");
CREATE INDEX "payables_dueDate_idx"            ON "payables"("dueDate");
CREATE INDEX "payables_legacyId_idx"           ON "payables"("legacyId");

CREATE INDEX "receivables_companyId_status_idx" ON "receivables"("companyId", "status");
CREATE INDEX "receivables_dueDate_idx"           ON "receivables"("dueDate");
CREATE INDEX "receivables_legacyId_idx"          ON "receivables"("legacyId");

CREATE INDEX "purchase_orders_companyId_status_idx" ON "purchase_orders"("companyId", "status");
CREATE INDEX "sales_orders_companyId_status_idx"    ON "sales_orders"("companyId", "status");
CREATE INDEX "stock_movements_sourceType_sourceId_idx" ON "stock_movements"("sourceType", "sourceId");
