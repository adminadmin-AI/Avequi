-- AlterTable: adicionar campos de cancelamento ao FiscalDocument (#164)
ALTER TABLE "gdr_fiscal_documents" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "gdr_fiscal_documents" ADD COLUMN "cancellationJustification" TEXT;
