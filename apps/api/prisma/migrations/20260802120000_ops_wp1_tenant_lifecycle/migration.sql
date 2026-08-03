-- OPS WP1 (#908) — Fundação do control plane: ciclo de vida do tenant.
--
-- ESTRITAMENTE ADITIVA: um tipo novo, seis colunas novas, um valor novo em
-- enum existente. Nenhum DROP, nenhuma coluna alterada. Idempotente para
-- aplicação segura via `prisma db execute` enquanto a #640 estiver aberta.
--
-- Empresas existentes (GDR matriz + filiais, CRD) ficam ACTIVE por default —
-- comportamento inalterado. A marcação do tenant de teste "POL" como SANDBOX
-- é passo operacional pós-deploy (via PATCH /ops/tenants/:id/status), não DDL.

-- Tipo TenantStatus (CREATE TYPE não tem IF NOT EXISTS — DO block idempotente)
DO $$ BEGIN
  CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CHURNED', 'SANDBOX');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "tenantStatus" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "suspendReason" TEXT;

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "isSandbox" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "gdr_companies"
  ADD COLUMN IF NOT EXISTS "onboardedAt" TIMESTAMP(3);

-- Novo motivo de falha de login: tenant suspenso/encerrado com credencial válida
ALTER TYPE "LoginFailReason" ADD VALUE IF NOT EXISTS 'TENANT_SUSPENDED';
