-- IAM v2 — F4.3 (#346): Preparação OAuth/SSO — arquitetura extensível.
-- Migração 100% ADITIVA (regra do projeto: nenhum DROP, nenhum ALTER destrutivo).
-- NENHUM fluxo OAuth real é implementado nesta fase: as tabelas são o alicerce
-- para Google/Microsoft/SAML no futuro. Ver docs/iam/SSO-READINESS.md.

-- CreateEnum: tipos de provedor de identidade.
-- MICROSOFT cobre o Entra ID (ex-Azure AD) — não há valor AZURE_AD separado.
CREATE TYPE "IdentityProviderType" AS ENUM ('LOCAL', 'GOOGLE', 'MICROSOFT', 'SAML');

-- CreateTable: vínculo usuário <-> identidade externa (N identidades por usuário).
CREATE TABLE "gdr_user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProviderType" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable: configuração de provedor SSO por empresa (enabled nasce FALSE;
-- segredos NÃO entram no config JSON — ficam em env vars).
CREATE TABLE "gdr_auth_provider_configs" (
    "id" TEXT NOT NULL,
    "type" "IdentityProviderType" NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_auth_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_identities_provider_providerUserId_key" ON "gdr_user_identities"("provider", "providerUserId");
CREATE INDEX "gdr_user_identities_userId_idx" ON "gdr_user_identities"("userId");
CREATE UNIQUE INDEX "gdr_auth_provider_configs_companyId_type_key" ON "gdr_auth_provider_configs"("companyId", "type");
CREATE INDEX "gdr_auth_provider_configs_companyId_idx" ON "gdr_auth_provider_configs"("companyId");

-- AddForeignKey
ALTER TABLE "gdr_user_identities" ADD CONSTRAINT "gdr_user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gdr_auth_provider_configs" ADD CONSTRAINT "gdr_auth_provider_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
