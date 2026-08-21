-- ============================================================================
-- Fase 1 — Fundação para notas fiscais de ENTRADA em FiscalDocument (21/08/2026)
--
-- O QUE ESTA MIGRATION FAZ
--   1. Cria o enum FiscalDirection e as colunas novas (direction, issueDate,
--      emitente/destinatário, natureza, tpNF, supplierId, totais, nItem,
--      origem/modBC do ICMS). Tudo aditivo.
--   2. Backfill MÍNIMO para as invariantes estruturais:
--        direction  = EMITIDA  (default — nenhuma linha é reclassificada)
--        issuerCnpj = CNPJ da própria company
--   3. Torna issuerCnpj NOT NULL.
--   4. Troca a identidade de numeração: (companyId, series, number, type)
--      passa a ser (companyId, issuerCnpj, series, number, type) — única por
--      EMITENTE — e acrescenta (companyId, chave) como identidade SEFAZ.
--
-- O QUE ELA NÃO FAZ (de propósito — decisão de 21/08/2026)
--   - NÃO reclassifica as 1.268 notas de ENTRADA legadas (identificáveis por
--     itens com legacyId LIKE 'item_entrada_%'). Elas ficam EMITIDA com
--     issuerCnpj = CNPJ da company: um ESTADO TRANSITÓRIO CONHECIDO, interna-
--     mente coerente, até o importador de reidratação corrigir cada documento
--     por inteiro (companyId, direction, emitente, número, chave, datas,
--     totais) numa única passagem. Não tratar esse issuerCnpj como dado
--     fiscal verdadeiro para essas linhas.
--   - NÃO usa legacyId para nada.
--
-- NOTA SOBRE "migrations não fazem DROP"
--   O único DROP é do índice único antigo, substituído pelo novo na mesma
--   transação. Nenhuma coluna, tabela ou linha é removida.
--
-- Os nomes dos índices são os que o Prisma gera para o schema — não renomear.
-- ============================================================================

-- 1. Enum + colunas (issuerCnpj entra NULLABLE para permitir o backfill)
CREATE TYPE "FiscalDirection" AS ENUM ('EMITIDA', 'RECEBIDA');

ALTER TABLE "gdr_fiscal_documents"
  ADD COLUMN "direction"        "FiscalDirection" NOT NULL DEFAULT 'EMITIDA',
  ADD COLUMN "issueDate"        TIMESTAMP(3),
  ADD COLUMN "issuerCnpj"       VARCHAR(14),
  ADD COLUMN "issuerName"       TEXT,
  ADD COLUMN "recipientCnpj"    VARCHAR(14),
  ADD COLUMN "naturezaOperacao" TEXT,
  ADD COLUMN "tpNF"             INTEGER,
  ADD COLUMN "supplierId"       TEXT,
  ADD COLUMN "vProd"            DECIMAL(14,2),
  ADD COLUMN "vFrete"           DECIMAL(14,2),
  ADD COLUMN "vSeg"             DECIMAL(14,2),
  ADD COLUMN "vDesc"            DECIMAL(14,2),
  ADD COLUMN "vOutro"           DECIMAL(14,2),
  ADD COLUMN "vIPI"             DECIMAL(14,2),
  ADD COLUMN "vICMS"            DECIMAL(14,2),
  ADD COLUMN "vICMSUFDest"      DECIMAL(14,2),
  ADD COLUMN "vFCPUFDest"       DECIMAL(14,2),
  ADD COLUMN "vPIS"             DECIMAL(14,2),
  ADD COLUMN "vCOFINS"          DECIMAL(14,2),
  ADD COLUMN "vNF"              DECIMAL(14,2);

ALTER TABLE "gdr_fiscal_document_items"
  ADD COLUMN "nItem" INTEGER;

ALTER TABLE "gdr_fiscal_document_item_taxes"
  ADD COLUMN "origemIcms"       VARCHAR(1),
  ADD COLUMN "modalidadeBcIcms" VARCHAR(1);

-- 2. Backfill mínimo: emitente = a própria company (CNPJ só dígitos).
--    Correto para as notas de saída; provisório para as 1.268 de entrada
--    legadas (ver cabeçalho).
UPDATE "gdr_fiscal_documents" d
   SET "issuerCnpj" = regexp_replace(c."cnpj", '\D', '', 'g')
  FROM "gdr_companies" c
 WHERE c."id" = d."companyId"
   AND d."issuerCnpj" IS NULL;

-- 3. Verificação antes de endurecer: nenhuma linha pode ficar sem emitente.
DO $$
DECLARE n_null INT;
BEGIN
  SELECT COUNT(*) INTO n_null FROM "gdr_fiscal_documents" WHERE "issuerCnpj" IS NULL;
  IF n_null > 0 THEN
    RAISE EXCEPTION 'Fase 1: % documento(s) sem issuerCnpj após o backfill (company sem CNPJ?)', n_null;
  END IF;
END $$;

ALTER TABLE "gdr_fiscal_documents"
  ALTER COLUMN "issuerCnpj" SET NOT NULL;

-- 4. Identidade: substitui a numeração por company pela numeração por EMITENTE
--    e acrescenta a chave de acesso como identidade SEFAZ.
DROP INDEX "gdr_fiscal_documents_companyId_series_number_type_key";

CREATE UNIQUE INDEX "gdr_fiscal_documents_companyId_chave_key"
  ON "gdr_fiscal_documents"("companyId", "chave");

CREATE UNIQUE INDEX "gdr_fiscal_documents_companyId_issuerCnpj_series_number_typ_key"
  ON "gdr_fiscal_documents"("companyId", "issuerCnpj", "series", "number", "type");

-- 5. Índices de consulta e FK do fornecedor
CREATE INDEX "gdr_fiscal_documents_companyId_direction_issueDate_idx"
  ON "gdr_fiscal_documents"("companyId", "direction", "issueDate");

CREATE INDEX "gdr_fiscal_documents_supplierId_idx"
  ON "gdr_fiscal_documents"("supplierId");

ALTER TABLE "gdr_fiscal_documents"
  ADD CONSTRAINT "gdr_fiscal_documents_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
