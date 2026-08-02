-- Mural de notas (brief "Workspace Vivo" pt.8): as notas passam a ter ORDEM,
-- podem ser FIXADAS no topo e ARQUIVADAS em vez de excluídas.
--
-- ESTRITAMENTE ADITIVA: três colunas novas e um índice. Nenhum DROP, nenhuma
-- coluna alterada. Idempotente (IF NOT EXISTS) para aplicação segura via
-- `prisma db execute` enquanto a #640 estiver aberta.
--
-- Notas já existentes ficam com position = 0 e as duas datas nulas: mural
-- inalterado (a ordenação desempata por createdAt desc, como sempre foi) e
-- nada aparece arquivado.

ALTER TABLE "gdr_user_quick_notes"
  ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "gdr_user_quick_notes"
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);

ALTER TABLE "gdr_user_quick_notes"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- O mural lê sempre "minhas notas não arquivadas": índice composto cobre.
CREATE INDEX IF NOT EXISTS "gdr_user_quick_notes_userId_archivedAt_idx"
  ON "gdr_user_quick_notes"("userId", "archivedAt");
