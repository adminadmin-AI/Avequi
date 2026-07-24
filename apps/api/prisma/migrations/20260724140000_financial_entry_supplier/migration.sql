-- #785 — Fornecedor direto no título financeiro (contas a pagar sem Pedido de Compra).
-- Aditiva: adiciona coluna opcional + índice + FK. Nenhuma coluna/linha é removida.

-- AlterTable
ALTER TABLE "gdr_financial_entries" ADD COLUMN "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "gdr_financial_entries_supplierId_idx" ON "gdr_financial_entries"("supplierId");

-- AddForeignKey
ALTER TABLE "gdr_financial_entries" ADD CONSTRAINT "gdr_financial_entries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
