import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from './pricing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';

const mockPrisma = {
  product: { findFirst: jest.fn() },
  company: { findUnique: jest.fn() },
  bomVersion: { findFirst: jest.fn() },
};
const mockTax = { findBestRule: jest.fn() };

// Regra típica: ICMS 18% (sem redução) + IPI 5% + PIS 1,65% + COFINS 7,6% = 32,25%
const baseRule = {
  id: 'rule-1',
  icmsAliquota: '18',
  icmsBaseReducao: '100',
  ipiAliquota: '5',
  pisCst: '01',
  pisAliquota: '1.65',
  cofinsCst: '01',
  cofinsAliquota: '7.6',
};

const baseProduct = {
  id: 'p-1',
  sku: 'REB01',
  name: 'Reboque Basculante',
  ncm: '87164000',
  productType: 'FINISHED_GOOD',
  avgCost: '1000',
  costPrice: '900',
  salePrice: '1800',
};

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TaxCalculationService, useValue: mockTax },
      ],
    }).compile();

    service = module.get(PricingService);
    jest.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue({ state: 'PR' });
    mockPrisma.bomVersion.findFirst.mockResolvedValue(null);
    mockTax.findBestRule.mockResolvedValue(baseRule);
  });

  it('calcula preço sugerido pela fórmula de markup com impostos reais', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);

    const r = await service.simulate('co-1', 'p-1', 20);

    // totalPct = 18 + 5 + 1.65 + 7.6 = 32.25
    expect(r.taxes.totalPct).toBe(32.25);
    expect(r.taxes.ruleId).toBe('rule-1');
    // preço = 1000 / (1 − 0.20 − 0.3225) = 1000 / 0.4775 = 2094.24
    expect(r.suggestedPrice).toBe(2094.24);
    expect(r.cost.source).toBe('avgCost');
    expect(r.cost.base).toBe(1000);
  });

  it('compara com o preço atual (delta, deltaPct, margem realizada)', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);

    const r = await service.simulate('co-1', 'p-1', 20);

    expect(r.currentPrice).toBe(1800);
    expect(r.comparison.delta).toBe(294.24); // 2094.24 − 1800
    expect(r.comparison.deltaPct).toBe(16.35);
    // margem líquida hoje = (1800×(1−0.3225) − 1000)/1800 = 12.19%
    expect(r.comparison.currentMarginPct).toBe(12.19);
  });

  it('what-if: costOverride substitui o custo base', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);

    const r = await service.simulate('co-1', 'p-1', 20, { costOverride: 1200 });

    expect(r.cost.source).toBe('override');
    expect(r.cost.base).toBe(1200);
    // 1200 / 0.4775 = 2513.09
    expect(r.suggestedPrice).toBe(2513.09);
  });

  it('cai para costPrice quando avgCost é ausente/zero', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ ...baseProduct, avgCost: null });

    const r = await service.simulate('co-1', 'p-1', 20);

    expect(r.cost.source).toBe('costPrice');
    expect(r.cost.base).toBe(900);
  });

  it('sem TaxRule: impostos zerados + warning, ainda calcula preço', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockTax.findBestRule.mockResolvedValue(null);

    const r = await service.simulate('co-1', 'p-1', 20);

    expect(r.taxes.totalPct).toBe(0);
    expect(r.taxes.ruleId).toBeNull();
    expect(r.taxes.warning).toContain('Sem TaxRule');
    // 1000 / (1 − 0.20) = 1250
    expect(r.suggestedPrice).toBe(1250);
  });

  it('CST 99 em PIS/COFINS não onera o preço', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockTax.findBestRule.mockResolvedValue({ ...baseRule, pisCst: '99', cofinsCst: '99' });

    const r = await service.simulate('co-1', 'p-1', 20);

    // só ICMS 18 + IPI 5 = 23
    expect(r.taxes.pisPct).toBe(0);
    expect(r.taxes.cofinsPct).toBe(0);
    expect(r.taxes.totalPct).toBe(23);
  });

  it('aplica redução de base do ICMS no percentual efetivo', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockTax.findBestRule.mockResolvedValue({ ...baseRule, icmsBaseReducao: '50' });

    const r = await service.simulate('co-1', 'p-1', 20);

    // ICMS efetivo = 18 × 50/100 = 9
    expect(r.taxes.icmsPct).toBe(9);
    expect(r.taxes.totalPct).toBe(23.25); // 9 + 5 + 1.65 + 7.6
  });

  it('explode a BOM ativa em breakdown de material + conversão', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);
    mockPrisma.bomVersion.findFirst.mockResolvedValue({
      items: [
        { componentId: 'c-1', quantity: '2', scrapPct: '0', component: { sku: 'ACO', name: 'Aço', avgCost: '300', costPrice: null } },
        { componentId: 'c-2', quantity: '1', scrapPct: '10', component: { sku: 'EIXO', name: 'Eixo', avgCost: '250', costPrice: null } },
      ],
    });

    const r = await service.simulate('co-1', 'p-1', 20);

    // material = 2×300 + (1×1.1)×250 = 600 + 275 = 875
    expect(r.cost.materialFromBom).toBe(875);
    // conversão = base(1000) − material(875) = 125
    expect(r.cost.conversion).toBe(125);
    expect(r.cost.breakdown).toHaveLength(2);
    expect(r.cost.breakdown![1]).toMatchObject({ sku: 'EIXO', quantity: 1.1, subtotal: 275 });
  });

  it('rejeita quando margem + impostos ≥ 100% (preço inviável)', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);

    // margem 70% + impostos 32.25% = 102.25% → denom negativo
    await expect(service.simulate('co-1', 'p-1', 70)).rejects.toThrow(BadRequestException);
  });

  it('rejeita produto sem custo cadastrado', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ ...baseProduct, avgCost: null, costPrice: null });

    await expect(service.simulate('co-1', 'p-1', 20)).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejeita produto inexistente', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(null);

    await expect(service.simulate('co-1', 'p-x', 20)).rejects.toThrow(NotFoundException);
  });

  it('rejeita marginPct negativo', async () => {
    mockPrisma.product.findFirst.mockResolvedValue(baseProduct);

    await expect(service.simulate('co-1', 'p-1', -5)).rejects.toThrow(BadRequestException);
  });
});
