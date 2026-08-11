-- #1058 passo 1 — classificacao dos centros de trabalho + mercado padrao de suprimento.
-- Aditiva: enum novo, coluna kind com default, FK opcional auto-relacionada.
CREATE TYPE "WorkCenterKind" AS ENUM ('PRODUCTION', 'MARKET', 'SUPPORT');

ALTER TABLE "gdr_work_centers" ADD COLUMN "kind" "WorkCenterKind" NOT NULL DEFAULT 'PRODUCTION';
ALTER TABLE "gdr_work_centers" ADD COLUMN "supplyMarketId" TEXT;

ALTER TABLE "gdr_work_centers" ADD CONSTRAINT "gdr_work_centers_supplyMarketId_fkey"
  FOREIGN KEY ("supplyMarketId") REFERENCES "gdr_work_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "gdr_work_centers_supplyMarketId_idx" ON "gdr_work_centers"("supplyMarketId");
