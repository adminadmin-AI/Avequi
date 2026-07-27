-- #782 — Marcadora de Chassi: 5 tabelas gdr_chassi_* (contrato da ferramenta local, colunas snake_case).
-- Aditiva: só CREATE TABLE/INDEX/FK. Nenhuma tabela/coluna existente é alterada.

-- CreateTable
CREATE TABLE "gdr_chassi_series" (
    "id" BIGSERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "eixos" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "faixa_min" INTEGER NOT NULL,
    "faixa_max" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gdr_chassi_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_chassi_quadros" (
    "id" BIGSERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "serie_id" BIGINT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gdr_chassi_quadros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_chassi_numeros" (
    "id" BIGSERIAL NOT NULL,
    "serie_id" BIGINT NOT NULL,
    "ano" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reservado',
    "reservado_por" TEXT,
    "reservado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usado_em" TIMESTAMP(3),
    "gravacao_id" BIGINT,

    CONSTRAINT "gdr_chassi_numeros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_chassi_gravacoes" (
    "id" BIGSERIAL NOT NULL,
    "vin" TEXT NOT NULL,
    "serie_id" BIGINT NOT NULL,
    "quadro_id" BIGINT,
    "tipo" TEXT NOT NULL DEFAULT 'padrao',
    "observacao" TEXT,
    "numero" INTEGER NOT NULL,
    "ano" INTEGER NOT NULL,
    "operador" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),

    CONSTRAINT "gdr_chassi_gravacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_chassi_eventos" (
    "id" BIGSERIAL NOT NULL,
    "gravacao_id" BIGINT NOT NULL,
    "evento" TEXT NOT NULL,
    "etapa" TEXT,
    "operador" TEXT,
    "detalhe" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_chassi_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_chassi_series_codigo_ano_key" ON "gdr_chassi_series"("codigo", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_chassi_series_prefixo_key" ON "gdr_chassi_series"("prefixo");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_chassi_quadros_codigo_key" ON "gdr_chassi_quadros"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_chassi_numeros_serie_id_numero_key" ON "gdr_chassi_numeros"("serie_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "gdr_chassi_gravacoes_vin_key" ON "gdr_chassi_gravacoes"("vin");

-- CreateIndex
CREATE INDEX "gdr_chassi_gravacoes_operador_idx" ON "gdr_chassi_gravacoes"("operador");

-- CreateIndex
CREATE INDEX "gdr_chassi_gravacoes_quadro_id_idx" ON "gdr_chassi_gravacoes"("quadro_id");

-- CreateIndex
CREATE INDEX "gdr_chassi_gravacoes_criado_em_idx" ON "gdr_chassi_gravacoes"("criado_em");

-- CreateIndex
CREATE INDEX "gdr_chassi_gravacoes_tipo_idx" ON "gdr_chassi_gravacoes"("tipo");

-- CreateIndex
CREATE INDEX "gdr_chassi_eventos_gravacao_id_idx" ON "gdr_chassi_eventos"("gravacao_id");

-- AddForeignKey
ALTER TABLE "gdr_chassi_quadros" ADD CONSTRAINT "gdr_chassi_quadros_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "gdr_chassi_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_chassi_numeros" ADD CONSTRAINT "gdr_chassi_numeros_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "gdr_chassi_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_chassi_numeros" ADD CONSTRAINT "gdr_chassi_numeros_gravacao_id_fkey" FOREIGN KEY ("gravacao_id") REFERENCES "gdr_chassi_gravacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_chassi_gravacoes" ADD CONSTRAINT "gdr_chassi_gravacoes_serie_id_fkey" FOREIGN KEY ("serie_id") REFERENCES "gdr_chassi_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_chassi_gravacoes" ADD CONSTRAINT "gdr_chassi_gravacoes_quadro_id_fkey" FOREIGN KEY ("quadro_id") REFERENCES "gdr_chassi_quadros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_chassi_eventos" ADD CONSTRAINT "gdr_chassi_eventos_gravacao_id_fkey" FOREIGN KEY ("gravacao_id") REFERENCES "gdr_chassi_gravacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
