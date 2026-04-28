-- S08: Integração fiscal com Focus NFe

-- CreateEnum
CREATE TYPE "FiscalDocumentType" AS ENUM ('NFE', 'NFCE');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'ERROR');

-- CreateTable
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
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

    CONSTRAINT "fiscal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_documents_salesOrderId_key" ON "fiscal_documents"("salesOrderId");

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
