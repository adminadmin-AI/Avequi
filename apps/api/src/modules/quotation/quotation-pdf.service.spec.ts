import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotationPdfService } from './quotation-pdf.service';

const mockPrisma = {
  quotation: { findFirst: jest.fn() },
};

const baseQuotation = {
  id: 'cq_abc12345',
  discount: 5,
  validUntil: new Date('2026-08-01'),
  notes: 'Entrega em 15 dias úteis. Frete por conta do emitente.',
  items: [
    {
      quantity: 1,
      unitPrice: 25000,
      discount: 0,
      product: { sku: 'MOD-CAR-001', name: 'Reboque Carga 750kg' },
    },
    {
      quantity: 2,
      unitPrice: 350,
      discount: 10,
      product: { sku: 'ACC-LONA-01', name: 'Lona de cobertura' },
    },
  ],
  customer: { name: 'João da Silva', document: '12345678900', email: 'joao@x.com', phone: '45999998888' },
  company: {
    name: 'GDR Cascavel',
    razaoSocial: 'GDR Reboques LTDA',
    cnpj: '46247069000115',
    street: 'Rua Antônio Singer',
    number: '4075',
    neighborhood: 'Campo Largo da Roseira',
    city: 'São José dos Pinhais',
    state: 'PR',
    zipCode: '83091-002',
    phone: '(41) 3333-4444',
    email: 'vendas@gdr.com.br',
  },
  createdBy: { name: 'Vendedor Teste' },
};

describe('QuotationPdfService (#572)', () => {
  let service: QuotationPdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuotationPdfService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(QuotationPdfService);
    jest.clearAllMocks();
  });

  it('gera PDF válido (magic %PDF) com nome derivado da cotação', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(baseQuotation);

    const { buffer, filename } = await service.generate('cq_abc12345', 'co-1');

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toBe('proposta-abc12345.pdf');
    // tenancy: busca sempre filtra companyId
    expect(mockPrisma.quotation.findFirst.mock.calls[0][0].where).toEqual({
      id: 'cq_abc12345',
      companyId: 'co-1',
    });
  });

  it('cotação de outra company → NotFound (tenancy)', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue(null);
    await expect(service.generate('cq_x', 'co-1')).rejects.toThrow(NotFoundException);
  });

  it('gera mesmo sem cliente/validade/notas (campos opcionais)', async () => {
    mockPrisma.quotation.findFirst.mockResolvedValue({
      ...baseQuotation,
      customer: null,
      validUntil: null,
      notes: null,
      createdBy: null,
    });
    const { buffer } = await service.generate('cq_abc12345', 'co-1');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
