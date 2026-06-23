-- S32: BI Intelligence — Alert Rules & Triggers

CREATE TYPE "AlertRuleOperator" AS ENUM ('GT', 'GTE', 'LT', 'LTE', 'ANOMALY');

CREATE TABLE "gdr_alert_rules" (
  "id"          TEXT         NOT NULL,
  "companyId"   TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "metric"      TEXT         NOT NULL,
  "dataSource"  TEXT         NOT NULL,
  "operator"    "AlertRuleOperator" NOT NULL,
  "threshold"   DECIMAL(14,4),
  "windowDays"  INTEGER      NOT NULL DEFAULT 30,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "notifyRoles" TEXT[]       NOT NULL DEFAULT '{}',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_alert_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_alert_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "gdr_alert_rules_companyId_isActive_idx" ON "gdr_alert_rules"("companyId", "isActive");

CREATE TABLE "gdr_alert_triggers" (
  "id"             TEXT         NOT NULL,
  "alertRuleId"    TEXT         NOT NULL,
  "companyId"      TEXT         NOT NULL,
  "value"          DECIMAL(14,4) NOT NULL,
  "threshold"      DECIMAL(14,4),
  "message"        TEXT         NOT NULL,
  "acknowledged"   BOOLEAN      NOT NULL DEFAULT false,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gdr_alert_triggers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gdr_alert_triggers_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "gdr_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gdr_alert_triggers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "gdr_alert_triggers_alertRuleId_idx" ON "gdr_alert_triggers"("alertRuleId");
CREATE INDEX "gdr_alert_triggers_companyId_idx" ON "gdr_alert_triggers"("companyId");
