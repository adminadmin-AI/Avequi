-- T10 v2 — corrigido: usa serial_number, legacy_id corretos
DO $$
DECLARE
  v_gdr_cascavel_id     TEXT := '1a81b804-eff3-44e7-bf9e-7d8b17c5cb23';
  v_gdr_guarapuava_id   TEXT := '5fbe7ed4-ac97-44a1-92a9-23c9554c6e35';
  v_gdr_matriz_id       TEXT := 'aab7eea9-fca0-4681-95d2-5c326dd0acf6';
  v_wh_loja_cas_id  TEXT;
  v_wh_loja_gua_id  TEXT;
  v_wh_fabrica_id   TEXT;
  v_order_count INT := 0;
  v_item_count  INT := 0;
  v_serial_count INT := 0;
BEGIN
  -- Etapa 0: Warehouses
  INSERT INTO gdr_warehouses (id, "companyId", name, code, description, "isActive", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::TEXT, v_gdr_matriz_id,      'Almoxarifado Fábrica', 'ALM-FAB',  'Estoque principal da fábrica', true, NOW(), NOW()),
    (gen_random_uuid()::TEXT, v_gdr_cascavel_id,    'Loja Cascavel',        'LOJA-CAS', 'Estoque da loja Cascavel',     true, NOW(), NOW()),
    (gen_random_uuid()::TEXT, v_gdr_guarapuava_id,  'Loja Guarapuava',      'LOJA-GUA', 'Estoque da loja Guarapuava',   true, NOW(), NOW())
  ON CONFLICT ("companyId", code) DO NOTHING;

  SELECT id INTO v_wh_loja_cas_id FROM gdr_warehouses WHERE code = 'LOJA-CAS';
  SELECT id INTO v_wh_loja_gua_id FROM gdr_warehouses WHERE code = 'LOJA-GUA';
  SELECT id INTO v_wh_fabrica_id  FROM gdr_warehouses WHERE code = 'ALM-FAB';
  RAISE NOTICE 'Warehouses: CAS=%, FAB=%', v_wh_loja_cas_id, v_wh_fabrica_id;

  -- Etapa 1: sp_vendas → gdr_sales_orders
  INSERT INTO gdr_sales_orders (
    id, "companyId", "customerId", "warehouseId",
    status, origin, notes, "confirmedAt", "legacyId", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::TEXT,
    v_gdr_cascavel_id,
    gc.id,
    v_wh_loja_cas_id,
    CASE sv.status WHEN 'Concluido' THEN 'CONFIRMED'::"SalesOrderStatus" ELSE 'DRAFT'::"SalesOrderStatus" END,
    'SP_SYSTEM'::"SalesOrderOrigin",
    'Venda SP — ID ' || sv.sp_id,
    CASE sv.status WHEN 'Concluido' THEN sv.data::TIMESTAMP ELSE NULL END,
    'sp_venda_' || sv.sp_id,
    sv.sp_created,
    sv.sp_modified
  FROM sp_vendas sv
  LEFT JOIN gdr_customers gc ON gc."legacyId" = 'sp_cli_' || sv.cliente_sp_id
  WHERE NOT EXISTS (SELECT 1 FROM gdr_sales_orders so WHERE so."legacyId" = 'sp_venda_' || sv.sp_id);

  GET DIAGNOSTICS v_order_count = ROW_COUNT;
  RAISE NOTICE 'Sales orders: %', v_order_count;

  -- Etapa 2: sp_carretinhas_venda → gdr_sale_items
  INSERT INTO gdr_sale_items (id, "salesOrderId", "productId", quantity, "unitPrice", unit)
  SELECT
    gen_random_uuid()::TEXT,
    so.id,
    gp.id,
    scv.quantidade,
    COALESCE(scv.valor_unitario, 0),
    'UN'::"UnitOfMeasure"
  FROM sp_carretinhas_venda scv
  JOIN gdr_sales_orders so ON so."legacyId" = 'sp_venda_' || scv.venda_sp_id
  JOIN gdr_products gp ON gp."legacyId" = 'modelo_' || scv.modelo_id
  WHERE scv.modelo_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gdr_sale_items si WHERE si."salesOrderId" = so.id AND si."productId" = gp.id
    );

  GET DIAGNOSTICS v_item_count = ROW_COUNT;
  RAISE NOTICE 'Sale items: %', v_item_count;

  -- Etapa 3: sp_chassis_utilizados → gdr_sale_serial (colunas corretas)
  INSERT INTO gdr_sale_serial (id, sales_order_id, serial_number, linked_at, legacy_id)
  SELECT
    gen_random_uuid()::TEXT,
    so.id,
    scu.numero,
    scu.sp_modified,
    scu.sp_id
  FROM sp_chassis_utilizados scu
  JOIN gdr_sales_orders so ON so."legacyId" = 'sp_venda_' || scu.venda_sp_id
  WHERE scu.numero IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM gdr_sale_serial ss WHERE ss.sales_order_id = so.id AND ss.serial_number = scu.numero
    );

  GET DIAGNOSTICS v_serial_count = ROW_COUNT;
  RAISE NOTICE 'Sale serials: %', v_serial_count;

END $$;

SELECT
  (SELECT COUNT(*) FROM gdr_warehouses)   AS warehouses,
  (SELECT COUNT(*) FROM gdr_sales_orders) AS sales_orders,
  (SELECT COUNT(*) FROM gdr_sale_items)   AS sale_items,
  (SELECT COUNT(*) FROM gdr_sale_serial)  AS sale_serials;

SELECT status, COUNT(*) FROM gdr_sales_orders GROUP BY status;
