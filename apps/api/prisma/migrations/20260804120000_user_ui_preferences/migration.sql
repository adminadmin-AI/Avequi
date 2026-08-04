-- Sidebar por usuário (#975) — favoritos e seções recolhidas seguem o login,
-- não o navegador (aditiva, idempotente)
CREATE TABLE IF NOT EXISTS "gdr_user_ui_preferences" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "gdr_companies"("id"),
  "userId" TEXT NOT NULL REFERENCES "gdr_users"("id") ON DELETE CASCADE,
  "favorites" JSONB NOT NULL DEFAULT '[]',
  "collapsedSections" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "gdr_user_ui_preferences_userId_key" ON "gdr_user_ui_preferences"("userId");
CREATE INDEX IF NOT EXISTS "gdr_user_ui_preferences_companyId_idx" ON "gdr_user_ui_preferences"("companyId");
