import { buildNFCePayload, buildNFePayload, calcTotalValue, FiscalPayloadInput } from './fiscal-mapper';

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

    it('mapeia itens com cfop 5102, NCM e valores corretos', () => {
      const payload = buildNFCePayload(baseInput) as any;
      expect(payload.items).toHaveLength(2);
      expect(payload.items[0]).toMatchObject({
        numero_item: 1,
        codigo_produto: 'SKU01',
        cfop: '5102',
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
    it('usa cfop 5102 para operação dentro do estado', () => {
      const payload = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Empresa SP', document: '98765432000101', state: 'PR' },
      }) as any;
      expect(payload.items[0].cfop).toBe('5102');
    });

    it('usa cfop 6102 para operação interestadual', () => {
      const payload = buildNFePayload({
        ...baseInput,
        recipient: { name: 'Empresa SP', document: '98765432000101', state: 'SP' },
      }) as any;
      expect(payload.items[0].cfop).toBe('6102');
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
  });
});
