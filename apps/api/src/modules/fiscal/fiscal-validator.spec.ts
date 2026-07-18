import { formatValidationIssues, validateNfePayload } from './fiscal-validator';

/** Payload mínimo válido — espelho do que buildNFePayload produz */
const validPayload = (overrides: Record<string, any> = {}, item: Record<string, any> = {}) => ({
  data_emissao: '2026-07-06T15:30:00-03:00',
  cnpj_emitente: '46247069000115',
  cpf_destinatario: '04252011043',
  indicador_inscricao_estadual_destinatario: '9',
  consumidor_final: '1',
  modalidade_frete: '9',
  items: [
    {
      numero_item: 1,
      codigo_ncm: '87163900',
      cfop: '5101',
      ibs_cbs_situacao_tributaria: '000',
      ...item,
    },
  ],
  ...overrides,
});

describe('validateNfePayload (#499)', () => {
  it('payload válido não gera issues', () => {
    expect(validateNfePayload(validPayload())).toEqual([]);
  });

  it('data_emissao em UTC (Z) → rej. 577 (nota pula de dia após 21h)', () => {
    const issues = validateNfePayload(validPayload({ data_emissao: '2026-07-06T23:30:00Z' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '577', field: 'data_emissao' })]);
  });

  it('data_emissao ausente → rej. 509', () => {
    const issues = validateNfePayload(validPayload({ data_emissao: undefined }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '509' })]);
  });

  it('CNPJ do emitente com dígito errado → rej. 207', () => {
    const issues = validateNfePayload(validPayload({ cnpj_emitente: '46247069000199' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '207', field: 'cnpj_emitente' })]);
  });

  it('CPF do destinatário inválido → rej. 209', () => {
    const issues = validateNfePayload(validPayload({ cpf_destinatario: '12345678900' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '209', field: 'cpf_destinatario' })]);
  });

  it('IE "ISENTO" literal → rej. 728 (deve omitir IE e usar indicador 2)', () => {
    const issues = validateNfePayload(
      validPayload({ inscricao_estadual_destinatario: 'ISENTO', indicador_inscricao_estadual_destinatario: '2' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '728' })]);
  });

  it('contribuinte (indIEDest=1) sem IE → rej. 234', () => {
    const issues = validateNfePayload(
      validPayload({ indicador_inscricao_estadual_destinatario: '1' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '234' })]);
  });

  // Devolução completa: entrada (tipo_documento 0) + NF-e original referenciada (#747)
  const CHAVE_ORIGINAL = '41260730284708000182550010000200021392278324';
  const devolucaoBase = {
    finalidade_emissao: '4',
    tipo_documento: '0',
    notas_referenciadas: [{ chave_nfe: CHAVE_ORIGINAL }],
  };

  it('devolução (finalidade 4) sem pagamento 90/valor 0 → rej. 871', () => {
    const issues = validateNfePayload(
      validPayload({
        ...devolucaoBase,
        formas_pagamento: [{ forma_pagamento: '17', valor_pagamento: 100 }],
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '871' })]);
  });

  it('devolução com pagamento 90/valor 0 passa', () => {
    const issues = validateNfePayload(
      validPayload({
        ...devolucaoBase,
        formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('finalidade 4 sem notas_referenciadas → rej. 321 (#747)', () => {
    const issues = validateNfePayload(
      validPayload({
        finalidade_emissao: '4',
        tipo_documento: '0',
        formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '321', field: 'notas_referenciadas' })]);
  });

  it('finalidade 4 com chave referenciada inválida (≠44 dígitos) → rej. 321', () => {
    const issues = validateNfePayload(
      validPayload({
        ...devolucaoBase,
        notas_referenciadas: [{ chave_nfe: '123' }],
        formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '321' })]);
  });

  it('devolução como saída (tipo_documento 1) → rej. 866 (deve ser entrada)', () => {
    const issues = validateNfePayload(
      validPayload({
        ...devolucaoBase,
        tipo_documento: '1',
        formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '866', field: 'tipo_documento' })]);
  });

  it('finalidade 5/6 sem referência → exigência conforme o sentido (254 crédito / 1038 débito)', () => {
    expect(validateNfePayload(validPayload({ finalidade_emissao: '5' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ rejection: '254' })]),
    );
    expect(validateNfePayload(validPayload({ finalidade_emissao: '6' }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ rejection: '1038' })]),
    );
  });

  it('valor_frete no cabeçalho → rej. 535 (vFrete é rateado por item)', () => {
    const issues = validateNfePayload(validPayload({ valor_frete: 350 }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '535' })]);
  });

  it('NCM placeholder 00000000 → orienta classificação', () => {
    const issues = validateNfePayload(validPayload({}, { codigo_ncm: '00000000' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '778' })]);
  });

  it('CFOP inválido → rej. 511', () => {
    const issues = validateNfePayload(validPayload({}, { cfop: '9999' }));
    expect(issues).toEqual([expect.objectContaining({ rejection: '511' })]);
  });

  it('CST IBS/CBS 2xx sem gRed → rej. 1033 (#446)', () => {
    const issues = validateNfePayload(
      validPayload({}, { ibs_cbs_situacao_tributaria: '200' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: '1033' })]);
  });

  it('CST 2xx com gRed completo passa', () => {
    const issues = validateNfePayload(
      validPayload(
        {},
        {
          ibs_cbs_situacao_tributaria: '200',
          cbs_percentual_reducao_aliquota: 100,
          ibs_uf_percentual_reducao_aliquota: 100,
        },
      ),
    );
    expect(issues).toEqual([]);
  });

  it('veículo sem cmt/distância de eixos → nota sairia sem dados de emplacamento', () => {
    const issues = validateNfePayload(
      validPayload({}, { veiculo_codigo_vin: 'N', veiculo_chassi: '9AD123456789' }),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: 'FOCUS-VEIC' })]);
  });

  it('veiculo_serie acima de 9 chars → limite nSerie', () => {
    const issues = validateNfePayload(
      validPayload(
        {},
        {
          veiculo_chassi: '9AD123456789',
          veiculo_cmt: '0.75',
          veiculo_distancia_eixos: 200,
          veiculo_serie: 'SERIEMUITOLONGA',
        },
      ),
    );
    expect(issues).toEqual([expect.objectContaining({ rejection: 'FOCUS-VEIC', field: 'items[1].veiculo_serie' })]);
  });

  it('acumula múltiplos problemas e formata mensagem orientada', () => {
    const issues = validateNfePayload(
      validPayload({ data_emissao: '2026-07-06T23:30:00Z', valor_frete: 10 }, { cfop: '99' }),
    );
    expect(issues).toHaveLength(3);
    const msg = formatValidationIssues(issues);
    expect(msg).toMatch(/^Validação pré-transmissão bloqueou a emissão \(3 problemas\)/);
    expect(msg).toContain('[577]');
    expect(msg).toContain('[535]');
    expect(msg).toContain('[511]');
  });

  // ── W16-40 (NT 2026.002): NFC-e sem identificação acima do limite ─────────
  describe('W16-40 — NFC-e sem identificação do consumidor', () => {
    const nfce = (total: number, dest: Record<string, any> = {}) =>
      validPayload(
        { cpf_destinatario: undefined, ...dest },
        { valor_total_bruto: total },
      );

    afterEach(() => delete process.env.NFCE_UNIDENTIFIED_LIMIT);

    it('NFC-e > R$ 10.000 SEM CPF/CNPJ → bloqueia com orientação', () => {
      const issues = validateNfePayload(nfce(15000), 'nfce');
      expect(issues.some((i) => i.rejection === 'W16-40')).toBe(true);
      expect(formatValidationIssues(issues)).toContain('Identifique o cliente');
    });

    it('NFC-e > limite COM CPF → passa', () => {
      const issues = validateNfePayload(nfce(15000, { cpf_destinatario: '04252011043' }), 'nfce');
      expect(issues.some((i) => i.rejection === 'W16-40')).toBe(false);
    });

    it('NFC-e ≤ limite sem identificação → passa (consumidor não identificado é válido)', () => {
      const issues = validateNfePayload(nfce(9999.99), 'nfce');
      expect(issues.some((i) => i.rejection === 'W16-40')).toBe(false);
    });

    it('limite por UF configurável via NFCE_UNIDENTIFIED_LIMIT', () => {
      process.env.NFCE_UNIDENTIFIED_LIMIT = '3000';
      const issues = validateNfePayload(nfce(5000), 'nfce');
      expect(issues.some((i) => i.rejection === 'W16-40')).toBe(true);
    });

    it('NF-e (modelo padrão) não passa pela regra', () => {
      const issues = validateNfePayload(nfce(15000), 'nfe');
      expect(issues.some((i) => i.rejection === 'W16-40')).toBe(false);
    });
  });
});

// ─── #756: validação das notas de débito/crédito (finNFe 5/6) ─────────────────
describe('validateNfePayload — notas 5/6 da Reforma (#756)', () => {
  const CHAVE = '41260730284708000182550010000200021392278324';
  const adjBase = (finalidade: '5' | '6', extra: Record<string, any> = {}) =>
    validPayload({
      finalidade_emissao: finalidade,
      // crédito é ENTRADA (rej. 1161); débito é saída — validado na SEFAZ homolog F4
      tipo_documento: finalidade === '5' ? '0' : '1',
      ...(finalidade === '6' ? { tipo_nota_debito: '04' } : { tipo_nota_credito: '04' }),
      // assimetria validada na SEFAZ: crédito referencia no cabeçalho (254),
      // débito por item (1038); os dois juntos = 1010
      ...(finalidade === '5' ? { notas_referenciadas: [{ chave_nfe: CHAVE }] } : {}),
      formas_pagamento: [{ forma_pagamento: '90', valor_pagamento: 0 }],
      items: [
        {
          numero_item: 1,
          codigo_produto: 'AJUSTE',
          descricao: 'MULTA E JUROS',
          cfop: finalidade === '5' ? '1949' : '5949',
          codigo_ncm: '87163900',
          valor_total_bruto: 350,
          // gDFeReferenciado por item — só débito (rej. 1038)
          ...(finalidade === '6'
            ? { chave_acesso_dfe_referenciado: CHAVE, numero_item_dfe_referenciado: '1' }
            : {}),
          ibs_cbs_situacao_tributaria: '000',
          ibs_cbs_classificacao_tributaria: '000001',
          ibs_cbs_base_calculo: 350,
          cbs_aliquota: 0.9,
          cbs_valor: 3.15,
          ibs_uf_aliquota: 0.1,
          ibs_uf_valor: 0.35,
        },
      ],
      ...extra,
    });

  it('payload 5/6 completo passa', () => {
    expect(validateNfePayload(adjBase('6'))).toEqual([]);
    expect(validateNfePayload(adjBase('5'))).toEqual([]);
  });

  it('finalidade 6 sem tipo_nota_debito → bloqueia (B25)', () => {
    const p = adjBase('6');
    delete p.tipo_nota_debito;
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: 'B25', field: 'tipo_nota_debito' }),
    ]);
  });

  it('tipo_nota_credito fora do catálogo (07) → bloqueia', () => {
    const p = adjBase('5', { tipo_nota_credito: '07' });
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: 'B25', field: 'tipo_nota_credito' }),
    ]);
  });

  it('tributo estranho no item (icms_*) → bloqueia (só IBS/CBS)', () => {
    const p = adjBase('6');
    (p.items as any[])[0].icms_situacao_tributaria = '00';
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: 'RTC', field: 'items[1]' }),
    ]);
  });

  it('item sem grupo IBS/CBS → bloqueia', () => {
    const p = adjBase('6');
    delete (p.items as any[])[0].ibs_cbs_situacao_tributaria;
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: 'RTC' }),
    ]);
  });

  it('débito: item sem gDFeReferenciado → rej. 1038 (SEFAZ homolog F4)', () => {
    const p = adjBase('6');
    delete (p.items as any[])[0].chave_acesso_dfe_referenciado;
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '1038' }),
    ]);
  });

  it('crédito sem NF referenciada no cabeçalho → rej. 254', () => {
    const p = adjBase('5');
    delete p.notas_referenciadas;
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '254', field: 'notas_referenciadas' }),
    ]);
  });

  it('nota de crédito como saída → rej. 1161 (crédito exige entrada)', () => {
    const p = adjBase('5', { tipo_documento: '1' });
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '1161', field: 'tipo_documento' }),
    ]);
  });

  it('débito com notas_referenciadas no cabeçalho → rej. 1010 (débito referencia só por item)', () => {
    const p = adjBase('6', { notas_referenciadas: [{ chave_nfe: CHAVE }] });
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '1010', field: 'notas_referenciadas' }),
    ]);
  });

  it('CFOP de saída em nota de crédito → rej. 519 (entrada exige 1/2xxx)', () => {
    const p = adjBase('5');
    (p.items as any[])[0].cfop = '5949';
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '519', field: 'items[1].cfop' }),
    ]);
  });

  it('finalidade 5/6 sem pagamento 90/0 → rej. 871', () => {
    const p = adjBase('6', { formas_pagamento: [{ forma_pagamento: '17', valor_pagamento: 350 }] });
    expect(validateNfePayload(p)).toEqual([
      expect.objectContaining({ rejection: '871' }),
    ]);
  });
});
