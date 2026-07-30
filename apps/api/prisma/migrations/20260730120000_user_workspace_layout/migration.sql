-- Workspace F2 (épico Workspace Inteligente por Papel) — personalização da
-- Home por usuário: UMA linha por usuário com os DESVIOS do template do
-- perfil (JSON sparse). Sem linha = template puro.
--
-- ESTRITAMENTE ADITIVA. Nenhum DROP, nenhuma coluna alterada. Idempotente
-- (IF NOT EXISTS em tudo) para aplicação segura via `prisma db execute`
-- enquanto a #640 estiver aberta.
--
-- INTEGRIDADE: userId com ON DELETE CASCADE de propósito — layout é
-- preferência de UI, morre junto com o usuário (não é dado de negócio).
-- companyId com RESTRICT (padrão): empresa nunca some por baixo dos dados.

CREATE TABLE IF NOT EXISTS "gdr_user_workspace_layouts" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profile" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "layout" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_user_workspace_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_user_workspace_layouts_userId_key"
  ON "gdr_user_workspace_layouts"("userId");

CREATE INDEX IF NOT EXISTS "gdr_user_workspace_layouts_companyId_idx"
  ON "gdr_user_workspace_layouts"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_user_workspace_layouts_userId_fkey'
  ) THEN
    ALTER TABLE "gdr_user_workspace_layouts"
      ADD CONSTRAINT "gdr_user_workspace_layouts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "gdr_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gdr_user_workspace_layouts_companyId_fkey'
  ) THEN
    ALTER TABLE "gdr_user_workspace_layouts"
      ADD CONSTRAINT "gdr_user_workspace_layouts_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
