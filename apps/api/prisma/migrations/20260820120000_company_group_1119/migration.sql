-- #1119 — Grupo econômico (GDR ↔ CRD): tabela do grupo + vínculo na empresa.
--
-- O laço entre tenants-raiz administrados pelas mesmas pessoas. Não mistura
-- dado nenhum: habilita o vínculo cruzado de usuários e a troca de empresa
-- ativa na sessão. Só a operadora declara (portal /ops).
--
-- ESTRITAMENTE ADITIVA. Nenhum DROP, nenhuma coluna alterada. Idempotente
-- (IF NOT EXISTS em tudo) para aplicação segura via `prisma db execute`
-- enquanto a #640 estiver aberta:
--   npx prisma db execute \
--     --file prisma/migrations/20260820120000_company_group_1119/migration.sql \
--     --schema prisma/schema.prisma
-- (regra do repo: NUNCA `migrate deploy`/`db push` — ver lições #640/v1.9.1)
--
-- Conferido contra `prisma migrate diff` do delta desta branch: mesma coluna,
-- mesma tabela, mesmo índice, mesma FK (ON DELETE SET NULL / ON UPDATE CASCADE).

-- Grupo econômico: o laço entre tenants-raiz administrados pelas mesmas
-- pessoas. Só a operadora declara (portal /ops).
CREATE TABLE IF NOT EXISTS "gdr_company_groups" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_company_groups_pkey" PRIMARY KEY ("id")
);

-- Vínculo na empresa. Nullable: quem não tem grupo (a esmagadora maioria)
-- fica em NULL e nada muda.
ALTER TABLE "gdr_companies" ADD COLUMN IF NOT EXISTS "group_id" TEXT;

CREATE INDEX IF NOT EXISTS "gdr_companies_group_id_idx"
  ON "gdr_companies"("group_id");

-- FK com ON DELETE RESTRICT (default do Prisma para relação opcional é
-- SET NULL; aqui o Prisma gera SET NULL — mantido igual ao schema).
DO $$ BEGIN
  ALTER TABLE "gdr_companies"
    ADD CONSTRAINT "gdr_companies_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "gdr_company_groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
