import { buildNFCePayload, buildNFePayload, buildTransferNFePayload, calcTotalValue, cardBrandCode, mapPaymentsFlat, FiscalPayloadInput } from './fiscal-mapper';

const baseInput: FiscalPayloadInput = {
  ref: 'GDR-SO-001',
  emitter: { cnpj: '12.345.678/0001-90', name: 'GDR Ltda', address: 'Rua A, 1', city: 'Ibiporã', state: 'PR' },
  items: [
    { sku: 'SKU01', name: 'Produto A', ncm: '61099000', quantity: 2, unitPrice: 100, unit: 'UN' },
    { sku: 'SKU02', name: 'Produto B', ncm: '62034200', quantity: 1, unitPrice: 50, unit: 'PC' },
  ],
  totalValue: 250,
};

describe('fiscal-mapper', () => {
  // ─── #587: detPag lista + grupo card (tpIntegra=1) ─────────────────────────
  describe('mapPaymentsFlat (#587)', () => {
    it('cartão de crédito autorizado → grupo card completo (nomes flat oficiais)', () => {
      const forms = mapPaymentsFlat({
        ...baseInput,
        payments: [
          {
            tPag: '03',
            amount: 250,
            card: { cnpjCredenciadora: '01027058000191', tBand: '01', cAut: '484740' },
          },
        ],
      }) as any[];
      expect(forms).toHaveLength(1);
      expect(forms[0]).toEqual({
        forma_pagamento: '03',
        valor_pagamento: 250,
        tipo_integracao: '1',
        cnpj_credenciadora: '01027058000191',
        bandeira_operadora: '01',
        numero_autorizacao: '484740',
      });
    });

    it('multi-forma: PIX + débito somam o total; só o cartão leva grupo card', () => {
      const forms = mapPaymentsFlat({
        ...baseInput,
        payments: [
          { tPag: '17', amount: 100 },
          { tPag: '04', amount: 150, card: { tBand: '06', cAut: 'NSU123' } },
        ],
      }) as any[];
      expect(forms).toHaveLength(2);
      expect(forms[0]).toEqual({ forma_pagamento: '17', valor_pagamento: 100 });
      expect(forms[1].tipo_integracao).toBe('1');
      expect(forms[1].bandeira_operadora).toBe('06');
      expect(forms[1].cnpj_credenciadora).toBeUndefined(); // sem CNPJ → campo omitido
    });

    it('sem plano → forma única legada (retrocompat #479), frete somado', () => {
      const forms = mapPaymentsFlat({ ...baseInput, paymentMethod: '17', freight: { modality: '3', value: 50 } as any }) as any[];
      expect(forms).toEqual([{ forma_pagamento: '17', valor_pagamento: 300 }]);
    });

    it("forma '90' (devolução) exige valor 0", () => {
      const forms = mapPaymentsFlat({ ...baseInput, paymentMethod: '90' }) as any[];
      expect(forms[0].valor_pagamento).toBe(0);
    });

    it('buildNFePayload usa o plano quando presente', () => {
      const payload = buildNFePayload({
        ...baseInput,
        payments: [{ tPag: '03', amount: 250, card: { tBand: '02', cAut: 'A1' } }],
      }) as any;
      expect(payload.formas_pagamento).toHaveLength(1);
      expect(payload.formas_pagamento[0].tipo_integracao).toBe('1');
    });

    it('cardBrandCode mapeia bandeiras e cai em 99 pro desconhecido', () => {
      expect(cardBrandCode('VISA')).toBe('01');
      expect(cardBrandCode('mastercard')).toBe('02');
      expect(cardBrandCode('ELO')).toBe('06');
      expect(cardBrandCode('HIPERCARD')).toBe('07');
      expect(cardBrandCode('BANDEIRA_NOVA')).toBe('99');
      expect(cardBrandCode(null)).toBe('99');
    });
  });

  describe('calcTotalValue', () => {
    it('soma corretamente quantity × unitPrice de todos os itens', () => {
      expect(calcTotalValue(baseInput.items)).toBe(250);
    });

    it('retorna 0 para lista vazia', () => {
      expect(calcTotalValue([])).toBe(0);
    });
  });

  describe('buildNFCePayload', () => {
    it('gera payload com natureza_operacao VENDA A CONSUMIDOR', () => {
      const payload = buildNFCePayload(baseInput) as any;
      expect(payload.natureza_operacao).toBe('VENDA A CONSUMIDOR');
    });

    it('converte CNPJ removendo pontuação', () => {
      const payload = buildNFCePayload(baseInput) as any;
      expect(payload.cnpj_emitente).toBe('12345678000190');
    });

    it('mapeia itens com cfop 5101 (produção própria), NCM e valores corretos', () => {
      const payload = buildNFCePayload(baseInput) as any;
      expect(payload.items).toHaveLength(2);
      expect(payload.items[0]).toMatchObject({
        numero_item: 1,
        codigo_produto: 'SKU01',
        cfop: '5101',
        quantidade_comercial: 2,
        valor_unitario_comercial: 100,
        valor_total_bruto: 200,
        codigo_ncm: '61099000',
      });
    });

    it('não inclui destinatario quando cliente não tem CPF/CNPJ', () => {
      const payload = buildNFCePayload({ ...baseInput, recipient: { name: 'João', document: undefined } }) as any;
      expect(payload.nome_destinatario).toBeUndefined();
      expect(payload.cpf_destinatario).toBeUndefined();
    });

    it('inclui destinatario com CPF formatado quando informado', () => {
      const payload = buildNFCePayload({
        ...baseInput,
        recipient: { name: 'João', document: '123.456.789-09' },
      }) as any;
      expect(payload.cpf_destinatario).toBe('12345678909');
    });
  });

  describe('buildNFePayload', () => {
    it('usa cfop 5101 (produção própria) para operação dentro do estado', () => {
      const payload = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Empresa PR', document: '98765432000101', state: 'PR' },
      }) as any;
      expect(payload.items[0].cfop).toBe('5101');
    });

    it('usa cfop 6101 (produção própria) para operação interestadual', () => {
      const payload = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Empresa SP', document: '98765432000101', state: 'SP' },
      }) as any;
      expect(payload.items[0].cfop).toBe('6101');
    });

    it('preenche destinatario com CONSUMIDOR NÃO IDENTIFICADO quando recipient é undefined', () => {
      const payload = buildNFePayload({ ...baseInput, recipient: undefined }) as any;
      expect(payload.nome_destinatario).toBe('CONSUMIDOR NÃO IDENTIFICADO');
    });

    it('preenche NCM com zeros quando produto não tem NCM', () => {
      const inputSemNcm: FiscalPayloadInput = {
        ...baseInput,
        items: [{ ...baseInput.items[0], ncm: '' }],
      };
      const payload = buildNFePayload(inputSemNcm) as any;
      expect(payload.items[0].codigo_ncm).toBe('00000000');
    });

    it('usa natureza_operacao VENDA DE PRODUÇÃO PRÓPRIA', () => {
      const payload = buildNFePayload(baseInput) as any;
      expect(payload.natureza_operacao).toBe('VENDA DE PRODUÇÃO PRÓPRIA');
    });

    it('usa cfop do item.tax quando TaxRule fornece CFOP', () => {
      const inputComTax: FiscalPayloadInput = {
        ...baseInput,
        items: [
          {
            ...baseInput.items[0],
            tax: {
              cfop: '5910', // bonificação
              icmsCst: '00', icmsBase: 200, icmsAliquota: 18, icmsValor: 36,
              ipiCst: '99', ipiBase: 200, ipiAliquota: 0, ipiValor: 0,
              pisCst: '06', pisBase: 200, pisAliquota: 0, pisValor: 0,
              cofinsCst: '06', cofinsBase: 200, cofinsAliquota: 0, cofinsValor: 0,
            },
          },
        ],
        recipient: { name: 'Cliente', document: '12345678901', state: 'PR' },
      };
      const payload = buildNFePayload(inputComTax) as any;
      expect(payload.items[0].cfop).toBe('5910');
    });
  });

  describe('descrição do item veicular — xProd com chassi', () => {
    const vehicle = {
      tipoOperacao: '0', chassi: '9BGRD08X0XG020000', codigoCor: '02', descricaoCor: 'PRATA',
      potenciaMotor: 0, cilindrada: 0, pesoLiquido: '0.850', pesoBruto: '1.000',
      serie: 'SN20000', tipoCombustivel: '11', numeroMotor: '0',
      anoModelo: 2026, anoFabricacao: 2026, tipoPintura: 'S', tipoVeiculo: '10',
      especieVeiculo: '2', vin: 'N', condicao: '1', codigoMarcaModelo: '600657',
      corDenatran: '10', lotacao: 0, restricao: '0',
    };

    it('concatena descrição + chassi quando o item tem veicProd', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{ ...baseInput.items[0], vehicle }],
      }) as any;
      expect(payload.items[0].descricao).toBe('Produto A - CHASSI 9BGRD08X0XG020000');
      expect(payload.items[0].veiculo_chassi).toBe('9BGRD08X0XG020000');
    });

    it('mantém a descrição pura quando o item não é veicular', () => {
      const payload = buildNFePayload(baseInput) as any;
      expect(payload.items[0].descricao).toBe('Produto A');
    });

    it('clampa a descrição em 120 chars sem nunca cortar o chassi', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{ ...baseInput.items[0], name: 'X'.repeat(150), vehicle }],
      }) as any;
      const descricao = payload.items[0].descricao as string;
      expect(descricao.length).toBe(120);
      expect(descricao.endsWith(' - CHASSI 9BGRD08X0XG020000')).toBe(true);
    });
  });

  describe('buildTransferNFePayload', () => {
    it('usa CFOP 5152 para transferência dentro do estado', () => {
      const payload = buildTransferNFePayload({
        ...baseInput,
        recipient: { name: 'Loja Centro', state: 'PR' },
      }) as any;
      expect(payload.items[0].cfop).toBe('5152');
    });

    it('usa CFOP 6152 para transferência interestadual', () => {
      const payload = buildTransferNFePayload({
        ...baseInput,
        recipient: { name: 'Loja SP', state: 'SP' },
      }) as any;
      expect(payload.items[0].cfop).toBe('6152');
    });

    it('usa natureza_operacao TRANSFERÊNCIA DE MERCADORIA', () => {
      const payload = buildTransferNFePayload(baseInput) as any;
      expect(payload.natureza_operacao).toBe('TRANSFERÊNCIA DE MERCADORIA');
    });
  });

  describe('grupo UB — IBS/CBS NT 2025.002 (#415)', () => {
    const taxBase = {
      cfop: '6101',
      icmsCst: '00', icmsBase: 1000, icmsAliquota: 12, icmsValor: 120,
      ipiCst: '51', ipiBase: 1000, ipiAliquota: 0, ipiValor: 0,
      pisCst: '49', pisBase: 1000, pisAliquota: 0, pisValor: 0,
      cofinsCst: '99', cofinsBase: 0, cofinsAliquota: 0, cofinsValor: 0,
    };

    it('mapeia campos ibs_cbs_* quando o item tem ibsCbs calculado', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{
          ...baseInput.items[0],
          tax: {
            ...taxBase,
            ibsCbs: {
              cClassTrib: '000001', cbsCst: '000', base: 1000,
              cbsAliquota: 0.9, cbsValor: 9,
              ibsUfAliquota: 0.1, ibsUfValor: 1,
              ibsMunAliquota: 0, ibsMunValor: 0,
            },
          },
        }],
      }) as any;
      expect(payload.items[0]).toMatchObject({
        ibs_cbs_situacao_tributaria: '000',
        ibs_cbs_classificacao_tributaria: '000001',
        ibs_cbs_base_calculo: 1000,
        cbs_aliquota: 0.9,
        cbs_valor: 9,
        ibs_uf_aliquota: 0.1,
        ibs_uf_valor: 1,
        ibs_mun_aliquota: 0,
        ibs_mun_valor: 0,
      });
    });

    it('omite campos ibs_cbs_* quando o item não tem ibsCbs', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{ ...baseInput.items[0], tax: taxBase }],
      }) as any;
      expect(payload.items[0].ibs_cbs_situacao_tributaria).toBeUndefined();
      expect(payload.items[0].cbs_valor).toBeUndefined();
    });

    it('mapeia FCP do UF destino com os nomes oficiais fcp_* (#445)', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{
          ...baseInput.items[0],
          tax: {
            ...taxBase,
            difal: { baseCalculo: 1000, aliquotaInterna: 18, aliquotaInterestadual: 12, valor: 60, fcpAliquota: 2, fcpValor: 20 },
          },
        }],
      }) as any;
      expect(payload.items[0]).toMatchObject({
        icms_valor_uf_destino: 60,
        fcp_base_calculo_uf_destino: 1000,
        fcp_percentual_uf_destino: 2,
        fcp_valor_uf_destino: 20,
      });
      expect(payload.items[0].icms_percentual_fcp).toBeUndefined(); // campo fantasma removido
    });

    it('indIeDest explícito do cadastro prevalece sobre a inferência (#474)', () => {
      // Contribuinte com IE — indicador 1
      const contrib = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Revenda', razaoSocial: 'REVENDA LTDA', document: '11.444.777/0001-61', ie: '251083110', indIeDest: 'CONTRIBUINTE', state: 'SC' },
      }) as any;
      expect(contrib.indicador_inscricao_estadual_destinatario).toBe('1');
      expect(contrib.inscricao_estadual_destinatario).toBe('251083110');
      expect(contrib.nome_destinatario).toBe('REVENDA LTDA'); // razão social no DANFE

      // ISENTO explícito mesmo com IE preenchida — indicador 2 e IE omitida
      const isento = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Empresa', document: '11.444.777/0001-61', ie: '251083110', indIeDest: 'ISENTO', state: 'SC' },
      }) as any;
      expect(isento.indicador_inscricao_estadual_destinatario).toBe('2');
      expect(isento.inscricao_estadual_destinatario).toBeUndefined();

      // NAO_CONTRIBUINTE explícito — indicador 9
      const naoContrib = buildNFePayload({
        ...baseInput,
        recipient: { name: 'PF', document: '030.550.549-11', indIeDest: 'NAO_CONTRIBUINTE' },
      }) as any;
      expect(naoContrib.indicador_inscricao_estadual_destinatario).toBe('9');
    });

    it('grupo <entrega> com campos flat quando a OV tem endereço de entrega (#474)', () => {
      const payload = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Cliente', document: '030.550.549-11' },
        delivery: { address: 'ROD BR 277 KM 10', number: 'SN', neighborhood: 'ZONA RURAL', city: 'GUARAPUAVA', state: 'PR', zipCode: '85010-000' },
      }) as any;
      expect(payload).toMatchObject({
        cpf_entrega: '03055054911',
        logradouro_entrega: 'ROD BR 277 KM 10',
        municipio_entrega: 'GUARAPUAVA',
        uf_entrega: 'PR',
        cep_entrega: '85010000',
      });
      // sem delivery → sem grupo entrega
      const semEntrega = buildNFePayload({ ...baseInput, recipient: { name: 'X', document: '030.550.549-11' } }) as any;
      expect(semEntrega.logradouro_entrega).toBeUndefined();
    });

    it('DIFAL sem FCP envia percentual e valor zerados', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{
          ...baseInput.items[0],
          tax: {
            ...taxBase,
            difal: { baseCalculo: 1000, aliquotaInterna: 17, aliquotaInterestadual: 12, valor: 50, fcpAliquota: 0, fcpValor: 0 },
          },
        }],
      }) as any;
      expect(payload.items[0].fcp_percentual_uf_destino).toBe(0);
      expect(payload.items[0].fcp_valor_uf_destino).toBe(0);
      expect(payload.items[0].fcp_base_calculo_uf_destino).toBeUndefined();
    });
  });

  describe('origem da mercadoria — orig (#480)', () => {
    it('usa a origem do produto no icms_origem', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{ ...baseInput.items[0], origem: '2' }],
      }) as any;
      expect(payload.items[0].icms_origem).toBe(2);
    });

    it('default 0 (nacional) quando o produto não tem origem', () => {
      const payload = buildNFePayload(baseInput) as any;
      expect(payload.items[0].icms_origem).toBe(0);
    });
  });

  describe('GTIN, CEST e unidade tributável (#484)', () => {
    it('mapeia cEAN/cEANTrib quando o produto tem GTIN', () => {
      const payload = buildNFePayload({
        ...baseInput,
        items: [{ ...baseInput.items[0], ean: '7891234567895', cest: '01.023.00' }],
      }) as any;
      expect(payload.items[0].codigo_barras_comercial).toBe('7891234567895');
      expect(payload.items[0].codigo_barras_tributavel).toBe('7891234567895');
      expect(payload.items[0].cest).toBe('0102300');
    });

    it('omite GTIN/CEST quando não cadastrados (Focus emite SEM GTIN)', () => {
      const payload = buildNFePayload(baseInput) as any;
      expect(payload.items[0].codigo_barras_comercial).toBeUndefined();
      expect(payload.items[0].cest).toBeUndefined();
    });

    it('converte quantidade/valor pela unidade tributável', () => {
      const payload = buildNFePayload({
        ...baseInput,
        // 2 UN × fator 10 = 20 na unidade tributável; vUnTrib = 100 ÷ 10
        items: [{ ...baseInput.items[0], unidadeTributavel: 'KG', fatorConversaoTributavel: 10 }],
      }) as any;
      expect(payload.items[0].unidade_tributavel).toBe('KG');
      expect(payload.items[0].quantidade_tributavel).toBe(20);
      expect(payload.items[0].valor_unitario_tributavel).toBe(10);
    });
  });

  describe('grupo transp — transportador e volumes (#481)', () => {
    const freight = {
      modality: '2',
      value: 350,
      carrier: {
        document: '11.444.777/0001-61',
        name: 'TRANSPORTES XYZ LTDA',
        ie: '123456789',
        address: 'Rod BR 277, km 10',
        city: 'São José dos Pinhais',
        state: 'PR',
      },
      vehiclePlate: 'ABC-1D23',
      vehiclePlateState: 'PR',
      volumes: [{ quantidade: 2, especie: 'REBOQUE', pesoLiquido: 780.5, pesoBruto: 900 }],
    };

    it('sem freight mantém modalidade_frete 9 (comportamento anterior)', () => {
      const payload = buildNFePayload(baseInput) as any;
      expect(payload.modalidade_frete).toBe('9');
      expect(payload.cnpj_transportador).toBeUndefined();
      expect(payload.volumes).toBeUndefined();
    });

    it('mapeia transportador com campos flat oficiais e placa normalizada', () => {
      const payload = buildNFePayload({ ...baseInput, freight }) as any;
      expect(payload.modalidade_frete).toBe('2');
      // frete não vai no cabeçalho — é rateado por item (rejeição SEFAZ 535)
      expect(payload.valor_frete).toBeUndefined();
      expect(payload.cnpj_transportador).toBe('11444777000161');
      expect(payload.nome_transportador).toBe('TRANSPORTES XYZ LTDA');
      expect(payload.inscricao_estadual_transportador).toBe('123456789');
      expect(payload.endereco_transportador).toBe('Rod BR 277, km 10');
      expect(payload.municipio_transportador).toBe('São José dos Pinhais');
      expect(payload.uf_transportador).toBe('PR');
      expect(payload.veiculo_placa).toBe('ABC1D23');
      expect(payload.veiculo_uf).toBe('PR');
    });

    it('mapeia volumes[] com quantidade, espécie e pesos', () => {
      const payload = buildNFePayload({ ...baseInput, freight }) as any;
      expect(payload.volumes).toEqual([
        { quantidade: 2, especie: 'REBOQUE', peso_liquido: 780.5, peso_bruto: 900 },
      ]);
    });

    it('modalidade 3 (veículo próprio) sem transportadora só envia modalidade e volumes', () => {
      const payload = buildNFePayload({
        ...baseInput,
        freight: { modality: '3', volumes: [{ quantidade: 1, especie: 'REBOQUE' }] },
      }) as any;
      expect(payload.modalidade_frete).toBe('3');
      expect(payload.cnpj_transportador).toBeUndefined();
      expect(payload.volumes).toEqual([{ quantidade: 1, especie: 'REBOQUE' }]);
    });

    it('detPag soma o vFrete ao total (vPag deve bater com o vNF)', () => {
      const payload = buildNFePayload({ ...baseInput, freight }) as any;
      // 250 (itens) + 350 (frete) — SEFAZ rejeita pagamento ≠ total da nota
      expect(payload.formas_pagamento[0].valor_pagamento).toBe(600);
    });

    it('rateia o vFrete pelos itens proporcional ao valor, resíduo no último (rej. 535)', () => {
      const payload = buildNFePayload({ ...baseInput, freight }) as any;
      // itens de 200 e 50 (total 250) com frete 350 → 280 + 70
      expect(payload.items[0].valor_frete).toBe(280);
      expect(payload.items[1].valor_frete).toBe(70);
      const soma = payload.items.reduce((s: number, i: any) => s + (i.valor_frete ?? 0), 0);
      expect(soma).toBe(350);
    });

    it('sem valor de frete não emite valor_frete nos itens', () => {
      const payload = buildNFePayload({
        ...baseInput,
        freight: { modality: '3', volumes: [{ quantidade: 1 }] },
      }) as any;
      expect(payload.items[0].valor_frete).toBeUndefined();
    });

    it('transportador PF usa cpf_transportador', () => {
      const payload = buildNFePayload({
        ...baseInput,
        freight: { modality: '2', carrier: { document: '123.456.789-09', name: 'JOÃO FRETES' } },
      }) as any;
      expect(payload.cpf_transportador).toBe('12345678909');
      expect(payload.cnpj_transportador).toBeUndefined();
    });
  });
});

describe('assinatura Avecchi nas Informações Complementares (13/07)', () => {
  const base = {
    emitter: { cnpj: '30284708000182', name: 'CRD', ie: '9078144677', crt: 3, state: 'PR', city: 'SAO JOSE DOS PINHAIS', street: 'RUA A', number: '1', neighborhood: 'B', zipCode: '83091002', ibgeCode: '4125506' },
    recipient: { name: 'Cliente', document: '04969592985', state: 'PR', street: 'RUA B', number: '2', neighborhood: 'C', city: 'SJP', zipCode: '83035390', ibgeCode: '4125506' },
    items: [],
    totalValue: 0,
  } as any;

  it('NF-e sem infCpl leva só a assinatura', () => {
    const payload = buildNFePayload(base);
    expect(payload.informacoes_adicionais_contribuinte).toBe(
      'Documento emitido pelo ERP Avecchi - www.avecchi.ai',
    );
  });

  it('NF-e com infCpl preserva o conteúdo e anexa a assinatura', () => {
    const payload = buildNFePayload({ ...base, infCpl: 'DIFAL recolhido' });
    expect(payload.informacoes_adicionais_contribuinte).toBe(
      'DIFAL recolhido | Documento emitido pelo ERP Avecchi - www.avecchi.ai',
    );
  });

  it('NFC-e e transferência também levam a assinatura', () => {
    expect(String(buildNFCePayload(base).informacoes_adicionais_contribuinte)).toContain('avecchi.ai');
    expect(String(buildTransferNFePayload(base).informacoes_adicionais_contribuinte)).toContain('avecchi.ai');
  });
});

describe('data/hora de saída (dhSaiEnt — pedido Claudio 13/07)', () => {
  const base = {
    emitter: { cnpj: '30284708000182', name: 'CRD', ie: '9078144677', crt: 3, state: 'PR', city: 'SJP', street: 'RUA A', number: '1', neighborhood: 'B', zipCode: '83091002', ibgeCode: '4125506' },
    recipient: { name: 'Cliente', document: '04969592985', state: 'PR', street: 'RUA B', number: '2', neighborhood: 'C', city: 'SJP', zipCode: '83035390', ibgeCode: '4125506' },
    items: [],
    totalValue: 0,
  } as any;

  it('NF-e e transferência levam data_entrada_saida = padrão da emissão', () => {
    expect(buildNFePayload(base).data_entrada_saida).toBeTruthy();
    expect(buildTransferNFePayload(base).data_entrada_saida).toBeTruthy();
  });

  it('NFC-e NÃO leva dhSaiEnt (vedado no modelo 65)', () => {
    expect(buildNFCePayload(base).data_entrada_saida).toBeUndefined();
  });
});
