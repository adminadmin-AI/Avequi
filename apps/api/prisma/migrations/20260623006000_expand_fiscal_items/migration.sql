-- AlterTable: expandir FiscalDocumentItem (#166)
ALTER TABLE "gdr_fiscal_document_items" ADD COLUMN "productId" TEXT;
ALTER TABLE "gdr_fiscal_document_items" ADD COLUMN "cest" TEXT;

-- AlterTable: adicionar COFINS ao FiscalDocumentItemTax (#166)
ALTER TABLE "gdr_fiscal_document_item_taxes" ADD COLUMN "cstCofins" TEXT;
ALTER TABLE "gdr_fiscal_document_item_taxes" ADD COLUMN "baseCofins" DECIMAL(14,4);
ALTER TABLE "gdr_fiscal_document_item_taxes" ADD COLUMN "aliquotaCofins" DECIMAL(14,4);
ALTER TABLE "gdr_fiscal_document_item_taxes" ADD COLUMN "valorCofins" DECIMAL(14,4);
