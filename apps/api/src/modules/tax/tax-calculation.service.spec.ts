import { Test } from '@nestjs/testing';
import { TaxCalculationService } from './tax-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';

// Use string literals to avoid stale Prisma client cache
const TaxOperationType = {
  VENDA_INTERNA: 'VENDA_INTERNA' as any,
  VENDA_INTERESTADUAL: 'VENDA_INTERESTADUAL' as any,
  DEVOLUCAO_VENDA: 'DEVOLUCAO_VENDA' as any,
  COMPRA_INTERNA: 'COMPRA_INTERNA' as any,
  COMPRA_INTERESTADUAL: 'COMPRA_INTERESTADUAL' as any,
  DEVOLUCAO_COMPRA: 'DEVOLUCAO_COMPRA' as any,
  TRANSFERENCIA_INTERNA: 'TRANSFERENCIA_INTERNA' as any,
  TRANSFERENCIA_INTERESTADUAL: 'TRANSFERENCIA_INTERESTADUAL' as any,
  REMESSA_CONSERTO: 'REMESSA_CONSERTO' as any,
  RETORNO_CONSERTO: 'RETORNO_CONSERTO' as any,
  AMOSTRA_GRATIS: 'AMOSTRA_GRATIS' as any,
  BONIFICACAO: 'BONIFICACAO' as any,
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
    expect(result.cfop).toBe('5101');
    expect(result.icms.cst).toBe('00');
    expect(result.pis.aliquota).toBe(0.65);
    expect(result.cofins.aliquota).toBe(3);
  });

  // ─── Testes por tipo de operação CFOP (#163) ─────────────────────────────

  it('devolução de venda usa CFOP 1202', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ operationType: TaxOperationType.DEVOLUCAO_VENDA, cfop: '1202', ipiCst: '49' }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.DEVOLUCAO_VENDA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 500,
    });
    expect(result.cfop).toBe('1202');
  });

  it('compra matéria-prima interna usa CFOP 1101', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ operationType: TaxOperationType.COMPRA_INTERNA, cfop: '1101', ipiCst: '00' }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.COMPRA_INTERNA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 800,
    });
    expect(result.cfop).toBe('1101');
  });

  it('compra matéria-prima interestadual usa CFOP 2101', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.COMPRA_INTERESTADUAL,
        cfop: '2101',
        icmsAliquota: dec(12),
        ufOrigem: 'SP',
        ufDestino: 'PR',
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.COMPRA_INTERESTADUAL,
      ufOrigem: 'SP',
      ufDestino: 'PR',
      itemValue: 800,
    });
    expect(result.cfop).toBe('2101');
    expect(result.icms.aliquota).toBe(12);
  });

  it('devolução de compra usa CFOP 5201', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ operationType: TaxOperationType.DEVOLUCAO_COMPRA, cfop: '5201', ipiCst: '49' }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.DEVOLUCAO_COMPRA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 600,
    });
    expect(result.cfop).toBe('5201');
  });

  it('transferência interna usa CFOP 5152', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({ operationType: TaxOperationType.TRANSFERENCIA_INTERNA, cfop: '5152', ipiCst: '99', ipiAliquota: dec(0) }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.TRANSFERENCIA_INTERNA,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 1000,
    });
    expect(result.cfop).toBe('5152');
    expect(result.ipi.valor).toBe(0);
  });

  it('transferência interestadual usa CFOP 6152', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.TRANSFERENCIA_INTERESTADUAL,
        cfop: '6152',
        icmsAliquota: dec(12),
        ipiCst: '99',
        ipiAliquota: dec(0),
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.TRANSFERENCIA_INTERESTADUAL,
      ufOrigem: 'PR',
      ufDestino: 'SP',
      itemValue: 1000,
    });
    expect(result.cfop).toBe('6152');
    expect(result.icms.aliquota).toBe(12);
  });

  it('remessa para conserto usa CFOP 5915 — impostos zerados', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.REMESSA_CONSERTO,
        cfop: '5915',
        icmsCst: '41',
        icmsAliquota: dec(0),
        ipiCst: '99',
        ipiAliquota: dec(0),
        pisCst: '06',
        pisAliquota: dec(0),
        cofinsCst: '06',
        cofinsAliquota: dec(0),
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.REMESSA_CONSERTO,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 2000,
    });
    expect(result.cfop).toBe('5915');
    expect(result.icms.cst).toBe('41');
    expect(result.totalTributos).toBe(0);
  });

  it('retorno de conserto usa CFOP 1916 — impostos zerados', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.RETORNO_CONSERTO,
        cfop: '1916',
        icmsCst: '41',
        icmsAliquota: dec(0),
        ipiAliquota: dec(0),
        pisCst: '06',
        pisAliquota: dec(0),
        cofinsCst: '06',
        cofinsAliquota: dec(0),
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.RETORNO_CONSERTO,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 2000,
    });
    expect(result.cfop).toBe('1916');
    expect(result.totalTributos).toBe(0);
  });

  it('amostra grátis usa CFOP 5911 — sem tributação', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.AMOSTRA_GRATIS,
        cfop: '5911',
        icmsCst: '41',
        icmsAliquota: dec(0),
        ipiAliquota: dec(0),
        pisCst: '06',
        pisAliquota: dec(0),
        cofinsCst: '06',
        cofinsAliquota: dec(0),
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.AMOSTRA_GRATIS,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 100,
    });
    expect(result.cfop).toBe('5911');
    expect(result.totalTributos).toBe(0);
  });

  it('bonificação usa CFOP 5910 — ICMS normal, PIS/COFINS isento', async () => {
    prisma.taxRule.findMany.mockResolvedValue([
      makeRule({
        operationType: TaxOperationType.BONIFICACAO,
        cfop: '5910',
        icmsCst: '00',
        icmsAliquota: dec(18),
        ipiAliquota: dec(0),
        pisCst: '06',
        pisAliquota: dec(0),
        cofinsCst: '06',
        cofinsAliquota: dec(0),
      }),
    ]);
    const result = await service.calculateTaxes({
      companyId: 'comp-1',
      operationType: TaxOperationType.BONIFICACAO,
      ufOrigem: 'PR',
      ufDestino: 'PR',
      itemValue: 500,
    });
    expect(result.cfop).toBe('5910');
    expect(result.icms.valor).toBe(90); // 500 * 18%
    expect(result.pis.valor).toBe(0);
    expect(result.cofins.valor).toBe(0);
  });
});
