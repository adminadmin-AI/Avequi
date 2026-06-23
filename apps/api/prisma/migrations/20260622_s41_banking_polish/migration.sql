-- S41: Banking Polish — Anti-fraude (FraudRule + FraudAlert)
-- Migration manual: aplicar via psql no pooler Supabase

-- ─── gdr_fraud_rules ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gdr_fraud_rules (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"      TEXT        NOT NULL,
  "bankAccountId"  TEXT,
  "transactionType" TEXT       NOT NULL,
  "maxAmount"      NUMERIC(14, 4) NOT NULL,
  "isActive"       BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT gdr_fraud_rules_pkey PRIMARY KEY (id),
  CONSTRAINT gdr_fraud_rules_company_fk
    FOREIGN KEY ("companyId") REFERENCES gdr_companies(id),
  CONSTRAINT gdr_fraud_rules_bank_account_fk
    FOREIGN KEY ("bankAccountId") REFERENCES gdr_bank_accounts(id),
  CONSTRAINT gdr_fraud_rules_unique
    UNIQUE ("companyId", "bankAccountId", "transactionType")
);

-- ─── gdr_fraud_alerts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gdr_fraud_alerts (
  id               TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "companyId"      TEXT        NOT NULL,
  "bankAccountId"  TEXT        NOT NULL,
  "flagType"       TEXT        NOT NULL,
  "severity"       TEXT        NOT NULL,
  "amount"         NUMERIC(14, 4) NOT NULL,
  "message"        TEXT        NOT NULL,
  "resolved"       BOOLEAN     NOT NULL DEFAULT false,
  "resolvedAt"     TIMESTAMPTZ,
  "resolvedBy"     TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT gdr_fraud_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT gdr_fraud_alerts_company_fk
    FOREIGN KEY ("companyId") REFERENCES gdr_companies(id),
  CONSTRAINT gdr_fraud_alerts_bank_account_fk
    FOREIGN KEY ("bankAccountId") REFERENCES gdr_bank_accounts(id)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS gdr_fraud_alerts_company_resolved_idx
  ON gdr_fraud_alerts ("companyId", "resolved");

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE gdr_fraud_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdr_fraud_alerts ENABLE ROW LEVEL SECURITY;

-- Prisma service account bypasses RLS via service_role key

-- ─── Register in Prisma migration history ─────────────────────────────────────
-- Run after applying:
-- INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
-- VALUES (gen_random_uuid()::text, 'manual', NOW(), '20260622_s41_banking_polish', NULL, NULL, NOW(), 1);
