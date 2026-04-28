-- S09: Financeiro básico — contas a pagar e receber

CREATE TYPE "FinancialEntryType" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "FinancialEntryStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

CREATE TABLE "financial_entries" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "type"            "FinancialEntryType" NOT NULL,
  "status"          "FinancialEntryStatus" NOT NULL DEFAULT 'OPEN',
  "amount"          DECIMAL(14,4) NOT NULL,
  "dueDate"         TIMESTAMP(3) NOT NULL,
  "description"     TEXT,
  "salesOrderId"    TEXT,
  "purchaseOrderId" TEXT,
  "goodsReceiptId"  TEXT,
  "fiscalDocumentId" TEXT,
  "paidAt"          TIMESTAMP(3),
  "paidAmount"      DECIMAL(14,4),
  "paymentNote"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "financial_entries_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "financial_entries_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "financial_entries_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "financial_entries_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "financial_entries_companyId_idx" ON "financial_entries"("companyId");
CREATE INDEX "financial_entries_type_status_idx" ON "financial_entries"("type", "status");
CREATE INDEX "financial_entries_dueDate_idx" ON "financial_entries"("dueDate");
CREATE UNIQUE INDEX "financial_entries_salesOrderId_key" ON "financial_entries"("salesOrderId") WHERE "salesOrderId" IS NOT NULL;
CREATE UNIQUE INDEX "financial_entries_goodsReceiptId_key" ON "financial_entries"("goodsReceiptId") WHERE "goodsReceiptId" IS NOT NULL;
