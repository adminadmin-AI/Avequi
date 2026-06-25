-- Phase 7: RLS — Row Level Security (#198)
-- Enable RLS on all gdr_ tables and create tenant_isolation policy

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'gdr_%'
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Skip tables without companyId column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'companyId'
    ) THEN
      -- Drop existing policy if any
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

      -- Create tenant isolation policy
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING (
          "companyId" = current_setting(''app.current_company_id'', true)
          OR current_setting(''app.current_company_id'', true) IS NULL
          OR current_setting(''app.current_company_id'', true) = ''''
        )',
        t
      );
    END IF;
  END LOOP;
END $$;
