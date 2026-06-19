-- S24: Automações e Alertas
-- Adiciona minStock ao produto e cria tabela de alertas

-- minStock por produto (threshold para alerta de estoque mínimo)
ALTER TABLE "gdr_products" ADD COLUMN IF NOT EXISTS "minStock" DECIMAL(14,4) NOT NULL DEFAULT 0;

-- Enums de alertas
DO $$ BEGIN
  CREATE TYPE "AlertType" AS ENUM (
    'STOCK_MIN',
    'PAYABLE_DUE',
    'PRODUCTION_LATE',
    'NFE_REJECTED',
    'MRP_RUN_DONE',
    'FOCUS_NFE_DOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabela de alertas
CREATE TABLE IF NOT EXISTS "gdr_alerts" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"   TEXT        NOT NULL,
  "type"        "AlertType" NOT NULL,
  "severity"    "AlertSeverity" NOT NULL DEFAULT 'WARNING',
  "title"       TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "entityId"    TEXT,
  "entityType"  TEXT,
  "resolvedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_alerts_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "gdr_alerts_companyId_resolvedAt_idx"
  ON "gdr_alerts"("companyId", "resolvedAt");

CREATE INDEX IF NOT EXISTS "gdr_alerts_type_idx"
  ON "gdr_alerts"("type");
