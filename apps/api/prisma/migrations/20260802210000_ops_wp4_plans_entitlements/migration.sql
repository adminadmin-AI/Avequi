-- OPS WP4 (#911) — Planos e entitlements por tenant.
--
-- ESTRITAMENTE ADITIVA: duas tabelas novas + uma coluna nullable em
-- gdr_companies. Idempotente (IF NOT EXISTS) para `prisma db execute`
-- enquanto a #640 estiver aberta. Tenants existentes ficam com planId NULL
-- = comportamento LEGADO (tudo liberado) até o operador atribuir plano.

CREATE TABLE IF NOT EXISTS "gdr_plans" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "entitlements" JSONB NOT NULL DEFAULT '{}',
  "priceCents" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_plans_code_key" ON "gdr_plans"("code");

CREATE TABLE IF NOT EXISTS "gdr_tenant_entitlement_overrides" (
  "companyId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_tenant_entitlement_overrides_pkey" PRIMARY KEY ("companyId", "key")
);

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "planId" TEXT;

DO $$ BEGIN
  ALTER TABLE "gdr_companies"
    ADD CONSTRAINT "gdr_companies_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "gdr_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "gdr_tenant_entitlement_overrides"
    ADD CONSTRAINT "gdr_tenant_entitlement_overrides_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
