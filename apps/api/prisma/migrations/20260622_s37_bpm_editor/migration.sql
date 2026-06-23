-- S37: BPM Visual Editor — Workflow Templates
-- Migration: 20260622_s37_bpm_editor

CREATE TABLE IF NOT EXISTS "gdr_workflow_templates" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "entityType"  TEXT NOT NULL,
    "category"    TEXT,
    "definition"  JSONB NOT NULL,
    "isBuiltIn"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdr_workflow_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_workflow_templates_name_key"
    ON "gdr_workflow_templates"("name");
