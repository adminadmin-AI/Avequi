-- CreateTable: FiscalCorrection (CC-e)
CREATE TABLE "gdr_fiscal_corrections" (
    "id" TEXT NOT NULL,
    "fiscalDocumentId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "correctionText" TEXT NOT NULL,
    "protocol" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_fiscal_corrections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gdr_fiscal_corrections_fiscalDocumentId_sequenceNumber_key" ON "gdr_fiscal_corrections"("fiscalDocumentId", "sequenceNumber");
CREATE INDEX "gdr_fiscal_corrections_fiscalDocumentId_idx" ON "gdr_fiscal_corrections"("fiscalDocumentId");
ALTER TABLE "gdr_fiscal_corrections" ADD CONSTRAINT "gdr_fiscal_corrections_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "gdr_fiscal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: FiscalVoidRange (Inutilização)
CREATE TABLE "gdr_fiscal_void_ranges" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "numberStart" INTEGER NOT NULL,
    "numberEnd" INTEGER NOT NULL,
    "justification" TEXT NOT NULL,
    "protocol" TEXT,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gdr_fiscal_void_ranges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gdr_fiscal_void_ranges_companyId_idx" ON "gdr_fiscal_void_ranges"("companyId");
ALTER TABLE "gdr_fiscal_void_ranges" ADD CONSTRAINT "gdr_fiscal_void_ranges_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
