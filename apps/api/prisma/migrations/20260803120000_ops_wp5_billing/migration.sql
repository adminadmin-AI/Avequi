-- OPS WP5 (#912) — Billing da operadora F1: assinaturas + faturas + régua.
--
-- ESTRITAMENTE ADITIVA: um tipo e duas tabelas novas. Idempotente
-- (IF NOT EXISTS) para `prisma db execute` enquanto a #640 estiver aberta.

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "gdr_subscriptions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "planId" TEXT,
  "priceCents" INTEGER NOT NULL,
  "billingDay" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "canceledAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_subscriptions_companyId_key"
  ON "gdr_subscriptions"("companyId");

DO $$ BEGIN
  ALTER TABLE "gdr_subscriptions"
    ADD CONSTRAINT "gdr_subscriptions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "gdr_invoices" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "period" DATE NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "paidAt" TIMESTAMP(3),
  "method" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gdr_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gdr_invoices_companyId_period_key"
  ON "gdr_invoices"("companyId", "period");
CREATE INDEX IF NOT EXISTS "gdr_invoices_status_dueDate_idx"
  ON "gdr_invoices"("status", "dueDate");

DO $$ BEGIN
  ALTER TABLE "gdr_invoices"
    ADD CONSTRAINT "gdr_invoices_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "gdr_companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
