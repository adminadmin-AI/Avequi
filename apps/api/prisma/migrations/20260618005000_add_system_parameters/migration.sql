CREATE TABLE "gdr_system_parameters" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_system_parameters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_system_parameters_companyId_key_key" ON "gdr_system_parameters"("companyId", "key");

ALTER TABLE "gdr_system_parameters" ADD CONSTRAINT "gdr_system_parameters_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
