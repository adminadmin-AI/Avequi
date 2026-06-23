import { Test } from '@nestjs/testing';
import { TaxCalculationService } from './tax-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';

// Use string literals to avoid stale Prisma client cache
const TaxOperationType = {
  VENDA_INTERNA: 'VENDA_INTERNA' as any,
  VENDA_INTERESTADUAL: 'VENDA_INTERESTADUAL' as any,
};

const dec = (v: number) => ({ toNumber: () => v, toString: () => String(v) }) as any;

const makeRule = (overrides: Record<string, any> = {}) => ({
  id: 'rule-1',
  companyId: 'comp-1',
  operationType: TaxOperationType.VENDA_INTERNA,
  ncm: null,
  productType: null,
  ufOrigem: null,
  ufDestino: null,
  cfop: '5101',
  icmsCst: '00',
  icmsAliquota: dec(18),
  icmsBaseReducao: dec(100),
  ipiCst: '50',
  ipiAliquota: dec(5),
  pisCst: '01',
  pisAliquota: dec(0.65),
  cofinsCst: '01',
  cofinsAliquota: dec(3),
  description: 'Regra geral',
  priority: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('TaxCalculationService', () => {
  let service: TaxCalculationService;
  let prisma: { taxRule: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { taxRule: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        TaxCalculationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TaxCalculationService);
  });

  it('calcula ICMS 18% sobre venda interna PR→PR', async () => {
    prisma.taxRule.findMany.mockResolvedValue([makeRule()]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.VENDA_INTERNA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 1000,
    });
    // IPI = 1000 * 5% = 50
    // ICMS base = (1000 + 50) * 100% = 1050; ICMS = 1050 * 18% = 189
    expect(result.ipi.valor).toBe(50);
    expect(result.icms.baseCalculo).toBe(1050);
    expect(result.icms.valor).toBe(189);
    expect(result.pis.valor).toBe(6.5);
    expect(result.cofins.valor).toBe(30);
    expect(result.cfop).toBe('5101');
  });

  it('calcula ICMS 12% sobre venda interestadual PR→MG', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.VENDA_INTERESTADUAL,
        cfop: '6101',
        icmsAliquota: dec(12),
        ufOrigem: 'PR',
        ufDestino: 'MG',
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.VENDA_INTERESTADUAL,
      ufOrigem: 'PR',
      ufDestino: 'MG',
      itemValue: 1000,
    });
    expect(result.icms.aliquota).toBe(12);
    expect(result.cfop).toBe('6101');
  });

  it('aplica redução de base de cálculo ICMS', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ icmsBaseReducao: dec(70), ipiAliquota: dec(0) }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.VENDA_INTERNA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 1000,
    });
    // base = 1000 * 70% = 700; ICMS = 700 * 18% = 126
    expect(result.icms.baseCalculo).toBe(700);
    expect(result.icms.valor).toBe(126);
  });

  it('regra específica por NCM tem prioridade sobre geral', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ priority: 0, cfop: '5101' }),
      makeRule({ priority: 10, ncm: '87161000', cfop: '5102', id: 'rule-ncm' }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.VENDA_INTERNA,
      ncm: '87161000',
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 1000,
    });
    expect(result.cfop).toBe('5102');
  });

  it('usa fallback quando nenhuma regra existe', async () => {
    prisma.taxRule.findMany.mockResolvedValue([]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.VENDA_INTERNA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 1000,
    });
    expect(result.cfop).toBe('5102');
    expect(result.icms.cst).toBe('00');
    expect(result.pis.aliquota).toBe(0.65);
    expect(result.cofins.aliquota).toBe(3);
  });
});
