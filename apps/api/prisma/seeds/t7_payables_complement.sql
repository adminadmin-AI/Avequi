-- ============================================================
-- T7 complemento — Rateios CP (payable_allocations) + payment_entries
-- Data: 2026-06-18
-- ============================================================

DO $$
DECLARE
  v_alloc_count   INT := 0;
  v_skip_alloc    INT := 0;
  v_pay_count     INT := 0;
  v_skip_pay      INT := 0;
  v_updated_paid  INT := 0;
  r RECORD;
BEGIN

  -- ===================================================
  -- PARTE 1: gdr_payable_allocations (rateios por centro de custo)
  -- Fonte: contas_pagar_departamentos
  -- ===================================================
  RAISE NOTICE '=== PARTE 1: payable_allocations (rateios CP por depto) ===';

  FOR r IN
    SELECT
      cpd.id                   AS legacy_id,
      cpd.codigo_lancamento_omie,
      cpd.codigo_departamento,
      cpd.percentual,
      gp.id                    AS payable_gdr_id,
      cc.id                    AS cost_center_gdr_id
    FROM contas_pagar_departamentos cpd
    JOIN gdr_payables gp ON gp."legacyId" = cpd.codigo_lancamento_omie::TEXT
    JOIN gdr_cost_centers cc ON cc."legacyId" = cpd.codigo_departamento
    WHERE cpd.percentual IS NOT NULL AND cpd.percentual > 0
  LOOP
    -- Idempotência: verifica se já existe este rateio
    IF EXISTS (
      SELECT 1 FROM gdr_payable_allocations
      WHERE "payableId" = r.payable_gdr_id AND "costCenterId" = r.cost_center_gdr_id
    ) THEN
      v_skip_alloc := v_skip_alloc + 1;
      CONTINUE;
    END IF;

    INSERT INTO gdr_payable_allocations (id, "payableId", "costCenterId", percentage)
    VALUES (
      gen_random_uuid()::TEXT,
      r.payable_gdr_id,
      r.cost_center_gdr_id,
      r.percentual
    );
    v_alloc_count := v_alloc_count + 1;
  END LOOP;

  RAISE NOTICE 'Parte 1: % alocações criadas, % já existiam', v_alloc_count, v_skip_alloc;

  -- ===================================================
  -- PARTE 2: gdr_payment_entries (baixas de pagamento)
  -- Fonte: movimentos_financeiros + contas_pagar (liquidado='S')
  -- ===================================================
  RAISE NOTICE '=== PARTE 2: payment_entries (baixas de CP) ===';

  FOR r IN
    SELECT DISTINCT ON (cp.codigo_lancamento_omie)
      cp.codigo_lancamento_omie,
      cp.valor_pago,
      COALESCE(mf.data_pagamento, cp.data_vencimento) AS data_pago,
      mf.tipo                                          AS meio_pagamento,
      gp.id                                            AS payable_gdr_id
    FROM contas_pagar cp
    JOIN gdr_payables gp ON gp."legacyId" = cp.codigo_lancamento_omie::TEXT
    LEFT JOIN movimentos_financeiros mf ON mf.codigo_titulo = cp.codigo_lancamento_omie
    WHERE cp.liquidado = 'S'
      AND cp.valor_pago IS NOT NULL
      AND cp.valor_pago > 0
      AND cp.status_titulo IN ('PAGO', 'CANCELADO')
    ORDER BY cp.codigo_lancamento_omie, mf.data_pagamento DESC
  LOOP
    -- Idempotência
    IF EXISTS (
      SELECT 1 FROM gdr_payment_entries WHERE "legacyId" = r.codigo_lancamento_omie::TEXT
    ) THEN
      v_skip_pay := v_skip_pay + 1;
      CONTINUE;
    END IF;

    INSERT INTO gdr_payment_entries (id, "payableId", amount, "paidAt", origin, "legacyId", "createdAt")
    VALUES (
      gen_random_uuid()::TEXT,
      r.payable_gdr_id,
      r.valor_pago,
      r.data_pago::TIMESTAMP,
      COALESCE(r.meio_pagamento, 'omie'),
      r.codigo_lancamento_omie::TEXT,
      NOW()
    );
    v_pay_count := v_pay_count + 1;
  END LOOP;

  RAISE NOTICE 'Parte 2: % payment_entries criadas, % já existiam', v_pay_count, v_skip_pay;

  -- ===================================================
  -- PARTE 3: Atualizar status dos gdr_payables para PAID/CANCELLED
  -- ===================================================
  RAISE NOTICE '=== PARTE 3: Atualizar status gdr_payables (PAID/CANCELLED) ===';

  UPDATE gdr_payables gp
  SET status = CASE cp.status_titulo
                 WHEN 'CANCELADO' THEN 'CANCELLED'::"PayableStatus"
                 ELSE                  'PAID'::"PayableStatus"
               END
  FROM contas_pagar cp
  WHERE cp.codigo_lancamento_omie::TEXT = gp."legacyId"
    AND cp.liquidado = 'S'
    AND gp.status = 'OPEN';

  GET DIAGNOSTICS v_updated_paid = ROW_COUNT;
  RAISE NOTICE 'Parte 3: % payables atualizados para PAID/CANCELLED', v_updated_paid;

END $$;

-- Validação final
SELECT
  (SELECT COUNT(*) FROM gdr_payable_allocations) AS total_allocations,
  (SELECT COUNT(*) FROM gdr_payment_entries)      AS total_payment_entries,
  (SELECT COUNT(*) FROM gdr_payables WHERE status = 'PAID')      AS payables_paid,
  (SELECT COUNT(*) FROM gdr_payables WHERE status = 'CANCELLED') AS payables_cancelled,
  (SELECT COUNT(*) FROM gdr_payables WHERE status = 'OPEN')      AS payables_open;
