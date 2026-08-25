-- ============================================================================
-- Focus-A (#608) — estado do conector Focus no NfeManifest (25/08/2026)
--
-- Migration 100% ADITIVA: 7 colunas anuláveis + 1 índice em gdr_nfe_manifests.
-- Nenhum DROP, nenhum backfill, nenhum dado tocado, nenhuma outra tabela.
--
-- POR QUÊ: a Focus dá a cada NF-e recebida um `versao` único por CNPJ que sobe
-- a cada alteração (carta de correção, cancelamento, manifestação). O sync
-- incremental avança o cursor por `versao`; se uma chave já conhecida
-- reaparecer com versão maior e nada for gravado, o sinal da alteração seria
-- consumido e esquecido. Estas colunas guardam, por chave, a última versão
-- vista (focusVersion) e a última consumida pelo Focus-B
-- (focusProcessedVersion): "há novidade" = focusVersion > processed (ou null).
-- NfeManifest continua sendo detecção/manifestação/estado do conector — a
-- verdade fiscal do documento segue em gdr_fiscal_documents.
-- ============================================================================

ALTER TABLE "gdr_nfe_manifests"
  ADD COLUMN "focusVersion" INTEGER,
  ADD COLUMN "focusProcessedVersion" INTEGER,
  ADD COLUMN "focusSituacao" TEXT,
  ADD COLUMN "focusManifestacao" TEXT,
  ADD COLUMN "focusNfeCompleta" BOOLEAN,
  ADD COLUMN "focusSeenAt" TIMESTAMP(3),
  ADD COLUMN "focusChangedAt" TIMESTAMP(3);

-- Fila do Focus-B: "chaves desta company com versão nova ainda não consumida"
CREATE INDEX "gdr_nfe_manifests_companyId_focusProcessedVersion_idx"
  ON "gdr_nfe_manifests"("companyId", "focusProcessedVersion");
