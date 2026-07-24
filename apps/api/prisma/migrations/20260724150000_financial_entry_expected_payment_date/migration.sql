-- #788 — Previsão de pagamento no título financeiro (data de planejamento,
-- distinta do vencimento; equivalente ao `data_previsao` do Omie).
-- Aditiva: só adiciona coluna opcional. Nenhuma coluna/linha é removida.

-- AlterTable
ALTER TABLE "gdr_financial_entries" ADD COLUMN "expected_payment_date" TIMESTAMP(3);
