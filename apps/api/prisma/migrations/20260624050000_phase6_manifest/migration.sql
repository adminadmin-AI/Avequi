-- Phase 6: Manifestação do Destinatário (#193)

-- Enums
CREATE TYPE "ManifestStatus" AS ENUM ('PENDING', 'CIENCIA', 'CONFIRMED', 'NOT_PERFORMED', 'UNKNOWN');
CREATE TYPE "ManifestEventType" AS ENUM ('CIENCIA', 'CONFIRMACAO', 'OPERACAO_NAO_REALIZADA', 'DESCONHECIMENTO');

-- NfeManifest table
CREATE TABLE "gdr_nfe_manifests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chaveNfe" TEXT NOT NULL,
    "nfeNumber" TEXT,
    "series" TEXT,
    "supplierCnpj" TEXT NOT NULL,
    "supplierName" TEXT,
    "issueDate" TIMESTAMP(3),
    "totalValue" DECIMAL(14,4),
    "status" "ManifestStatus" NOT NULL DEFAULT 'PENDING',
    "lastEventType" "ManifestEventType",
    "lastEventDate" TIMESTAMP(3),
    "justification" TEXT,
    "protocol" TEXT,
    "inboundNfeId" TEXT,
    "manifestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_nfe_manifests_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "gdr_nfe_manifests_inboundNfeId_key" ON "gdr_nfe_manifests"("inboundNfeId");
CREATE UNIQUE INDEX "gdr_nfe_manifests_companyId_chaveNfe_key" ON "gdr_nfe_manifests"("companyId", "chaveNfe");

-- Indexes
CREATE INDEX "gdr_nfe_manifests_companyId_status_idx" ON "gdr_nfe_manifests"("companyId", "status");
CREATE INDEX "gdr_nfe_manifests_supplierCnpj_idx" ON "gdr_nfe_manifests"("supplierCnpj");

-- Foreign keys
ALTER TABLE "gdr_nfe_manifests" ADD CONSTRAINT "gdr_nfe_manifests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_nfe_manifests" ADD CONSTRAINT "gdr_nfe_manifests_inboundNfeId_fkey" FOREIGN KEY ("inboundNfeId") REFERENCES "gdr_inbound_nfe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_nfe_manifests" ADD CONSTRAINT "gdr_nfe_manifests_manifestedById_fkey" FOREIGN KEY ("manifestedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add MANIFEST_OVERDUE to AlertType enum
ALTER TYPE "AlertType" ADD VALUE 'MANIFEST_OVERDUE';
