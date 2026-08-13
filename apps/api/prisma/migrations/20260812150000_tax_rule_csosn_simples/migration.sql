-- #1069 (épico #1068) — suporte a Simples Nacional no motor fiscal.
-- CRT=1/2 exige o grupo ICMSSN com CSOSN; o schema só tinha icmsCst (regime normal).
-- Aditiva e idempotente: as duas colunas nascem NULL, então nenhuma regra
-- existente da GDR (CRT=3) muda de comportamento.
ALTER TABLE "gdr_tax_rules" ADD COLUMN IF NOT EXISTS "icmsCsosn" VARCHAR(3);
ALTER TABLE "gdr_tax_rules" ADD COLUMN IF NOT EXISTS "pCredSN" DECIMAL(5,2);

-- ─── Register migration ──────────────────────────────────────────────────────
-- Aplicada via `db execute` (convenção do repo enquanto #640 estiver aberto),
-- que não escreve no histórico sozinho. Sem este registro o _prisma_migrations
-- fica furado. WHERE NOT EXISTS mantém a idempotência do arquivo inteiro.
INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT gen_random_uuid()::text, 'manual', NOW(), '20260812150000_tax_rule_csosn_simples', NULL, NULL, NOW(), 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260812150000_tax_rule_csosn_simples'
);
