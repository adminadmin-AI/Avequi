-- ============================================================
-- T9 — Migração NF-e: stg_nota_saida/entrada → gdr_fiscal_documents + items + taxes
-- Total: ~11k documentos, ~14k itens, ~14k impostos
-- Data: 2026-06-18
-- ============================================================

-- Mapeamento de CNPJ → company_id
-- 30284708000182 → GDR Reboques        (1f885505-37df-426f-b885-2a7ac889763c)
-- 46247069000115 → GDR Cascavel        (1a81b804-eff3-44e7-bf9e-7d8b17c5cb23)

DO $$
DECLARE
  v_count INT;
BEGIN

  -- ===================================================
  -- ETAPA 1: NF-e Saída → gdr_fiscal_documents
  -- ===================================================
  RAISE NOTICE 'Etapa 1: Inserindo NF-e de saída...';

  INSERT INTO gdr_fiscal_documents (
    id, "companyId", type, direction, status,
    number, series, "accessKey",
    "issuerTaxId", "recipientTaxId",
    "totalAmount", "issuedAt",
    "legacyId", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::TEXT,
    CASE ns.cnpj_emitente
      WHEN '30284708000182' THEN '1f885505-37df-426f-b885-2a7ac889763c'
      WHEN '46247069000115' THEN '1a81b804-eff3-44e7-bf9e-7d8b17c5cb23'
      ELSE '1f885505-37df-426f-b885-2a7ac889763c'
    END,
    'NFE'::"FiscalDocumentType",
    'OUTBOUND'::"FiscalDocumentDirection",
    CASE ns.status_nota
      WHEN 'Autorizado o uso da NF-e' THEN 'AUTHORIZED'::"FiscalStatus"
      WHEN 'Cancelada'                THEN 'CANCELLED'::"FiscalStatus"
      ELSE                                 'ERROR'::"FiscalStatus"
    END,
    ns.numero_nota::TEXT,
    ns.serie::TEXT,
    ns.chave_nfe,
    ns.cnpj_emitente,
    ns.cpf_cnpj_destinatario,
    ns.valor_nota,
    ns.data_emissao,
    'saida_' || ns.id,
    NOW(),
    NOW()
  FROM stg_nota_saida ns
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_documents fd WHERE fd."legacyId" = 'saida_' || ns.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 1 concluída: % NF-e saída inseridas', v_count;

  -- ===================================================
  -- ETAPA 2: NF-e Entrada → gdr_fiscal_documents
  -- ===================================================
  RAISE NOTICE 'Etapa 2: Inserindo NF-e de entrada...';

  INSERT INTO gdr_fiscal_documents (
    id, "companyId", type, direction, status,
    number, series, "accessKey",
    "issuerTaxId", "issuerName", "recipientTaxId",
    "totalAmount", "issuedAt",
    "legacyId", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::TEXT,
    CASE ne.cnpj_empresa
      WHEN '30284708000182' THEN '1f885505-37df-426f-b885-2a7ac889763c'
      WHEN '46247069000115' THEN '1a81b804-eff3-44e7-bf9e-7d8b17c5cb23'
      ELSE '1f885505-37df-426f-b885-2a7ac889763c'
    END,
    'NFE'::"FiscalDocumentType",
    'INBOUND'::"FiscalDocumentDirection",
    CASE ne.status_nota
      WHEN 'Autorizado o uso da NF-e' THEN 'AUTHORIZED'::"FiscalStatus"
      WHEN 'Cancelada'                THEN 'CANCELLED'::"FiscalStatus"
      ELSE                                 'AUTHORIZED'::"FiscalStatus"
    END,
    ne.numero_nota::TEXT,
    ne.serie::TEXT,
    ne.chave_nfe,
    ne.cnpj_cpf_emitente,
    ne.nome_emitente,
    ne.cnpj_empresa,
    ne.valor_nota,
    ne.data_emissao,
    'entrada_' || ne.id,
    NOW(),
    NOW()
  FROM stg_nota_entrada ne
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_documents fd WHERE fd."legacyId" = 'entrada_' || ne.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 2 concluída: % NF-e entrada inseridas', v_count;

  -- ===================================================
  -- ETAPA 3: Itens de saída → gdr_fiscal_document_items
  -- ===================================================
  RAISE NOTICE 'Etapa 3: Inserindo itens de NF-e saída...';

  INSERT INTO gdr_fiscal_document_items (
    id, "fiscalDocumentId", "productCode", "productName",
    ncm, cfop, unit, quantity, "unitPrice", "totalPrice", "legacyId"
  )
  SELECT
    gen_random_uuid()::TEXT,
    fd.id,
    ins.codigo_produto,
    ins.descricao_produto,
    ins.ncm,
    ins.cfop,
    ins.unidade,
    ins.quantidade,
    ins.valor_unitario,
    ins.valor_total,
    'item_saida_' || ins.id
  FROM stg_item_nota_saida ins
  JOIN gdr_fiscal_documents fd ON fd."accessKey" = ins.chave_nfe
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_document_items fdi WHERE fdi."legacyId" = 'item_saida_' || ins.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 3 concluída: % itens saída inseridos', v_count;

  -- ===================================================
  -- ETAPA 4: Itens de entrada → gdr_fiscal_document_items
  -- ===================================================
  RAISE NOTICE 'Etapa 4: Inserindo itens de NF-e entrada...';

  INSERT INTO gdr_fiscal_document_items (
    id, "fiscalDocumentId", "productCode", "productName",
    ncm, cfop, unit, quantity, "unitPrice", "totalPrice", "legacyId"
  )
  SELECT
    gen_random_uuid()::TEXT,
    fd.id,
    ine.codigo_produto,
    ine.descricao_produto,
    ine.ncm,
    ine.cfop,
    ine.unidade,
    ine.quantidade,
    ine.valor_unitario,
    ine.valor_total,
    'item_entrada_' || ine.id
  FROM stg_item_nota_entrada ine
  JOIN gdr_fiscal_documents fd ON fd."accessKey" = ine.chave_nfe
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_document_items fdi WHERE fdi."legacyId" = 'item_entrada_' || ine.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 4 concluída: % itens entrada inseridos', v_count;

  -- ===================================================
  -- ETAPA 5: Impostos de saída → gdr_fiscal_document_item_taxes
  -- ===================================================
  RAISE NOTICE 'Etapa 5: Inserindo impostos de NF-e saída...';

  INSERT INTO gdr_fiscal_document_item_taxes (
    id, "fiscalDocumentItemId",
    "cstIcms", "baseIcms", "aliquotaIcms", "valorIcms",
    "cstIpi",  "baseIpi",  "aliquotaIpi",  "valorIpi",
    "cstPis",  "basePis",  "aliquotaPis",  "valorPis"
  )
  SELECT
    gen_random_uuid()::TEXT,
    fdi.id,
    imp.cst_icms, imp.base_icms, imp.aliquota_icms, imp.valor_icms,
    imp.cst_ipi,  imp.base_ipi,  imp.aliquota_ipi,  imp.valor_ipi,
    imp.cst_pis,  imp.base_pis,  imp.aliquota_pis,  imp.valor_pis
  FROM stg_item_imposto_saida imp
  JOIN gdr_fiscal_document_items fdi ON fdi."legacyId" = 'item_saida_' || imp.id
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_document_item_taxes t WHERE t."fiscalDocumentItemId" = fdi.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 5 concluída: % impostos saída inseridos', v_count;

  -- ===================================================
  -- ETAPA 6: Impostos de entrada → gdr_fiscal_document_item_taxes
  -- ===================================================
  RAISE NOTICE 'Etapa 6: Inserindo impostos de NF-e entrada...';

  INSERT INTO gdr_fiscal_document_item_taxes (
    id, "fiscalDocumentItemId",
    "cstIcms", "baseIcms", "aliquotaIcms", "valorIcms",
    "cstIpi",  "baseIpi",  "aliquotaIpi",  "valorIpi",
    "cstPis",  "basePis",  "aliquotaPis",  "valorPis"
  )
  SELECT
    gen_random_uuid()::TEXT,
    fdi.id,
    imp.cst_icms, imp.base_icms, imp.aliquota_icms, imp.valor_icms,
    imp.cst_ipi,  imp.base_ipi,  imp.aliquota_ipi,  imp.valor_ipi,
    imp.cst_pis,  imp.base_pis,  imp.aliquota_pis,  imp.valor_pis
  FROM stg_item_imposto_entrada imp
  JOIN gdr_fiscal_document_items fdi ON fdi."legacyId" = 'item_entrada_' || imp.id
  WHERE NOT EXISTS (
    SELECT 1 FROM gdr_fiscal_document_item_taxes t WHERE t."fiscalDocumentItemId" = fdi.id
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Etapa 6 concluída: % impostos entrada inseridos', v_count;

END $$;

-- Validação final
SELECT
  (SELECT COUNT(*) FROM gdr_fiscal_documents)             AS total_documentos,
  (SELECT COUNT(*) FROM gdr_fiscal_documents WHERE direction = 'OUTBOUND') AS saida,
  (SELECT COUNT(*) FROM gdr_fiscal_documents WHERE direction = 'INBOUND')  AS entrada,
  (SELECT COUNT(*) FROM gdr_fiscal_documents WHERE status = 'AUTHORIZED')  AS autorizadas,
  (SELECT COUNT(*) FROM gdr_fiscal_documents WHERE status = 'CANCELLED')   AS canceladas,
  (SELECT COUNT(*) FROM gdr_fiscal_document_items)        AS total_itens,
  (SELECT COUNT(*) FROM gdr_fiscal_document_item_taxes)   AS total_impostos;
