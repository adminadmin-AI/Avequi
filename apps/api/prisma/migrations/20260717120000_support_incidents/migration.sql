-- Épico #764 / WP1 #765 — Suporte: intake & triagem de bugs.
-- Aditiva: apenas CREATE. Zero DROP / ALTER destrutivo.

-- CreateEnum
CREATE TYPE "SupportIncidentSource" AS ENUM ('USER_REPORT', 'AUTO_ERROR');
CREATE TYPE "SupportIncidentStatus" AS ENUM ('NEW', 'TRIAGING', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportIncidentSeverity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateTable
CREATE TABLE "gdr_support_incidents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportedById" TEXT,
    "source" "SupportIncidentSource" NOT NULL DEFAULT 'USER_REPORT',
    "protocol" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "route" TEXT,
    "appVersion" TEXT,
    "requestId" TEXT,
    "stackSignature" TEXT,
    "status" "SupportIncidentStatus" NOT NULL DEFAULT 'NEW',
    "severity" "SupportIncidentSeverity",
    "diagnosis" JSONB,
    "githubIssueNumber" INTEGER,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_support_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdr_support_incident_updates" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "SupportIncidentStatus" NOT NULL,
    "clientNote" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_support_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gdr_support_incidents_protocol_key" ON "gdr_support_incidents"("protocol");

-- CreateIndex
CREATE INDEX "gdr_support_incidents_companyId_status_idx" ON "gdr_support_incidents"("companyId", "status");

-- CreateIndex
CREATE INDEX "gdr_support_incidents_stackSignature_idx" ON "gdr_support_incidents"("stackSignature");

-- CreateIndex
CREATE INDEX "gdr_support_incident_updates_incidentId_idx" ON "gdr_support_incident_updates"("incidentId");

-- AddForeignKey
ALTER TABLE "gdr_support_incidents" ADD CONSTRAINT "gdr_support_incidents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_support_incidents" ADD CONSTRAINT "gdr_support_incidents_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "gdr_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdr_support_incident_updates" ADD CONSTRAINT "gdr_support_incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "gdr_support_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
