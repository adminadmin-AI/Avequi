-- Migration: S35 BPM Rule Engine + Actions
-- Created: 2026-06-22

-- Enums
CREATE TYPE "WorkflowActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED');

-- WorkflowAction
CREATE TABLE "gdr_workflow_actions" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "config" JSONB,
    "status" "WorkflowActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_workflow_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_workflow_actions_instanceId_idx" ON "gdr_workflow_actions"("instanceId");

ALTER TABLE "gdr_workflow_actions" ADD CONSTRAINT "gdr_workflow_actions_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "gdr_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EmailTemplate
CREATE TABLE "gdr_email_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "variables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_email_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_email_templates_companyId_name_key" ON "gdr_email_templates"("companyId", "name");

ALTER TABLE "gdr_email_templates" ADD CONSTRAINT "gdr_email_templates_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Notification
CREATE TABLE "gdr_notifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "entityType" TEXT,
    "entityId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_notifications_companyId_userId_read_idx" ON "gdr_notifications"("companyId", "userId", "read");

ALTER TABLE "gdr_notifications" ADD CONSTRAINT "gdr_notifications_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
