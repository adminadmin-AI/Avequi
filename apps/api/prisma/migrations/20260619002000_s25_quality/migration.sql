-- S25: Gestão de Qualidade

CREATE TYPE "InspectionType" AS ENUM ('RECEIVING', 'IN_PROCESS', 'FINAL');
CREATE TYPE "InspectionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'ON_HOLD');
CREATE TYPE "NcrStatus" AS ENUM ('OPEN', 'UNDER_ANALYSIS', 'CORRECTIVE_ACTION', 'CLOSED', 'CANCELLED');
CREATE TYPE "NcrSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- Add QC_INSPECTION_FAILED to AlertType
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'QC_INSPECTION_FAILED';

CREATE TABLE "gdr_inspections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'PENDING',
    "goodsReceiptId" TEXT,
    "productionOrderId" TEXT,
    "notes" TEXT,
    "inspectedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_inspections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gdr_non_conformances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "productId" TEXT,
    "supplierId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "NcrSeverity" NOT NULL DEFAULT 'MAJOR',
    "status" "NcrStatus" NOT NULL DEFAULT 'OPEN',
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "responsibleId" TEXT,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_non_conformances_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "gdr_inspections_companyId_status_idx" ON "gdr_inspections"("companyId", "status");
CREATE INDEX "gdr_inspections_goodsReceiptId_idx" ON "gdr_inspections"("goodsReceiptId");
CREATE INDEX "gdr_inspections_productionOrderId_idx" ON "gdr_inspections"("productionOrderId");
CREATE INDEX "gdr_non_conformances_companyId_status_idx" ON "gdr_non_conformances"("companyId", "status");
CREATE INDEX "gdr_non_conformances_supplierId_idx" ON "gdr_non_conformances"("supplierId");
CREATE INDEX "gdr_non_conformances_productId_idx" ON "gdr_non_conformances"("productId");

-- FK
ALTER TABLE "gdr_inspections" ADD CONSTRAINT "gdr_inspections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_inspections" ADD CONSTRAINT "gdr_inspections_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "gdr_goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_inspections" ADD CONSTRAINT "gdr_inspections_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "gdr_production_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_inspections" ADD CONSTRAINT "gdr_inspections_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "gdr_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_productId_fkey" FOREIGN KEY ("productId") REFERENCES "gdr_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "gdr_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_non_conformances" ADD CONSTRAINT "gdr_non_conformances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
