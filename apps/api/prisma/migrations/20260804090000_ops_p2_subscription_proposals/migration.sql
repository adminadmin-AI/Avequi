-- AVECCHI P2 (#963) — propostas de assinatura (aditiva, idempotente)
DO $$ BEGIN
  CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "gdr_subscription_proposals" (
  "id" TEXT PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "gdr_companies"("id"),
  "planId" TEXT NOT NULL REFERENCES "gdr_plans"("id"),
  "priceCents" INTEGER NOT NULL,
  "billingDay" INTEGER NOT NULL DEFAULT 5,
  "conditions" TEXT,
  "validUntil" TIMESTAMP(3),
  "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
  "decidedAt" TIMESTAMP(3),
  "decidedNote" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "gdr_subscription_proposals_companyId_status_idx" ON "gdr_subscription_proposals"("companyId","status");
