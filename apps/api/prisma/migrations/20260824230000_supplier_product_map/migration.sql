-- Fase 2 — Conciliação de compras: SupplierProductMap (fundação, PR-1).
-- Migration 100% ADITIVA: cria 2 enums e 2 tabelas novas; nenhum DROP,
-- nenhuma alteração em tabela existente, nenhum dado tocado.
-- Identidade canônica aprovada: (companyId, supplierId, supplier_product_code).

-- CreateEnum
CREATE TYPE "SupplierProductMapStatus" AS ENUM ('UNRESOLVED', 'SUGGESTED', 'CONFIRMED', 'REVIEW');

-- CreateEnum
CREATE TYPE "SupplierProductMapKind" AS ENUM ('PRODUCT', 'CONSUMABLE', 'ASSET', 'FREIGHT_OTHER');

-- CreateTable
CREATE TABLE "gdr_supplier_product_maps" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplier_product_code" TEXT NOT NULL,
    "status" "SupplierProductMapStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "kind" "SupplierProductMapKind",
    "productId" TEXT,
    "suggested_product_id" TEXT,
    "suggested_kind" "SupplierProductMapKind",
    "suggestion_source" TEXT,
    "last_seen_description" TEXT,
    "last_seen_ncm" TEXT,
    "last_seen_unit" TEXT,
    "last_seen_unit_price" DECIMAL(14,4),
    "last_seen_at" TIMESTAMP(3),
    "confirmed_description" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_supplier_product_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_supplier_product_map_events" (
    "id" TEXT NOT NULL,
    "map_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "SupplierProductMapStatus",
    "to_status" "SupplierProductMapStatus",
    "from_kind" "SupplierProductMapKind",
    "to_kind" "SupplierProductMapKind",
    "from_product_id" TEXT,
    "to_product_id" TEXT,
    "reason" TEXT,
    "actor_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_supplier_product_map_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_supplier_product_maps_companyId_supplierId_supplier_pro_key"
    ON "gdr_supplier_product_maps"("companyId", "supplierId", "supplier_product_code");

-- CreateIndex
CREATE INDEX "gdr_supplier_product_maps_companyId_status_idx"
    ON "gdr_supplier_product_maps"("companyId", "status");

-- CreateIndex
CREATE INDEX "gdr_supplier_product_maps_supplierId_idx"
    ON "gdr_supplier_product_maps"("supplierId");

-- CreateIndex
CREATE INDEX "gdr_supplier_product_maps_productId_idx"
    ON "gdr_supplier_product_maps"("productId");

-- CreateIndex
CREATE INDEX "gdr_supplier_product_map_events_map_id_idx"
    ON "gdr_supplier_product_map_events"("map_id");

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "gdr_supplier_product_maps_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "gdr_supplier_product_maps_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "gdr_supplier_product_maps_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "gdr_supplier_product_maps_suggested_product_id_fkey"
    FOREIGN KEY ("suggested_product_id") REFERENCES "gdr_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "gdr_supplier_product_maps_confirmed_by_id_fkey"
    FOREIGN KEY ("confirmed_by_id") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_map_events" ADD CONSTRAINT "gdr_supplier_product_map_events_map_id_fkey"
    FOREIGN KEY ("map_id") REFERENCES "gdr_supplier_product_maps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_supplier_product_map_events" ADD CONSTRAINT "gdr_supplier_product_map_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariantes de negócio no BANCO (defesa em profundidade — o serviço valida,
-- mas script/console/SQL direto também têm de esbarrar aqui):
-- 1) Product canônico só existe quando o vínculo é de mercadoria (kind=PRODUCT).
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "spm_product_only_for_kind_product"
    CHECK ("productId" IS NULL OR "kind" = 'PRODUCT');

-- 2) CONFIRMED exige classificação: sem kind não há confirmação.
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "spm_confirmed_requires_kind"
    CHECK ("status" <> 'CONFIRMED' OR "kind" IS NOT NULL);

-- 3) CONFIRMED como PRODUCT exige o Product apontado (nunca confirmação vazia).
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "spm_confirmed_product_requires_product_id"
    CHECK ("status" <> 'CONFIRMED' OR "kind" <> 'PRODUCT' OR "productId" IS NOT NULL);

-- 4) Rastro de quem confirmou acompanha a confirmação.
ALTER TABLE "gdr_supplier_product_maps" ADD CONSTRAINT "spm_confirmed_requires_confirmed_at"
    CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL);
