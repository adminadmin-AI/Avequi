-- Fix RLS: remove NULL/empty bypass from tenant_isolation policies (#216)
-- Previously, policies allowed ALL access when app.current_company_id was not set.
-- Now, queries without a tenant context are DENIED (except for service-role/superuser).

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'gdr_%'
  LOOP
    -- Only update tables that have companyId column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'companyId'
    ) THEN
      -- Drop old permissive policy
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

      -- Create strict tenant isolation policy (no NULL bypass)
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL USING (
          "companyId" = current_setting(''app.current_company_id'', true)
        )',
        t
      );
    END IF;
  END LOOP;
END $$;
