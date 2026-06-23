-- Migration: S34 BPM Core
-- Created: 2026-06-22

-- Enums
CREATE TYPE "WorkflowStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "WorkflowInstanceStatus" AS ENUM ('RUNNING', 'COMPLETED', 'CANCELLED', 'ERROR', 'WAITING_APPROVAL');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Workflows
CREATE TABLE "gdr_workflows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
    "triggerEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_workflows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_workflows_companyId_name_key" ON "gdr_workflows"("companyId", "name");
CREATE INDEX "gdr_workflows_companyId_entityType_idx" ON "gdr_workflows"("companyId", "entityType");

ALTER TABLE "gdr_workflows" ADD CONSTRAINT "gdr_workflows_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Workflow Versions
CREATE TABLE "gdr_workflow_versions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_workflow_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_workflow_versions_workflowId_version_key" ON "gdr_workflow_versions"("workflowId", "version");

ALTER TABLE "gdr_workflow_versions" ADD CONSTRAINT "gdr_workflow_versions_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "gdr_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Workflow Instances
CREATE TABLE "gdr_workflow_instances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "WorkflowInstanceStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "variables" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_workflow_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_workflow_instances_companyId_entityType_entityId_idx" ON "gdr_workflow_instances"("companyId", "entityType", "entityId");
CREATE INDEX "gdr_workflow_instances_status_idx" ON "gdr_workflow_instances"("status");

ALTER TABLE "gdr_workflow_instances" ADD CONSTRAINT "gdr_workflow_instances_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gdr_workflow_instances" ADD CONSTRAINT "gdr_workflow_instances_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "gdr_workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Workflow History
CREATE TABLE "gdr_workflow_history" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "fromNodeId" TEXT,
    "toNodeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_workflow_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "gdr_workflow_history" ADD CONSTRAINT "gdr_workflow_history_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "gdr_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approval Matrices
CREATE TABLE "gdr_approval_matrices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "conditionField" TEXT,
    "conditionOp" TEXT,
    "conditionValue" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "approverRoles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_approval_matrices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_approval_matrices_companyId_entityType_idx" ON "gdr_approval_matrices"("companyId", "entityType");

ALTER TABLE "gdr_approval_matrices" ADD CONSTRAINT "gdr_approval_matrices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Approval Requests
CREATE TABLE "gdr_approval_requests" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comments" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_approval_requests_instanceId_level_idx" ON "gdr_approval_requests"("instanceId", "level");

ALTER TABLE "gdr_approval_requests" ADD CONSTRAINT "gdr_approval_requests_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "gdr_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SLA Definitions
CREATE TABLE "gdr_sla_definitions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "statusFrom" TEXT NOT NULL,
    "statusTo" TEXT NOT NULL,
    "maxDurationHours" INTEGER NOT NULL,
    "escalateToRole" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_sla_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_sla_definitions_companyId_entityType_statusFrom_statusTo_key"
    ON "gdr_sla_definitions"("companyId", "entityType", "statusFrom", "statusTo");

ALTER TABLE "gdr_sla_definitions" ADD CONSTRAINT "gdr_sla_definitions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SLA Breaches
CREATE TABLE "gdr_sla_breaches" (
    "id" TEXT NOT NULL,
    "slaDefinitionId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "expectedAt" TIMESTAMP(3) NOT NULL,
    "breachedAt" TIMESTAMP(3) NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_sla_breaches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_sla_breaches_slaDefinitionId_idx" ON "gdr_sla_breaches"("slaDefinitionId");

ALTER TABLE "gdr_sla_breaches" ADD CONSTRAINT "gdr_sla_breaches_slaDefinitionId_fkey"
    FOREIGN KEY ("slaDefinitionId") REFERENCES "gdr_sla_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Register migration
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'manual', NOW(), '20260622_s34_bpm_core', NULL, NULL, NOW(), 1);
