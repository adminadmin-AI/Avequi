import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BudgetPlanService } from './budget-plan.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  budgetPlan: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  budgetDriver: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  saleItem: { findMany: jest.fn() },
};

const plan = {
  id: 'bp-1',
  companyId: 'co-1',
  year: 2026,
  name: 'Orçamento 2026',
  variableExpensePct: '10',
  fixedExpenseMonthly: '1000',
  capex: '5000',
};

const drivers = [
  { id: 'd-1', companyId: 'co-1', budgetPlanId: 'bp-1', productId: 'p-1', label: 'Basculante', volume: '100', avgPrice: '500', unitCost: '300' },
  { id: 'd-2', companyId: 'co-1', budgetPlanId: 'bp-1', productId: 'p-2', label: 'Prancha', volume: '50', avgPrice: '800', unitCost: '500' },
];

describe('BudgetPlanService', () => {
  let service: BudgetPlanService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BudgetPlanService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(BudgetPlanService);
    jest.clearAllMocks();
    mockPrisma.budgetPlan.findFirst.mockResolvedValue(plan);
    mockPrisma.budgetDriver.findMany.mockResolvedValue(drivers);
    mockPrisma.saleItem.findMany.mockResolvedValue([]);
  });

  describe('project', () => {
    it('projeta receita/CPV/margem e resultado com OPEX fixo/variável e CAPEX', async () => {
      const p = await service.project('co-1', 'bp-1');

      // receita = 100×500 + 50×800 = 90000 ; CPV = 100×300 + 50×500 = 55000
      expect(p.revenue).toBe(90000);
      expect(p.cpv).toBe(55000);
      expect(p.grossProfit).toBe(35000);
      // var = 90000×10% = 9000 ; fixo = 1000×12 = 12000
      expect(p.variableExpenses).toBe(9000);
      expect(p.fixedExpenses).toBe(12000);
      // operacional = 35000 − 9000 − 12000 = 14000
      expect(p.operatingResult).toBe(14000);
      expect(p.capex).toBe(5000);
      expect(p.resultAfterCapex).toBe(9000);
    });

    it('deriva o mix% de cada driver pela participação na receita', async () => {
      const p = await service.project('co-1', 'bp-1');
      // 50000/90000 = 55.56 ; 40000/90000 = 44.44
      expect(p.drivers[0].mixPct).toBe(55.56);
      expect(p.drivers[1].mixPct).toBe(44.44);
      expect(p.drivers[0].revenue).toBe(50000);
    });

    it('plano inexistente lança NotFound', async () => {
      mockPrisma.budgetPlan.findFirst.mockResolvedValue(null);
      await expect(service.project('co-1', 'bp-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('sensitivity', () => {
    it('gera cenários ±10% volume e ±5% preço com deltas sobre a base', async () => {
      const s = await service.sensitivity('co-1', 'bp-1');

      expect(s.base.revenue).toBe(90000);
      const keys = s.scenarios.map((x) => x.scenario);
      expect(keys).toEqual(['volume_+10%', 'volume_-10%', 'preco_+5%', 'preco_-5%']);

      const volUp = s.scenarios.find((x) => x.scenario === 'volume_+10%')!;
      // receita 90000×1.1 = 99000 ; delta +9000
      expect(volUp.revenue).toBe(99000);
      expect(volUp.revenueDelta).toBe(9000);

      const priceUp = s.scenarios.find((x) => x.scenario === 'preco_+5%')!;
      // receita 90000×1.05 = 94500
      expect(priceUp.revenue).toBe(94500);
    });
  });

  describe('vsRealized', () => {
    it('compara orçado vs realizado por driver e no total', async () => {
      mockPrisma.saleItem.findMany.mockResolvedValue([
        { productId: 'p-1', quantity: '90', unitPrice: '500' }, // 45000
        { productId: 'p-2', quantity: '60', unitPrice: '800' }, // 48000
      ]);

      const r = await service.vsRealized('co-1', 'bp-1');

      expect(r.budgetedRevenue).toBe(90000);
      expect(r.realizedRevenue).toBe(93000);
      expect(r.revenueVariance).toBe(3000);

      const d1 = r.drivers[0];
      expect(d1.realizedRevenue).toBe(45000);
      expect(d1.revenueVariance).toBe(-5000);
      expect(d1.realizedVolume).toBe(90);
      expect(d1.volumeVariance).toBe(-10);
    });

    it('driver sem produto vinculado tem realizado nulo (não dá pra casar)', async () => {
      mockPrisma.budgetDriver.findMany.mockResolvedValue([
        { id: 'd-3', companyId: 'co-1', budgetPlanId: 'bp-1', productId: null, label: 'Serviços', volume: '10', avgPrice: '100', unitCost: '0' },
      ]);
      mockPrisma.saleItem.findMany.mockResolvedValue([]);

      const r = await service.vsRealized('co-1', 'bp-1');
      expect(r.drivers[0].realizedRevenue).toBeNull();
      expect(r.drivers[0].revenueVariance).toBeNull();
    });
  });

  describe('drivers CRUD', () => {
    it('cria driver novo quando não há id', async () => {
      mockPrisma.budgetDriver.create.mockResolvedValue({ id: 'd-new' });
      await service.upsertDriver('co-1', 'bp-1', { label: 'Novo', volume: 10, avgPrice: 100, unitCost: 50 });
      expect(mockPrisma.budgetDriver.create).toHaveBeenCalled();
      expect(mockPrisma.budgetDriver.update).not.toHaveBeenCalled();
    });

    it('atualiza driver existente quando id é informado', async () => {
      mockPrisma.budgetDriver.findFirst.mockResolvedValue({ id: 'd-1' });
      mockPrisma.budgetDriver.update.mockResolvedValue({ id: 'd-1' });
      await service.upsertDriver('co-1', 'bp-1', { id: 'd-1', label: 'Editado', volume: 20, avgPrice: 200, unitCost: 80 });
      expect(mockPrisma.budgetDriver.update).toHaveBeenCalled();
    });

    it('remover driver inexistente lança NotFound', async () => {
      mockPrisma.budgetDriver.findFirst.mockResolvedValue(null);
      await expect(service.removeDriver('co-1', 'bp-1', 'd-x')).rejects.toThrow(NotFoundException);
    });
  });
});
