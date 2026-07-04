-- IAM v2 — F4.2 (#345): Password Policy — complexidade, histórico e rotação.
-- Migração 100% ADITIVA (regra do projeto: nenhum DROP, nenhum ALTER destrutivo).

-- AlterTable: campos de política de senha no usuário.
-- passwordChangedAt fica NULL para usuários existentes (a rotação usa
-- createdAt como base nesse caso); mustChangePassword nasce false para todos.
ALTER TABLE "gdr_users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "gdr_users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: rotação de senha OPCIONAL por perfil. NULL = sem rotação
-- (DEFAULT — NIST SP 800-63B recomenda CONTRA rotação periódica obrigatória;
-- ligar é decisão por perfil). Nenhum perfil existente passa a expirar senha.
ALTER TABLE "gdr_roles" ADD COLUMN "passwordMaxAgeDays" INTEGER;

-- CreateTable: histórico de senhas (hashes bcrypt, últimas 5 por usuário).
CREATE TABLE "gdr_password_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_password_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_password_history_userId_createdAt_idx" ON "gdr_password_history"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "gdr_password_history" ADD CONSTRAINT "gdr_password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "gdr_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
