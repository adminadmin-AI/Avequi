-- S31: BI Dashboards Customizáveis
-- Creates gdr_dashboards and gdr_dashboard_widgets tables

CREATE TYPE "WidgetType" AS ENUM (
  'KPI_CARD',
  'LINE_CHART',
  'BAR_CHART',
  'PIE_CHART',
  'TABLE',
  'GAUGE'
);

CREATE TABLE "gdr_dashboards" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "layout"      JSONB,
  "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  "isShared"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_dashboards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gdr_dashboard_widgets" (
  "id"              TEXT NOT NULL,
  "dashboardId"     TEXT NOT NULL,
  "type"            "WidgetType" NOT NULL,
  "title"           TEXT NOT NULL,
  "config"          JSONB NOT NULL,
  "position"        JSONB NOT NULL,
  "refreshInterval" INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdr_dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- FK: dashboard → company
ALTER TABLE "gdr_dashboards"
  ADD CONSTRAINT "gdr_dashboards_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK: widget → dashboard (cascade delete)
ALTER TABLE "gdr_dashboard_widgets"
  ADD CONSTRAINT "gdr_dashboard_widgets_dashboardId_fkey"
  FOREIGN KEY ("dashboardId") REFERENCES "gdr_dashboards"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "gdr_dashboards_companyId_userId_idx" ON "gdr_dashboards"("companyId", "userId");
