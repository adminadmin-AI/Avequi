-- CreateEnum
CREATE TYPE "RenaveOperationType" AS ENUM ('BIN_REGISTER', 'STOCK_IN', 'SALE_OUT', 'ATPVE_PDF', 'CANCEL_SALE_OUT', 'RETURN_MANUFACTURER');

-- CreateEnum
CREATE TYPE "RenaveOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'REGISTERED', 'STOCK_CONFIRMED', 'SALE_INTENT_CREATED', 'ACTIVE', 'ERROR', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'RENAVE_OP_FAILED';
ALTER TYPE "AlertType" ADD VALUE 'BIN_REGISTER_FAILED';

-- AlterTable
ALTER TABLE "gdr_atpve_records" ADD COLUMN     "atpve_pdf_url" TEXT;

-- CreateTable
CREATE TABLE "gdr_renave_operations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "serial_number_id" TEXT NOT NULL,
    "sales_order_id" TEXT,
    "fiscal_document_id" TEXT,
    "fiscal_document_chave" TEXT,
    "type" "RenaveOperationType" NOT NULL,
    "status" "RenaveOperationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupe_key" TEXT NOT NULL,
    "request_id" TEXT,
    "protocol" TEXT,
    "raw_response" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_renave_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_renave_operations_dedupe_key_key" ON "gdr_renave_operations"("dedupe_key");

-- CreateIndex
CREATE INDEX "gdr_renave_operations_company_id_status_idx" ON "gdr_renave_operations"("company_id", "status");

-- CreateIndex
CREATE INDEX "gdr_renave_operations_serial_number_id_type_idx" ON "gdr_renave_operations"("serial_number_id", "type");

-- CreateIndex
CREATE INDEX "gdr_renave_operations_sales_order_id_idx" ON "gdr_renave_operations"("sales_order_id");

-- CreateIndex
CREATE INDEX "gdr_renave_operations_fiscal_document_id_idx" ON "gdr_renave_operations"("fiscal_document_id");

-- AddForeignKey
ALTER TABLE "gdr_renave_operations" ADD CONSTRAINT "gdr_renave_operations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_renave_operations" ADD CONSTRAINT "gdr_renave_operations_serial_number_id_fkey" FOREIGN KEY ("serial_number_id") REFERENCES "gdr_serial_number"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_renave_operations" ADD CONSTRAINT "gdr_renave_operations_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "gdr_sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_renave_operations" ADD CONSTRAINT "gdr_renave_operations_fiscal_document_id_fkey" FOREIGN KEY ("fiscal_document_id") REFERENCES "gdr_fiscal_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

