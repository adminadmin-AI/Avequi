-- S28C: Planejamento de Capacidade

CREATE TABLE "gdr_work_centers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacityHoursPerDay" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "operatorsCount" INTEGER NOT NULL DEFAULT 1,
    "efficiencyPct" DECIMAL(5,2) NOT NULL DEFAULT 85,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_work_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_work_centers_companyId_code_key" ON "gdr_work_centers"("companyId", "code");
CREATE INDEX "gdr_work_centers_companyId_idx" ON "gdr_work_centers"("companyId");

ALTER TABLE "gdr_work_centers" ADD CONSTRAINT "gdr_work_centers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
