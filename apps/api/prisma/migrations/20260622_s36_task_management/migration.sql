-- S36: BPM Task Management + SLA Tracker
-- Migration: 20260622_s36_task_management

-- CreateEnum
CREATE TYPE "TaskAssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- CreateTable
CREATE TABLE "gdr_task_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "TaskAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gdr_task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gdr_task_assignments_companyId_userId_status_idx" ON "gdr_task_assignments"("companyId", "userId", "status");

-- CreateIndex
CREATE INDEX "gdr_task_assignments_companyId_role_status_idx" ON "gdr_task_assignments"("companyId", "role", "status");

-- CreateIndex
CREATE INDEX "gdr_task_assignments_dueDate_idx" ON "gdr_task_assignments"("dueDate");

-- AddForeignKey
ALTER TABLE "gdr_task_assignments" ADD CONSTRAINT "gdr_task_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable RLS
ALTER TABLE "gdr_task_assignments" ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant isolation
CREATE POLICY "tenant_isolation" ON "gdr_task_assignments"
  USING ("companyId" = current_setting('app.company_id', true));
