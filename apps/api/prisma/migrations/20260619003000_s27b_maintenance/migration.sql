-- S27B: Manutenção de Equipamentos

CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'SCRAPPED');
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE', 'CALIBRATION', 'INSPECTION');
CREATE TYPE "MaintenanceOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'MAINTENANCE_DUE';

CREATE TABLE "gdr_equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquisitionDate" TIMESTAMP(3),
    "nextMaintenanceAt" TIMESTAMP(3),
    "maintenanceIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gdr_maintenance_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL DEFAULT 'PREVENTIVE',
    "status" "MaintenanceOrderStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "technicianId" TEXT,
    "resolution" TEXT,
    "cost" DECIMAL(14,4),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_maintenance_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_equipment_companyId_code_key" ON "gdr_equipment"("companyId", "code");
CREATE INDEX "gdr_equipment_companyId_status_idx" ON "gdr_equipment"("companyId", "status");
CREATE INDEX "gdr_maintenance_orders_companyId_status_idx" ON "gdr_maintenance_orders"("companyId", "status");
CREATE INDEX "gdr_maintenance_orders_equipmentId_idx" ON "gdr_maintenance_orders"("equipmentId");

ALTER TABLE "gdr_equipment" ADD CONSTRAINT "gdr_equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_maintenance_orders" ADD CONSTRAINT "gdr_maintenance_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_maintenance_orders" ADD CONSTRAINT "gdr_maintenance_orders_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "gdr_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_maintenance_orders" ADD CONSTRAINT "gdr_maintenance_orders_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gdr_maintenance_orders" ADD CONSTRAINT "gdr_maintenance_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
