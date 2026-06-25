-- Phase 7: Production Scheduling Engine (#200)

CREATE TABLE "gdr_production_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_production_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_production_schedules_companyId_workCenterId_idx" ON "gdr_production_schedules"("companyId", "workCenterId");
CREATE INDEX "gdr_production_schedules_productionOrderId_idx" ON "gdr_production_schedules"("productionOrderId");
ALTER TABLE "gdr_production_schedules" ADD CONSTRAINT "gdr_production_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_production_schedules" ADD CONSTRAINT "gdr_production_schedules_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "gdr_production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
