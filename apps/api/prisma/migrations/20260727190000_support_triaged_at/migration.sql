-- Épico #764 / WP4 #768 — Suporte: triagem repo-aware por LLM.
-- Aditiva: apenas ADD COLUMN nullable. Zero DROP / ALTER destrutivo.
-- `diagnosis` (JSONB) já existe desde a migration de WP1; aqui só falta o
-- carimbo de quando o runner gravou o diagnóstico. Ambos são INTERNOS
-- (fora do select cliente-facing do listMine).

-- AlterTable
ALTER TABLE "gdr_support_incidents" ADD COLUMN "triagedAt" TIMESTAMP(3);
