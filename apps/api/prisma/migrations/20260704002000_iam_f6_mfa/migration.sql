-- IAM v2 — F4.1 (#344): MFA/2FA TOTP + backup codes + enforcement por perfil.
-- Migração 100% ADITIVA (regra do projeto: nenhum DROP, nenhum ALTER destrutivo).

-- AlterEnum: novo evento de segurança (regeneração de backup codes)
ALTER TYPE "SecurityEventType" ADD VALUE 'MFA_BACKUP_CODES_REGENERATED';

-- AlterTable: enforcement de MFA por perfil (Role do #462 — ADD COLUMN com default,
-- nenhum perfil existente passa a exigir MFA automaticamente)
ALTER TABLE "gdr_roles" ADD COLUMN "requireMfa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: estado de MFA por usuário. `secret` = secret TOTP CRIPTOGRAFADO
-- (AES-256-GCM via EncryptionService); `backupCodes` = hashes bcrypt (uso único).
CREATE TABLE "gdr_user_mfa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "backupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_user_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_user_mfa_userId_key" ON "gdr_user_mfa"("userId");

-- AddForeignKey
ALTER TABLE "gdr_user_mfa" ADD CONSTRAINT "gdr_user_mfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
