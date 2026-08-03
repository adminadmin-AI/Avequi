-- OPS WP3 (#910) — Metering diário por tenant (painel de contas da operadora).
--
-- ESTRITAMENTE ADITIVA: uma tabela nova. Idempotente (IF NOT EXISTS) para
-- aplicação segura via `prisma db execute` enquanto a #640 estiver aberta.

CREATE TABLE IF NOT EXISTS "gdr_tenant_usage_dailies" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "activeUsers" INTEGER NOT NULL DEFAULT 0,
  "nfeIssued" INTEGER NOT NULL DEFAULT 0,
  "nfeRejected" INTEGER NOT NULL DEFAULT 0,
  "crmLeads" INTEGER NOT NULL DEFAULT 0,
  "errors5xx" INTEGER NOT NULL DEFAULT 0,
  "storageBytes" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_tenant_usage_dailies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_tenant_usage_dailies_companyId_date_key"
  ON "gdr_tenant_usage_dailies"("companyId", "date");
CREATE INDEX IF NOT EXISTS "gdr_tenant_usage_dailies_date_idx"
  ON "gdr_tenant_usage_dailies"("date");

DO $$ BEGIN
  ALTER TABLE "gdr_tenant_usage_dailies"
    ADD CONSTRAINT "gdr_tenant_usage_dailies_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
