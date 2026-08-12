-- #1004 (IAM C5) — eixo da alçada de desconto: enum UserRole legado → perfil v2 (Role).
-- Aditiva: coluna nova opcional + FK; a coluna `role` NÃO é dropada (regra do
-- projeto), apenas deixa de ser NOT NULL para que linhas novas nasçam sem enum.

ALTER TABLE "gdr_discount_policies" ADD COLUMN "roleId" TEXT;
ALTER TABLE "gdr_discount_policies" ALTER COLUMN "role" DROP NOT NULL;

ALTER TABLE "gdr_discount_policies" ADD CONSTRAINT "gdr_discount_policies_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "gdr_roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "gdr_discount_policies_companyId_roleId_key"
  ON "gdr_discount_policies"("companyId", "roleId");
CREATE INDEX "gdr_discount_policies_roleId_idx" ON "gdr_discount_policies"("roleId");

-- Conversão das linhas existentes (5 em produção, contagem read-only 11/08/2026):
-- enum → perfil system espelho, o MESMO mapa do ENUM_ROLE_TO_SYSTEM_ROLE
-- (roles.catalog.ts). Idempotente: só toca linha ainda sem roleId.
UPDATE "gdr_discount_policies" dp
SET "roleId" = r."id", "updatedAt" = now()
FROM "gdr_roles" r
WHERE dp."roleId" IS NULL
  AND r."companyId" IS NULL
  AND r."isSystem" = true
  AND r."code" = CASE dp."role"
    WHEN 'SUPER_ADMIN' THEN 'ADMIN_GLOBAL'
    WHEN 'DIRECTOR'    THEN 'DIRETOR'
    WHEN 'MANAGER'     THEN 'GERENTE_GERAL'
    WHEN 'COMMERCIAL'  THEN 'VENDEDOR'
    WHEN 'PRODUCTION'  THEN 'OPERADOR_PCP'
    WHEN 'QUALITY'     THEN 'QUALIDADE'
    WHEN 'WAREHOUSE'   THEN 'ALMOXARIFE'
    WHEN 'FINANCIAL'   THEN 'FINANCEIRO'
    WHEN 'STORE'       THEN 'LOJA_OPERACIONAL'
    WHEN 'READER'      THEN 'SOMENTE_LEITURA'
  END;

-- Guarda anti no-op silencioso: se alguma linha ATIVA ficou sem roleId, o
-- ambiente não tem o catálogo IAM v2 semeado (ou tem um enum fora do mapa).
-- Prosseguir deixaria a alçada dessa linha MUDA no runtime novo (o service só
-- considera políticas com roleId) — melhor abortar e semear o IAM antes.
DO $$
DECLARE org INTEGER;
BEGIN
  SELECT COUNT(*) INTO org
  FROM "gdr_discount_policies"
  WHERE "roleId" IS NULL AND "isActive" = true AND "max_discount_pct" < 100;
  IF org > 0 THEN
    RAISE EXCEPTION '#1004: % política(s) ativa(s) sem conversão para perfil v2 — rode o seed do IAM v2 e reaplique.', org;
  END IF;
END $$;

-- Resíduo do seed do #391: 100% não é alçada, é ausência de teto escrita como
-- dado (DIRECTOR/SUPER_ADMIN). O #947 já as ignora no runtime; aqui elas são
-- DESATIVADAS (não apagadas) para a tela nova não exibi-las como vivas.
UPDATE "gdr_discount_policies"
SET "isActive" = false, "updatedAt" = now()
WHERE "max_discount_pct" >= 100 AND "isActive" = true;
