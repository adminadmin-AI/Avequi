-- ============================================================
-- T3 — Migração BOM: sw_bom_conjunto + conjunto_pecas + modelo_composicao
-- Destino: gdr_bom_versions + gdr_bom_items
-- Data: 2026-06-18
-- ============================================================

DO $$
DECLARE
  v_company_id TEXT := 'aab7eea9-fca0-4681-95d2-5c326dd0acf6'; -- GDR Indústria Matriz
  v_bom_version_id TEXT;
  v_product_id TEXT;
  v_component_id TEXT;
  v_conj RECORD;
  v_item RECORD;
  v_model RECORD;
  v_model_item RECORD;
  v_bom_count INT := 0;
  v_item_count INT := 0;
  v_skip_count INT := 0;
BEGIN

  RAISE NOTICE '=== ETAPA 1: BOMs de Conjuntos (sw_bom_conjunto) ===';

  -- Itera por cada conjunto único no sw_bom_conjunto
  FOR v_conj IN
    SELECT DISTINCT
      cp.id         AS conj_id,
      cp.codigo     AS conj_codigo,
      cp.nome       AS conj_nome,
      gp.id         AS gdr_product_id
    FROM sw_bom_conjunto sbc
    JOIN conjuntos_producao cp ON cp.id = sbc.conjunto_id
    JOIN gdr_products gp ON gp."legacyId" = 'conj_' || cp.id
    ORDER BY cp.id
  LOOP
    -- Verifica se BOM já existe
    SELECT id INTO v_bom_version_id
    FROM gdr_bom_versions
    WHERE "productId" = v_conj.gdr_product_id AND version = 1;

    IF v_bom_version_id IS NOT NULL THEN
      v_skip_count := v_skip_count + 1;
      CONTINUE;
    END IF;

    -- Cria BOM Version
    v_bom_version_id := gen_random_uuid()::TEXT;
    INSERT INTO gdr_bom_versions (id, "companyId", "productId", version, "isActive", notes, "createdAt")
    VALUES (
      v_bom_version_id,
      v_company_id,
      v_conj.gdr_product_id,
      1,
      true,
      'Importado do SolidWorks — ' || v_conj.conj_codigo || ' ' || v_conj.conj_nome,
      NOW()
    );
    v_bom_count := v_bom_count + 1;

    -- Cria BOM Items da sw_bom_conjunto
    FOR v_item IN
      SELECT sbc.id AS legacy_id, sbc.codigo_sw, sbc.nome_sw, sbc.quantidade, gp.id AS gdr_comp_id
      FROM sw_bom_conjunto sbc
      JOIN gdr_products gp ON gp.sku = sbc.codigo_sw
      WHERE sbc.conjunto_id = v_conj.conj_id
    LOOP
      INSERT INTO gdr_bom_items (id, "bomVersionId", "componentId", quantity, "scrapPct", unit, source, "sourceRef", "legacyId")
      VALUES (
        gen_random_uuid()::TEXT,
        v_bom_version_id,
        v_item.gdr_comp_id,
        v_item.quantidade,
        0,
        'UN',
        'SOLIDWORKS',
        v_item.codigo_sw,
        'sw_bom_' || v_item.legacy_id
      );
      v_item_count := v_item_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Etapa 1 concluída: % BOMs criadas, % itens, % já existiam', v_bom_count, v_item_count, v_skip_count;

  RAISE NOTICE '=== ETAPA 2: BOMs de Conjuntos apenas em conjunto_pecas ===';
  v_bom_count := 0; v_item_count := 0; v_skip_count := 0;

  -- Somente conjuntos que NÃO estão em sw_bom_conjunto
  FOR v_conj IN
    SELECT DISTINCT
      cp.id         AS conj_id,
      cp.codigo     AS conj_codigo,
      cp.nome       AS conj_nome,
      gp.id         AS gdr_product_id
    FROM conjunto_pecas cpc
    JOIN conjuntos_producao cp ON cp.id = cpc.conjunto_id
    JOIN gdr_products gp ON gp."legacyId" = 'conj_' || cp.id
    WHERE cpc.conjunto_id NOT IN (SELECT DISTINCT conjunto_id FROM sw_bom_conjunto)
    ORDER BY cp.id
  LOOP
    -- Verifica se BOM já existe
    SELECT id INTO v_bom_version_id
    FROM gdr_bom_versions
    WHERE "productId" = v_conj.gdr_product_id AND version = 1;

    IF v_bom_version_id IS NOT NULL THEN
      v_skip_count := v_skip_count + 1;
      CONTINUE;
    END IF;

    v_bom_version_id := gen_random_uuid()::TEXT;
    INSERT INTO gdr_bom_versions (id, "companyId", "productId", version, "isActive", notes, "createdAt")
    VALUES (
      v_bom_version_id,
      v_company_id,
      v_conj.gdr_product_id,
      1,
      true,
      'Importado de conjunto_pecas — ' || v_conj.conj_codigo || ' ' || v_conj.conj_nome,
      NOW()
    );
    v_bom_count := v_bom_count + 1;

    -- Itens da conjunto_pecas: match por legacyId peca_N
    FOR v_item IN
      SELECT cpc.id AS legacy_id, cpc.peca_id, cpc.quantidade, gp.id AS gdr_comp_id
      FROM conjunto_pecas cpc
      JOIN gdr_products gp ON gp."legacyId" = 'peca_' || cpc.peca_id
      WHERE cpc.conjunto_id = v_conj.conj_id
    LOOP
      INSERT INTO gdr_bom_items (id, "bomVersionId", "componentId", quantity, "scrapPct", unit, source, "sourceRef", "legacyId")
      VALUES (
        gen_random_uuid()::TEXT,
        v_bom_version_id,
        v_item.gdr_comp_id,
        v_item.quantidade,
        0,
        'UN',
        'MANUAL',
        'peca_' || v_item.peca_id,
        'cp_' || v_item.legacy_id
      );
      v_item_count := v_item_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Etapa 2 concluída: % BOMs criadas, % itens, % já existiam', v_bom_count, v_item_count, v_skip_count;

  RAISE NOTICE '=== ETAPA 3: BOMs de Modelos (modelo_composicao) ===';
  v_bom_count := 0; v_item_count := 0; v_skip_count := 0;

  -- Itera por modelo único
  FOR v_model IN
    SELECT DISTINCT
      m.id         AS modelo_id,
      m.codigo     AS modelo_codigo,
      m.nome       AS modelo_nome,
      gp.id        AS gdr_product_id
    FROM modelo_composicao mc
    JOIN modelos m ON m.id = mc.modelo_id
    JOIN gdr_products gp ON gp."legacyId" = 'modelo_' || m.id
    ORDER BY m.id
  LOOP
    -- Verifica se BOM já existe
    SELECT id INTO v_bom_version_id
    FROM gdr_bom_versions
    WHERE "productId" = v_model.gdr_product_id AND version = 1;

    IF v_bom_version_id IS NOT NULL THEN
      v_skip_count := v_skip_count + 1;
      CONTINUE;
    END IF;

    v_bom_version_id := gen_random_uuid()::TEXT;
    INSERT INTO gdr_bom_versions (id, "companyId", "productId", version, "isActive", notes, "createdAt")
    VALUES (
      v_bom_version_id,
      v_company_id,
      v_model.gdr_product_id,
      1,
      true,
      'Composição do modelo — ' || v_model.modelo_codigo || ' ' || v_model.modelo_nome,
      NOW()
    );
    v_bom_count := v_bom_count + 1;

    -- Itens: Conjunto_Producao
    FOR v_model_item IN
      SELECT mc.id AS legacy_id, mc.item_id, mc.quantidade, mc.tipo_item,
             gp.id AS gdr_comp_id
      FROM modelo_composicao mc
      JOIN gdr_products gp ON (
        CASE mc.tipo_item
          WHEN 'Conjunto_Producao' THEN gp."legacyId" = 'conj_'  || mc.item_id
          WHEN 'Peca'              THEN gp."legacyId" = 'peca_'  || mc.item_id
          ELSE FALSE
        END
      )
      WHERE mc.modelo_id = v_model.modelo_id
    LOOP
      INSERT INTO gdr_bom_items (id, "bomVersionId", "componentId", quantity, "scrapPct", unit, source, "sourceRef", "legacyId")
      VALUES (
        gen_random_uuid()::TEXT,
        v_bom_version_id,
        v_model_item.gdr_comp_id,
        v_model_item.quantidade,
        0,
        'UN',
        'MODEL_COMPOSITION',
        v_model_item.tipo_item || '_' || v_model_item.item_id,
        'mc_' || v_model_item.legacy_id
      );
      v_item_count := v_item_count + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Etapa 3 concluída: % BOMs criadas, % itens, % já existiam', v_bom_count, v_item_count, v_skip_count;

  RAISE NOTICE '=== RESUMO FINAL ===';
END $$;

-- Validação final
SELECT
  (SELECT COUNT(*) FROM gdr_bom_versions)  AS total_bom_versions,
  (SELECT COUNT(*) FROM gdr_bom_items)     AS total_bom_items,
  (SELECT COUNT(*) FROM gdr_bom_versions WHERE source IS NOT NULL) AS com_source;

SELECT source, COUNT(*) as qtd FROM gdr_bom_items GROUP BY source ORDER BY source;
