DO $$ BEGIN
  CREATE TYPE "EntrySource" AS ENUM ('AUTO_SALES', 'AUTO_PURCHASE', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "source" "EntrySource" NOT NULL DEFAULT 'AUTO_SALES';
ALTER TABLE "gdr_financial_entries" ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT;
