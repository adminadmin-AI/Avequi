-- ============================================================
-- T4 — BOM de MONTAGEM dos conjuntos + Roda Montada (roda + pneu)
-- Destino: gdr_work_centers, gdr_products, gdr_routing_steps,
--          gdr_bom_versions, gdr_bom_items
-- Empresa: GDR Reboques (CNPJ 46247069000115)
-- Data: 2026-08-21
--
-- POR QUE ESTE SEED EXISTE
-- O T3 (t3_bom_migration.sql) leu conjunto_pecas (o que é SOLDADO no conjunto)
-- e modelo_composicao, mas nunca leu CP_Itens_Montagem (o que é MONTADO no
-- conjunto depois da solda/galvanização: cubo, arruela e porca M22 do eixo,
-- lanternas, tomada, rebite, plaquinha, parafuso brocante, porca rebite...).
-- Resultado: 13 peças em 46 conjuntos estavam em zero BOMs e o MRP não as
-- comprava. Este seed fecha esse buraco e acrescenta a Roda Montada.
--
-- RODA MONTADA
-- Hoje o borracheiro entrega roda + pneu já montados. A empresa vai importar
-- rodas e montar o pneu internamente, então o modelo é:
--   Roda Aro 13/14 (COM-EIX-006/007) + Pneu Aro 13/14 (COM-EIX-008/009)
--     -> Roda Montada Aro 13/14 (CON-ROD-001/002, SEMI_FINISHED)
--        montada no centro de trabalho novo SET-MON-007 "Montagem de Pneu",
--        vai solta no caminhão (etapa Carregamento da BOM do modelo),
--        um par por eixo (4 nas trucadas), sem estepe.
--   Aro 13 para modelos até 2,20 m de comprimento; aro 14 acima.
--
-- FONTE DOS DADOS
-- As tabelas de origem (CP_Itens_Montagem, Modelo_Composicao) vivem no SQL
-- Server da ferramenta producao_v2 e não existem mais copiadas no Postgres.
-- Por isso os valores vêm EMBUTIDOS abaixo, extraídos em 21/08/2026.
--
-- IDEMPOTENTE: tudo é "insere se não existir". Reexecutar num banco já
-- carregado (inclusive o de produção, onde isto já foi aplicado em 20-21/08
-- pelos scripts do repo projeto-sql-xml) não cria nada e não duplica nada.
--
-- Uso: psql "$DATABASE_URL" -f apps/api/prisma/seeds/t4_bom_montagem_roda_montada.sql
-- ============================================================

DO $$
DECLARE
  v_company_id  TEXT;
  v_wc_id       TEXT;
  v_mercado_id  TEXT;
  v_parent_id   TEXT;
  v_comp_id     TEXT;
  v_version_id  TEXT;
  v_step_id     TEXT;
  v_old_comp_id TEXT;
  v_row         RECORD;
  n_tmp INT := 0;
  n_wc INT := 0; n_prod INT := 0; n_step INT := 0; n_ver INT := 0;
  n_item INT := 0; n_skip INT := 0; n_moved INT := 0; n_renamed INT := 0;
BEGIN
  SELECT id INTO v_company_id FROM gdr_companies WHERE regexp_replace(cnpj, '\D', '', 'g') = '46247069000115';
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Empresa GDR Reboques (CNPJ 46247069000115) não encontrada';
  END IF;

  -- ─── 1. Centro de trabalho SET-MON-007 "Montagem de Pneu" ─────────────────
  -- Espelho de SET-MON-005 (Montagem de Eixo): mesmo mercado de suprimento,
  -- mesmos parâmetros de capacidade.
  SELECT id INTO v_wc_id FROM gdr_work_centers WHERE "companyId" = v_company_id AND code = 'SET-MON-007';
  IF v_wc_id IS NULL THEN
    SELECT "supplyMarketId" INTO v_mercado_id FROM gdr_work_centers WHERE "companyId" = v_company_id AND code = 'SET-MON-005';
    v_wc_id := gen_random_uuid()::TEXT;
    INSERT INTO gdr_work_centers
      (id, "companyId", code, name, description, "isActive", "updatedAt",
       "capacityHoursPerDay", "costPerHour", "efficiencyPct", "operatorsCount", kind, "supplyMarketId")
    VALUES
      (v_wc_id, v_company_id, 'SET-MON-007', 'Montagem de Pneu', 'Montagem — Producao', true, NOW(),
       8, 0, 85, 1, 'PRODUCTION', v_mercado_id);
    n_wc := n_wc + 1;
  END IF;

  -- ─── 2. Produtos ──────────────────────────────────────────────────────────
  -- COM-EIX-006/007 podem existir com o nome antigo "Roda/Pneu Aro NN"
  -- (criados em 20/08 como item único); aqui ganham o nome definitivo.
  FOR v_row IN
    SELECT * FROM (VALUES
      ('COM-EIX-006', 'Roda Aro 13',          'COMPONENT'),
      ('COM-EIX-007', 'Roda Aro 14',          'COMPONENT'),
      ('COM-EIX-008', 'Pneu Aro 13',          'COMPONENT'),
      ('COM-EIX-009', 'Pneu Aro 14',          'COMPONENT'),
      ('CON-ROD-001', 'Roda Montada Aro 13',  'SEMI_FINISHED'),
      ('CON-ROD-002', 'Roda Montada Aro 14',  'SEMI_FINISHED')
    ) AS t(sku, name, ptype)
  LOOP
    SELECT id INTO v_parent_id FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.sku;
    IF v_parent_id IS NULL THEN
      INSERT INTO gdr_products
        (id, "companyId", sku, name, type, unit, "isActive", "updatedAt", "minStock", "leadTimeDays", origem)
      VALUES
        (gen_random_uuid()::TEXT, v_company_id, v_row.sku, v_row.name, v_row.ptype::"ProductType", 'UN', true, NOW(), 0, 0, '0');
      n_prod := n_prod + 1;
    ELSE
      UPDATE gdr_products SET name = v_row.name, "updatedAt" = NOW()
      WHERE id = v_parent_id AND name <> v_row.name;
      GET DIAGNOSTICS n_tmp = ROW_COUNT;
      n_renamed := n_renamed + n_tmp;
    END IF;
  END LOOP;

  -- ─── 3. Roteiro e versão de BOM dos conjuntos Roda Montada ───────────────
  -- Conjunto só de montagem: uma etapa, "Montagem", ordem 5 (mesma convenção
  -- dos para-choques), no SET-MON-007.
  FOR v_row IN SELECT unnest(ARRAY['CON-ROD-001','CON-ROD-002']) AS sku LOOP
    SELECT id INTO v_parent_id FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.sku;

    SELECT id INTO v_step_id FROM gdr_routing_steps WHERE "productId" = v_parent_id AND name = 'Montagem';
    IF v_step_id IS NULL THEN
      INSERT INTO gdr_routing_steps
        (id, "companyId", "productId", "stepOrder", name, "setupTimeMin", "runTimeMin", "updatedAt", "workCenter", "workCenterId")
      VALUES
        (gen_random_uuid()::TEXT, v_company_id, v_parent_id, 5, 'Montagem', 0, 0, NOW(), 'SET-MON-007', v_wc_id);
      n_step := n_step + 1;
    END IF;

    SELECT id INTO v_version_id FROM gdr_bom_versions WHERE "productId" = v_parent_id AND version = 1;
    IF v_version_id IS NULL THEN
      INSERT INTO gdr_bom_versions (id, "companyId", "productId", version, "isActive", notes, "createdAt")
      VALUES (gen_random_uuid()::TEXT, v_company_id, v_parent_id, 1, true, 'Roda + pneu montados internamente', NOW());
      n_ver := n_ver + 1;
    END IF;
  END LOOP;

  -- ─── 4. BOM dos modelos: a linha antiga "Roda/Pneu" (item único de 20/08)
  --        vira a linha do conjunto CON-ROD. Só em BOMs de produto MOD-*. ──
  FOR v_row IN
    SELECT * FROM (VALUES ('COM-EIX-006', 'CON-ROD-001'), ('COM-EIX-007', 'CON-ROD-002')) AS t(old_sku, new_sku)
  LOOP
    SELECT id INTO v_old_comp_id FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.old_sku;
    SELECT id INTO v_comp_id     FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.new_sku;
    UPDATE gdr_bom_items bi SET "componentId" = v_comp_id
    FROM gdr_bom_versions v JOIN gdr_products p ON p.id = v."productId"
    WHERE v.id = bi."bomVersionId" AND p."companyId" = v_company_id AND p.sku LIKE 'MOD-%'
      AND bi."componentId" = v_old_comp_id;
    GET DIAGNOSTICS n_tmp = ROW_COUNT;
    n_moved := n_moved + n_tmp;
  END LOOP;

  -- ─── 5. Linhas de BOM (pai, componente, quantidade, etapa do roteiro) ─────
  -- 5a. CP_Itens_Montagem: peças MONTADAS em cada conjunto (etapa Montagem
  --     do próprio conjunto). Lista completa; as já existentes são puladas.
  -- 5b. Roda + pneu dentro de cada Roda Montada.
  -- 5c. Roda Montada nas BOMs dos 17 modelos (etapa Carregamento: vai solta).
  FOR v_row IN
    SELECT * FROM (VALUES
    ('CON-CHA-001', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-001', 'COM-GER-006', 22, 'Montagem'),
    ('CON-CHA-001', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-001', 'MAR-ASS-001', 1, 'Montagem'),
    ('CON-CHA-002', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-002', 'COM-GER-006', 24, 'Montagem'),
    ('CON-CHA-002', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-002', 'MAR-ASS-002', 1, 'Montagem'),
    ('CON-CHA-003', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-003', 'COM-GER-006', 24, 'Montagem'),
    ('CON-CHA-003', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-003', 'MAR-ASS-003', 1, 'Montagem'),
    ('CON-CHA-004', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-004', 'COM-GER-006', 28, 'Montagem'),
    ('CON-CHA-004', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-004', 'MAR-ASS-004', 1, 'Montagem'),
    ('CON-CHA-005', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-005', 'COM-GER-006', 26, 'Montagem'),
    ('CON-CHA-005', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-005', 'MAR-ASS-005', 1, 'Montagem'),
    ('CON-CHA-006', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-006', 'COM-GER-006', 28, 'Montagem'),
    ('CON-CHA-006', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-006', 'MAR-ASS-006', 1, 'Montagem'),
    ('CON-CHA-007', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-007', 'COM-GER-006', 28, 'Montagem'),
    ('CON-CHA-007', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-007', 'MAR-ASS-007', 1, 'Montagem'),
    ('CON-CHA-008', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-008', 'COM-GER-006', 28, 'Montagem'),
    ('CON-CHA-008', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-008', 'MAR-ASS-008', 1, 'Montagem'),
    ('CON-CHA-009', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-009', 'COM-GER-006', 28, 'Montagem'),
    ('CON-CHA-009', 'COM-PAR-005', 4, 'Montagem'),
    ('CON-CHA-009', 'MAR-ASS-009', 1, 'Montagem'),
    ('CON-CHA-010', 'COM-CHA-005', 1, 'Montagem'),
    ('CON-CHA-010', 'COM-PAR-001', 2, 'Montagem'),
    ('CON-CHA-010', 'COM-PAR-002', 1, 'Montagem'),
    ('CON-CHA-010', 'COM-PAR-003', 3, 'Montagem'),
    ('CON-CHA-010', 'COM-PAR-005', 10, 'Montagem'),
    ('CON-CHA-010', 'COM-PAR-006', 1, 'Montagem'),
    ('CON-EIX-001', 'COM-EIX-001', 2, 'Montagem'),
    ('CON-EIX-001', 'COM-EIX-002', 2, 'Montagem'),
    ('CON-EIX-001', 'COM-EIX-003', 2, 'Montagem'),
    ('CON-EIX-002', 'COM-EIX-001', 2, 'Montagem'),
    ('CON-EIX-002', 'COM-EIX-002', 2, 'Montagem'),
    ('CON-EIX-002', 'COM-EIX-003', 2, 'Montagem'),
    ('CON-EIX-003', 'COM-EIX-001', 2, 'Montagem'),
    ('CON-EIX-003', 'COM-EIX-002', 2, 'Montagem'),
    ('CON-EIX-003', 'COM-EIX-003', 2, 'Montagem'),
    ('CON-EIX-004', 'COM-EIX-001', 2, 'Montagem'),
    ('CON-EIX-004', 'COM-EIX-002', 2, 'Montagem'),
    ('CON-EIX-004', 'COM-EIX-003', 2, 'Montagem'),
    ('CON-EIX-005', 'COM-EIX-001', 2, 'Montagem'),
    ('CON-EIX-005', 'COM-EIX-002', 2, 'Montagem'),
    ('CON-EIX-005', 'COM-EIX-003', 2, 'Montagem'),
    ('CON-LAT-001', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-001', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-001', 'MAR-LAT-001', 2, 'Montagem'),
    ('CON-LAT-001', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-002', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-002', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-002', 'MAR-LAT-002', 2, 'Montagem'),
    ('CON-LAT-002', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-003', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-003', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-003', 'MAR-LAT-003', 2, 'Montagem'),
    ('CON-LAT-003', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-004', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-004', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-004', 'MAR-LAT-003', 2, 'Montagem'),
    ('CON-LAT-004', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-005', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-005', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-005', 'MAR-LAT-005', 2, 'Montagem'),
    ('CON-LAT-005', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-006', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-006', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-006', 'MAR-LAT-005', 2, 'Montagem'),
    ('CON-LAT-006', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-007', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-007', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-007', 'MAR-LAT-007', 2, 'Montagem'),
    ('CON-LAT-007', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-008', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-008', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-008', 'MAR-LAT-007', 2, 'Montagem'),
    ('CON-LAT-008', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-009', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-009', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-009', 'MAR-LAT-009', 2, 'Montagem'),
    ('CON-LAT-009', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-010', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-010', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-010', 'MAR-LAT-009', 2, 'Montagem'),
    ('CON-LAT-010', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-011', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-011', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-011', 'MAR-LAT-001', 2, 'Montagem'),
    ('CON-LAT-011', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-012', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-012', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-012', 'MAR-LAT-002', 2, 'Montagem'),
    ('CON-LAT-012', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-014', 'COM-GER-004', 2, 'Montagem'),
    ('CON-LAT-014', 'COM-GER-005', 2, 'Montagem'),
    ('CON-LAT-014', 'MAR-LAT-003', 2, 'Montagem'),
    ('CON-LAT-014', 'MET-LAT-030', 1, 'Montagem'),
    ('CON-LAT-016', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-016', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-016', 'MAR-LAT-005', 2, 'Montagem'),
    ('CON-LAT-016', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-018', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-018', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-018', 'MAR-LAT-007', 2, 'Montagem'),
    ('CON-LAT-018', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-LAT-020', 'COM-GER-004', 4, 'Montagem'),
    ('CON-LAT-020', 'COM-GER-005', 4, 'Montagem'),
    ('CON-LAT-020', 'MAR-LAT-009', 2, 'Montagem'),
    ('CON-LAT-020', 'MET-LAT-030', 2, 'Montagem'),
    ('CON-PAR-001', 'COM-PAR-001', 2, 'Montagem'),
    ('CON-PAR-001', 'COM-PAR-002', 1, 'Montagem'),
    ('CON-PAR-001', 'COM-PAR-003', 3, 'Montagem'),
    ('CON-PAR-001', 'COM-PAR-005', 6, 'Montagem'),
    ('CON-PAR-001', 'MET-PAR-001', 1, 'Montagem'),
    ('CON-PAR-002', 'COM-PAR-001', 2, 'Montagem'),
    ('CON-PAR-002', 'COM-PAR-002', 1, 'Montagem'),
    ('CON-PAR-002', 'COM-PAR-003', 3, 'Montagem'),
    ('CON-PAR-002', 'COM-PAR-005', 6, 'Montagem'),
    ('CON-PAR-002', 'MET-PAR-002', 1, 'Montagem'),
    ('CON-PAR-003', 'COM-PAR-001', 2, 'Montagem'),
    ('CON-PAR-003', 'COM-PAR-002', 1, 'Montagem'),
    ('CON-PAR-003', 'COM-PAR-003', 3, 'Montagem'),
    ('CON-PAR-003', 'COM-PAR-005', 6, 'Montagem'),
    ('CON-PAR-003', 'MET-PAR-003', 1, 'Montagem'),
    ('CON-PAR-004', 'COM-PAR-001', 2, 'Montagem'),
    ('CON-PAR-004', 'COM-PAR-002', 1, 'Montagem'),
    ('CON-PAR-004', 'COM-PAR-003', 3, 'Montagem'),
    ('CON-PAR-004', 'COM-PAR-005', 6, 'Montagem'),
    ('CON-PAR-004', 'MET-PAR-004', 1, 'Montagem'),
    ('CON-TAM-001', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-001', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-001', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-001', 'MAR-TAM-001', 1, 'Montagem'),
    ('CON-TAM-002', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-002', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-002', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-002', 'MAR-TAM-002', 1, 'Montagem'),
    ('CON-TAM-003', 'COM-GER-004', 8, 'Montagem'),
    ('CON-TAM-003', 'COM-GER-005', 8, 'Montagem'),
    ('CON-TAM-003', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-003', 'MAR-TAM-003', 1, 'Montagem'),
    ('CON-TAM-004', 'COM-GER-004', 8, 'Montagem'),
    ('CON-TAM-004', 'COM-GER-005', 8, 'Montagem'),
    ('CON-TAM-004', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-004', 'MAR-TAM-007', 1, 'Montagem'),
    ('CON-TAM-005', 'COM-GER-004', 8, 'Montagem'),
    ('CON-TAM-005', 'COM-GER-005', 8, 'Montagem'),
    ('CON-TAM-005', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-005', 'MAR-TAM-005', 1, 'Montagem'),
    ('CON-TAM-006', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-006', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-006', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-006', 'MAR-TAM-004', 1, 'Montagem'),
    ('CON-TAM-007', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-007', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-007', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-007', 'MAR-TAM-006', 1, 'Montagem'),
    ('CON-TAM-008', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-008', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-008', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-008', 'MAR-TAM-001', 1, 'Montagem'),
    ('CON-TAM-009', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-009', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-009', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-009', 'MAR-TAM-002', 1, 'Montagem'),
    ('CON-TAM-010', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-010', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-010', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-010', 'MAR-TAM-004', 1, 'Montagem'),
    ('CON-TAM-011', 'COM-GER-004', 6, 'Montagem'),
    ('CON-TAM-011', 'COM-GER-005', 6, 'Montagem'),
    ('CON-TAM-011', 'COM-TAM-001', 2, 'Montagem'),
    ('CON-TAM-011', 'MAR-TAM-006', 1, 'Montagem'),
    ('CON-ROD-001', 'COM-EIX-006', 1, 'Montagem'),
    ('CON-ROD-001', 'COM-EIX-008', 1, 'Montagem'),
    ('CON-ROD-002', 'COM-EIX-007', 1, 'Montagem'),
    ('CON-ROD-002', 'COM-EIX-009', 1, 'Montagem'),
    ('MOD-CAR-001', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-002', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-003', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-004', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-005', 'CON-ROD-002', 2, 'Carregamento'),
    ('MOD-CAR-006', 'CON-ROD-002', 4, 'Carregamento'),
    ('MOD-CAR-007', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-008', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-009', 'CON-ROD-002', 4, 'Carregamento'),
    ('MOD-CAR-010', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-011', 'CON-ROD-001', 2, 'Carregamento'),
    ('MOD-CAR-012', 'CON-ROD-002', 2, 'Carregamento'),
    ('MOD-CAR-013', 'CON-ROD-002', 2, 'Carregamento'),
    ('MOD-CAR-014', 'CON-ROD-002', 4, 'Carregamento'),
    ('MOD-CAR-015', 'CON-ROD-002', 2, 'Carregamento'),
    ('MOD-CAR-016', 'CON-ROD-002', 4, 'Carregamento'),
    ('MOD-PLT-001', 'CON-ROD-001', 2, 'Carregamento')
    ) AS t(parent_sku, comp_sku, qty, step_name)
  LOOP
    SELECT id INTO v_parent_id FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.parent_sku;
    SELECT id INTO v_comp_id   FROM gdr_products WHERE "companyId" = v_company_id AND sku = v_row.comp_sku;
    IF v_parent_id IS NULL OR v_comp_id IS NULL THEN
      RAISE EXCEPTION 'Produto não encontrado: % -> %', v_row.parent_sku, v_row.comp_sku;
    END IF;

    SELECT id INTO v_version_id FROM gdr_bom_versions WHERE "productId" = v_parent_id AND "isActive" = true LIMIT 1;
    SELECT id INTO v_step_id    FROM gdr_routing_steps WHERE "productId" = v_parent_id AND name = v_row.step_name;
    IF v_version_id IS NULL OR v_step_id IS NULL THEN
      RAISE EXCEPTION '% sem versão de BOM ativa ou sem etapa "%"', v_row.parent_sku, v_row.step_name;
    END IF;

    IF EXISTS (SELECT 1 FROM gdr_bom_items WHERE "bomVersionId" = v_version_id AND "componentId" = v_comp_id) THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    INSERT INTO gdr_bom_items (id, "bomVersionId", "componentId", quantity, "scrapPct", unit, "routingStepId")
    VALUES (gen_random_uuid()::TEXT, v_version_id, v_comp_id, v_row.qty, 0, 'UN', v_step_id);
    n_item := n_item + 1;
  END LOOP;

  RAISE NOTICE '=== T4 concluído ===';
  RAISE NOTICE 'work centers: % | produtos novos: % | renomeados: % | etapas: % | versões BOM: %', n_wc, n_prod, n_renamed, n_step, n_ver;
  RAISE NOTICE 'itens de BOM inseridos: % | já existiam (pulados): % | linhas de modelo reapontadas p/ CON-ROD: %', n_item, n_skip, n_moved;
END $$;
