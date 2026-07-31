-- Workspace — post-its pessoais do widget "Notas rápidas": anotações soltas
-- que o próprio usuário cria e arranca. Uma linha por nota, privada por usuário.
--
-- ESTRITAMENTE ADITIVA. Nenhum DROP, nenhuma coluna alterada. Idempotente
-- (IF NOT EXISTS em tudo) para aplicação segura via `prisma db execute`
-- enquanto a #640 estiver aberta.
--
-- INTEGRIDADE: userId com ON DELETE CASCADE de propósito — nota é preferência
-- pessoal de UI, morre junto com o usuário (não é dado de negócio).
-- companyId com RESTRICT (padrão): empresa nunca some por baixo dos dados.

CREATE TABLE IF NOT EXISTS "gdr_user_quick_notes" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'yellow',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_user_quick_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "gdr_user_quick_notes_userId_idx"
  ON "gdr_user_quick_notes"("userId");

CREATE INDEX IF NOT EXISTS "gdr_user_quick_notes_companyId_idx"
  ON "gdr_user_quick_notes"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_user_quick_notes_userId_fkey'
  ) THEN
    ALTER TABLE "gdr_user_quick_notes"
      ADD CONSTRAINT "gdr_user_quick_notes_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "gdr_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_user_quick_notes_companyId_fkey'
  ) THEN
    ALTER TABLE "gdr_user_quick_notes"
      ADD CONSTRAINT "gdr_user_quick_notes_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
