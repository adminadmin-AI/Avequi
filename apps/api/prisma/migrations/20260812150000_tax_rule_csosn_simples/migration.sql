-- #1069 (épico #1068) — suporte a Simples Nacional no motor fiscal.
-- CRT=1/2 exige o grupo ICMSSN com CSOSN; o schema só tinha icmsCst (regime normal).
-- Aditiva e idempotente: as duas colunas nascem NULL, então nenhuma regra
-- existente da GDR (CRT=3) muda de comportamento.
ALTER TABLE "gdr_tax_rules" ADD COLUMN IF NOT EXISTS "icmsCsosn" VARCHAR(3);
ALTER TABLE "gdr_tax_rules" ADD COLUMN IF NOT EXISTS "pCredSN" DECIMAL(5,2);
