-- AVECCHI P1 (#960) — ponte billing→financeiro (aditiva, idempotente)
ALTER TABLE "gdr_invoices" ADD COLUMN IF NOT EXISTS "financial_entry_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "gdr_invoices_financial_entry_id_key" ON "gdr_invoices"("financial_entry_id");
DO $$ BEGIN
  ALTER TABLE "gdr_invoices" ADD CONSTRAINT "gdr_invoices_financial_entry_id_fkey"
    FOREIGN KEY ("financial_entry_id") REFERENCES "gdr_financial_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
