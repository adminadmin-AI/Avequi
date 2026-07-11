-- IAM v2 — #347 fase 2 (347-A): infraestrutura de escopo por filial/loja.
-- Migração 100% ADITIVA (regra do projeto: nenhum DROP, nenhum ALTER destrutivo).
--
-- Warehouse.branchId (nullable): ponte operacional entre a Branch (entidade de
-- escopo organizacional, gdr_branches, fase 1 #473) e os dados do ERP core —
-- vendas/estoque/WMS/transferências já apontam para warehouseId, então ligar o
-- depósito à filial dá o recorte sem tocar nas tabelas de movimento.
-- Depósito sem branch (null) segue exatamente como hoje: fora de qualquer
-- recorte. Nenhum backfill automático: o vínculo depósito→filial é cadastro
-- consciente do admin (loja CAS → branch CAS etc.).

ALTER TABLE "gdr_warehouses" ADD COLUMN "branchId" TEXT;

ALTER TABLE "gdr_warehouses" ADD CONSTRAINT "gdr_warehouses_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "gdr_branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "gdr_warehouses_branchId_idx" ON "gdr_warehouses"("branchId");
