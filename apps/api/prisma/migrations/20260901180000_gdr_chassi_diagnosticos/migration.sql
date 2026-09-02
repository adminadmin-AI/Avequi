-- Marcadora de Chassi (#1139) — diagnósticos das gravações na nuvem.
-- Migration 100% ADITIVA: 1 tabela nova + 3 índices; nenhum DROP, nenhuma
-- alteração em tabela existente, nenhum dado tocado.
-- Contrato EXTERNO: a ferramenta (psycopg2) escreve direto nesta tabela —
-- colunas em snake_case como as demais gdr_chassi_* (#782). `vin` SEM FK de
-- propósito: o diagnóstico pode ser de gravação cancelada antes de existir.
-- GRANTs do role chassi_tool ficam FORA da migration (o role só existe em
-- produção): SELECT/INSERT/UPDATE na tabela + SELECT/USAGE na sequence,
-- aplicados junto com o db execute em prod (mesmo procedimento do #782).

-- CreateTable
CREATE TABLE "gdr_chassi_diagnosticos" (
    "id" BIGSERIAL NOT NULL,
    "vin" TEXT NOT NULL,
    "etapa" TEXT,
    "estado" TEXT NOT NULL,
    "duracao_s" DOUBLE PRECISION,
    "estacao" TEXT,
    "versao" TEXT,
    "resumo" JSONB NOT NULL,
    "arquivo" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_chassi_diagnosticos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_chassi_diagnosticos_vin_idx" ON "gdr_chassi_diagnosticos"("vin");

-- CreateIndex
CREATE INDEX "gdr_chassi_diagnosticos_estado_idx" ON "gdr_chassi_diagnosticos"("estado");

-- CreateIndex
CREATE INDEX "gdr_chassi_diagnosticos_criado_em_idx" ON "gdr_chassi_diagnosticos"("criado_em");
