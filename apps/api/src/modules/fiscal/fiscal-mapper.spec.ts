import { buildNFCePayload, buildNFePayload, buildTransferNFePayload, calcTotalValue, FiscalPayloadInput } from './fiscal-mapper';

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
      expect(payload.emitente.cnpj).toBe('12345678000190');
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
      expect(payload.destinatario).toBeUndefined();
    });

    it('inclui destinatario com CPF formatado quando informado', () => {
      const payload = buildNFCePayload({
        ...baseInput,
        recipient: { name: 'João', document: '123.456.789-09' },
      }) as any;
      expect(payload.destinatario.cpf_cnpj).toBe('12345678909');
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
      expect(payload.destinatario.nome).toBe('CONSUMIDOR NÃO IDENTIFICADO');
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
              ibsUfAliquota: 0.05, ibsUfValor: 0.5,
              ibsMunAliquota: 0.05, ibsMunValor: 0.5,
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
        ibs_uf_aliquota: 0.05,
        ibs_uf_valor: 0.5,
        ibs_mun_aliquota: 0.05,
        ibs_mun_valor: 0.5,
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
  });
});
