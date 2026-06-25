-- Phase 7: LGPD — Consentimento e Anonimização (#194)

-- Enums
CREATE TYPE "ConsentPurpose" AS ENUM ('COMMERCIAL', 'OPERATIONAL', 'ANALYTICS');
CREATE TYPE "ConsentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
CREATE TYPE "AnonymizationStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'DENIED');

-- ConsentRecord
CREATE TABLE "gdr_consent_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedBy" TEXT,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "legalBasis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_consent_records_companyId_document_idx" ON "gdr_consent_records"("companyId", "document");
CREATE INDEX "gdr_consent_records_companyId_subjectType_subjectId_idx" ON "gdr_consent_records"("companyId", "subjectType", "subjectId");
ALTER TABLE "gdr_consent_records" ADD CONSTRAINT "gdr_consent_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AnonymizationRequest
CREATE TABLE "gdr_anonymization_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "subjectName" TEXT,
    "status" "AnonymizationStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "entitiesAffected" JSONB,
    "denialReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gdr_anonymization_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_anonymization_requests_companyId_document_idx" ON "gdr_anonymization_requests"("companyId", "document");
ALTER TABLE "gdr_anonymization_requests" ADD CONSTRAINT "gdr_anonymization_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_anonymization_requests" ADD CONSTRAINT "gdr_anonymization_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
