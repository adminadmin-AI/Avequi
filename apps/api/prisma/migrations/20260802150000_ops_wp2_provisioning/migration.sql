-- OPS WP2 (#909) — Provisionamento de tenant + convite de primeiro acesso.
--
-- ESTRITAMENTE ADITIVA: duas tabelas novas. Nenhum DROP, nenhuma coluna
-- alterada. Idempotente (IF NOT EXISTS) para aplicação segura via
-- `prisma db execute` enquanto a #640 estiver aberta.

CREATE TABLE IF NOT EXISTS "gdr_tenant_provisionings" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "steps" JSONB NOT NULL DEFAULT '{}',
  "createdById" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_tenant_provisionings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_tenant_provisionings_companyId_key"
  ON "gdr_tenant_provisionings"("companyId");

DO $$ BEGIN
  ALTER TABLE "gdr_tenant_provisionings"
    ADD CONSTRAINT "gdr_tenant_provisionings_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "gdr_tenant_invites" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gdr_tenant_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_tenant_invites_tokenHash_key"
  ON "gdr_tenant_invites"("tokenHash");
CREATE INDEX IF NOT EXISTS "gdr_tenant_invites_companyId_idx"
  ON "gdr_tenant_invites"("companyId");
CREATE INDEX IF NOT EXISTS "gdr_tenant_invites_userId_idx"
  ON "gdr_tenant_invites"("userId");

DO $$ BEGIN
  ALTER TABLE "gdr_tenant_invites"
    ADD CONSTRAINT "gdr_tenant_invites_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "gdr_tenant_invites"
    ADD CONSTRAINT "gdr_tenant_invites_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "gdr_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
