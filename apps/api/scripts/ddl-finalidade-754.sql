-- #754 — Finalidade + vínculo a documento referenciado (F1 do épico #753)
-- Aditivo e idempotente. Aplicar com:
--   npx prisma db execute --file scripts/ddl-finalidade-754.sql --schema prisma/schema.prisma
-- (regra do repo: NUNCA `migrate deploy`/`db push` — ver lições #640/v1.9.1)

-- Enum FiscalFinalidade (finNFe B25): NORMAL=1, COMPLEMENTAR=2, AJUSTE=3,
-- DEVOLUCAO=4, NOTA_CREDITO=5, NOTA_DEBITO=6 (Ajuste SINIEF 49/2025)
DO $$ BEGIN
  CREATE TYPE "FiscalFinalidade" AS ENUM
    ('NORMAL', 'COMPLEMENTAR', 'AJUSTE', 'DEVOLUCAO', 'NOTA_CREDITO', 'NOTA_DEBITO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE gdr_fiscal_documents
  ADD COLUMN IF NOT EXISTS finalidade "FiscalFinalidade" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS referenced_document_id TEXT,
  ADD COLUMN IF NOT EXISTS tipo_nota_debito VARCHAR(2),
  ADD COLUMN IF NOT EXISTS tipo_nota_credito VARCHAR(2);

DO $$ BEGIN
  ALTER TABLE gdr_fiscal_documents
    ADD CONSTRAINT gdr_fiscal_documents_referenced_document_id_fkey
    FOREIGN KEY (referenced_document_id) REFERENCES gdr_fiscal_documents(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS gdr_fiscal_documents_referenced_document_id_idx
  ON gdr_fiscal_documents (referenced_document_id);

-- Backfill #748: devoluções 20004/20005 da CRD (emitidas manualmente 16/07)
-- passam a apontar para as originais 20002/20003 e ganham finalidade DEVOLUCAO.
UPDATE gdr_fiscal_documents d
SET referenced_document_id = o.id,
    finalidade = 'DEVOLUCAO'
FROM gdr_fiscal_documents o,
     gdr_companies c
WHERE d."companyId" = c.id
  AND o."companyId" = c.id
  AND c.cnpj = '30284708000182'          -- CRD
  AND d."type" = 'NFE' AND o."type" = 'NFE'
  AND d.series = 1 AND o.series = 1
  AND ((d."number" = 20004 AND o."number" = 20002)
    OR (d."number" = 20005 AND o."number" = 20003))
  AND d.referenced_document_id IS NULL;  -- idempotência
