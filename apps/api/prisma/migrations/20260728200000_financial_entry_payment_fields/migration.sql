-- Fase 2 do detalhe de Contas a Pagar — campos de 1ª classe do título.
-- Aditiva: 2 valores novos no enum + 5 colunas opcionais. Nada é removido.

-- AlterEnum (idempotente; fora de transação com uso no mesmo statement)
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'DEBITO_AUTOMATICO';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'OUTROS';

-- AlterTable
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "issue_date" TIMESTAMP(3);
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "document_number" TEXT;
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "payment_method" "PaymentMethod";
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "boleto_barcode" TEXT;
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "pix_copia_e_cola" TEXT;
