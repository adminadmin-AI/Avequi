-- S33 BI Polish — Semantic Layer, Report Scheduling, Query Audit
-- Migration: 20260622_s33_bi_polish

-- ─── Metric Definitions ──────────────────────────────────────────────────────

CREATE TABLE "gdr_metric_definitions" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT,
  "name"        TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "dataSource"  TEXT NOT NULL,
  "expression"  TEXT NOT NULL,
  "unit"        TEXT,
  "format"      TEXT,
  "isBuiltIn"   BOOLEAN NOT NULL DEFAULT false,
  "category"    TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_metric_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_metric_definitions_companyId_name_key"
  ON "gdr_metric_definitions"("companyId", "name");

ALTER TABLE "gdr_metric_definitions"
  ADD CONSTRAINT "gdr_metric_definitions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Dimension Definitions ───────────────────────────────────────────────────

CREATE TABLE "gdr_dimension_definitions" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT,
  "name"        TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT,
  "dataSource"  TEXT NOT NULL,
  "field"       TEXT NOT NULL,
  "hierarchy"   TEXT,
  "isBuiltIn"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_dimension_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdr_dimension_definitions_companyId_name_key"
  ON "gdr_dimension_definitions"("companyId", "name");

ALTER TABLE "gdr_dimension_definitions"
  ADD CONSTRAINT "gdr_dimension_definitions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Report Schedules ────────────────────────────────────────────────────────

CREATE TABLE "gdr_report_schedules" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "dashboardId" TEXT,
  "format"      TEXT NOT NULL DEFAULT 'PDF',
  "cronExpr"    TEXT NOT NULL,
  "recipients"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"   TIMESTAMP(3),
  "nextRunAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_report_schedules_companyId_isActive_idx"
  ON "gdr_report_schedules"("companyId", "isActive");

ALTER TABLE "gdr_report_schedules"
  ADD CONSTRAINT "gdr_report_schedules_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Report Runs ─────────────────────────────────────────────────────────────

CREATE TABLE "gdr_report_runs" (
  "id"          TEXT NOT NULL,
  "scheduleId"  TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'PENDING',
  "format"      TEXT NOT NULL,
  "fileSize"    INTEGER,
  "error"       TEXT,
  "startedAt"   TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_report_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_report_runs_scheduleId_idx"
  ON "gdr_report_runs"("scheduleId");

ALTER TABLE "gdr_report_runs"
  ADD CONSTRAINT "gdr_report_runs_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "gdr_report_schedules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Analytics Query Logs ────────────────────────────────────────────────────

CREATE TABLE "gdr_analytics_query_logs" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "params"    JSONB,
  "duration"  INTEGER NOT NULL,
  "cached"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_analytics_query_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gdr_analytics_query_logs_companyId_createdAt_idx"
  ON "gdr_analytics_query_logs"("companyId", "createdAt");

ALTER TABLE "gdr_analytics_query_logs"
  ADD CONSTRAINT "gdr_analytics_query_logs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Register migration ──────────────────────────────────────────────────────

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES (
  gen_random_uuid()::text,
  'manual',
  NOW(),
  '20260622_s33_bi_polish',
  NULL,
  NULL,
  NOW(),
  1
);
