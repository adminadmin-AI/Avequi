-- #815 — Fundação do roteiro por item: centro de trabalho como FK e componente
-- alocado à operação.
--
-- ESTRITAMENTE ADITIVA. Nenhum DROP, nenhuma coluna removida, nenhum dado
-- apagado. O campo textual "workCenter" de gdr_routing_steps é MANTIDO: há três
-- consumidores legados (capacity, costing e as respostas de production) e a
-- regra do projeto proíbe DROP em migration. Sua remoção fica para issue futura.
--
-- Conteúdo:
--   1. gdr_routing_steps.workCenterId  -> FK opcional para gdr_work_centers
--   2. gdr_bom_items.routingStepId     -> FK opcional para gdr_routing_steps
--   3. Índices de leitura do despacho por setor
--   4. Backfill do texto -> FK, por empresa e por igualdade exata com code
--
-- INTEGRIDADE: as DUAS chaves usam ON DELETE RESTRICT. Nenhuma exclusão pode
-- desassociar dado de produção em silêncio, e a garantia não pode depender
-- apenas do guard da aplicação — script, console ou endpoint futuro que apague
-- direto no banco também tem de esbarrar na restrição. Nem CASCADE (apagaria
-- em cascata) nem SET NULL (anularia o vínculo sem avisar) são aceitáveis aqui.

-- ─── 1. Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE "gdr_routing_steps" ADD COLUMN IF NOT EXISTS "workCenterId" TEXT;
ALTER TABLE "gdr_bom_items"     ADD COLUMN IF NOT EXISTS "routingStepId" TEXT;

-- ─── 2. Índices ──────────────────────────────────────────────────────────────
-- Consulta central do despacho: "todos os passos deste centro de trabalho".
CREATE INDEX IF NOT EXISTS "gdr_routing_steps_companyId_workCenterId_idx"
  ON "gdr_routing_steps" ("companyId", "workCenterId");

-- Consulta da OC: "componentes alocados a estes passos".
CREATE INDEX IF NOT EXISTS "gdr_bom_items_routingStepId_idx"
  ON "gdr_bom_items" ("routingStepId");

-- ─── 3. Chaves estrangeiras ──────────────────────────────────────────────────
-- Guardas por catálogo para a migration ser reexecutável sem erro.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_routing_steps_workCenterId_fkey'
  ) THEN
    ALTER TABLE "gdr_routing_steps"
      ADD CONSTRAINT "gdr_routing_steps_workCenterId_fkey"
      FOREIGN KEY ("workCenterId") REFERENCES "gdr_work_centers"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_bom_items_routingStepId_fkey'
  ) THEN
    ALTER TABLE "gdr_bom_items"
      ADD CONSTRAINT "gdr_bom_items_routingStepId_fkey"
      FOREIGN KEY ("routingStepId") REFERENCES "gdr_routing_steps"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 4. Backfill ─────────────────────────────────────────────────────────────
-- Converte o texto legado para a FK APENAS quando houver correspondência exata
-- de code DENTRO DA MESMA EMPRESA. Não inventa vínculo, não altera o texto e
-- não toca em linha que já tenha workCenterId preenchido.
--
-- Resultado esperado na base de produção atual: ZERO conversões — há 0 registros
-- em gdr_work_centers e os 4 gdr_routing_steps existentes são dados de
-- demonstração do produto CAL-001 (calçado), de outra empresa. Isso está
-- documentado na issue #815 e NÃO é erro.
--
-- O backfill segue necessário para preservar dados existentes, cobrir outros
-- ambientes (dev/homologação) e converter registros válidos que venham a existir.
UPDATE "gdr_routing_steps" rs
   SET "workCenterId" = wc."id"
  FROM "gdr_work_centers" wc
 WHERE rs."workCenterId" IS NULL
   AND rs."workCenter" IS NOT NULL
   AND wc."code" = rs."workCenter"
   AND wc."companyId" = rs."companyId";
