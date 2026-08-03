-- Total de parcelas do plano ("Parcela 1/10" na carteira de pagáveis).
-- Aditiva; backfill vem do importador Omie (numero_parcela "001/010").
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "installment_total" INTEGER;
