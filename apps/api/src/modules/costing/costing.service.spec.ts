import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CostingService } from './costing.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  costCenter: { findMany: jest.fn() },
  product: { findFirst: jest.fn() },
  bomVersion: { findFirst: jest.fn() },
  routingStep: { findMany: jest.fn() },
  workCenter: { findMany: jest.fn() },
};

const centers = [
  { monthlyCif: '30000', monthlyProductiveHours: '1000' },
  { monthlyCif: '10000', monthlyProductiveHours: '500' },
];

const bom = {
  items: [
    { componentId: 'c-1', quantity: '2', scrapPct: '0', component: { sku: 'ACO', name: 'Aço', avgCost: '300', costPrice: null } },
    { componentId: 'c-2', quantity: '1', scrapPct: '10', component: { sku: 'EIXO', name: 'Eixo', avgCost: '250', costPrice: null } },
  ],
};

const steps = [
  { name: 'Corte', stepOrder: 1, workCenter: 'WC1', setupTimeMin: 30, runTimeMin: 90 },
  { name: 'Solda', stepOrder: 2, workCenter: 'WC2', setupTimeMin: 0, runTimeMin: 60 },
];

const workCenters = [
  { code: 'WC1', costPerHour: '50' },
  { code: 'WC2', costPerHour: '40' },
];

describe('CostingService', () => {
  let service: CostingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CostingService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(CostingService);
    jest.clearAllMocks();
    mockPrisma.costCenter.findMany.mockResolvedValue(centers);
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'p-1', sku: 'REB01', name: 'Reboque' });
    mockPrisma.bomVersion.findFirst.mockResolvedValue(bom);
    mockPrisma.routingStep.findMany.mockResolvedValue(steps);
    mockPrisma.workCenter.findMany.mockResolvedValue(workCenters);
  });

  describe('getCifRate', () => {
    it('rateia ΣCIF ÷ Σhoras produtivas dos centros ativos', async () => {
      const r = await service.getCifRate('co-1');
      // (30000 + 10000) / (1000 + 500) = 40000/1500 = 26.67
      expect(r.ratePerHour).toBe(26.67);
      expect(r.monthlyCif).toBe(40000);
      expect(r.monthlyProductiveHours).toBe(1500);
      expect(r.centers).toBe(2);
    });

    it('taxa 0 quando não há horas produtivas (evita divisão por zero)', async () => {
      mockPrisma.costCenter.findMany.mockResolvedValue([{ monthlyCif: '5000', monthlyProductiveHours: '0' }]);
      const r = await service.getCifRate('co-1');
      expect(r.ratePerHour).toBe(0);
    });

    it('taxa 0 quando não há centros de custo', async () => {
      mockPrisma.costCenter.findMany.mockResolvedValue([]);
      const r = await service.getCifRate('co-1');
      expect(r.ratePerHour).toBe(0);
      expect(r.centers).toBe(0);
    });
  });

  describe('computeProductCost', () => {
    it('compõe material + MOD + CIF com comparativo com/sem CIF', async () => {
      const r = await service.computeProductCost('co-1', 'p-1');

      // material = 2×300 + 1.1×250 = 875
      expect(r.material.total).toBe(875);
      // MOD = 2h×50 + 1h×40 = 140
      expect(r.labor.total).toBe(140);
      expect(r.labor.hours).toBe(3);
      // CIF = 3h × 26.67 = 80.01
      expect(r.cif.ratePerHour).toBe(26.67);
      expect(r.cif.total).toBe(80.01);
      // comparativo
      expect(r.totalWithoutCif).toBe(1015); // 875 + 140
      expect(r.totalWithCif).toBe(1095.01); // + 80.01
      expect(r.cifImpactPct).toBe(7.88); // 80.01 / 1015
    });

    it('converte tempo de setup+run em horas por passo', async () => {
      const r = await service.computeProductCost('co-1', 'p-1');
      // Corte: (30+90)/60 = 2h ; Solda: (0+60)/60 = 1h
      expect(r.labor.breakdown[0]).toMatchObject({ step: 'Corte', hours: 2, cost: 100 });
      expect(r.labor.breakdown[1]).toMatchObject({ step: 'Solda', hours: 1, cost: 40 });
    });

    // ─── #815: custo/hora resolvido pela FK ────────────────────────────────
    it('#815: usa o costPerHour vindo da FK, sem consultar por código', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValue([
        {
          name: 'Corte',
          stepOrder: 1,
          workCenterId: 'wc-1',
          workCenter: null,
          workCenterRef: { id: 'wc-1', code: 'WC1', costPerHour: '50' },
          setupTimeMin: 30,
          runTimeMin: 90,
        },
      ]);
      mockPrisma.workCenter.findMany.mockClear();

      const r = await service.computeProductCost('co-1', 'p-1');

      // 2h × 50 = 100
      expect(r.labor.total).toBe(100);
      expect(r.labor.breakdown[0]).toMatchObject({ workCenter: 'WC1', costPerHour: 50 });
      // Não precisou do fallback por código
      expect(mockPrisma.workCenter.findMany).not.toHaveBeenCalled();
    });

    it('#815: fallback por texto continua funcionando para passo sem FK', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValue([
        {
          name: 'Corte',
          stepOrder: 1,
          workCenterId: null,
          workCenter: 'WC1',
          workCenterRef: null,
          setupTimeMin: 30,
          runTimeMin: 90,
        },
      ]);
      mockPrisma.workCenter.findMany.mockResolvedValue([{ code: 'WC1', costPerHour: '50' }]);

      const r = await service.computeProductCost('co-1', 'p-1');

      expect(r.labor.total).toBe(100);
      expect(r.labor.breakdown[0]).toMatchObject({ workCenter: 'WC1', costPerHour: 50 });
    });

    it('#815: FK e texto convivem — cada passo resolve pelo seu caminho', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValue([
        {
          name: 'Corte',
          stepOrder: 1,
          workCenterId: 'wc-1',
          workCenter: null,
          workCenterRef: { id: 'wc-1', code: 'WC1', costPerHour: '50' },
          setupTimeMin: 30,
          runTimeMin: 90,
        },
        {
          name: 'Solda',
          stepOrder: 2,
          workCenterId: null,
          workCenter: 'WC2',
          workCenterRef: null,
          setupTimeMin: 0,
          runTimeMin: 60,
        },
      ]);
      mockPrisma.workCenter.findMany.mockResolvedValue([{ code: 'WC2', costPerHour: '40' }]);

      const r = await service.computeProductCost('co-1', 'p-1');

      // 2h×50 (FK) + 1h×40 (texto) = 140 — mesmo total do cenário original
      expect(r.labor.total).toBe(140);
      expect(r.labor.hours).toBe(3);
    });

    it('passo sem WorkCenter conta horas para CIF mas não gera MOD', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValue([
        { name: 'Inspeção', stepOrder: 1, workCenter: null, setupTimeMin: 0, runTimeMin: 60 },
      ]);
      mockPrisma.workCenter.findMany.mockResolvedValue([]);

      const r = await service.computeProductCost('co-1', 'p-1');
      expect(r.labor.total).toBe(0);
      expect(r.labor.hours).toBe(1);
      expect(r.cif.total).toBe(26.67); // 1h × 26.67
    });

    it('produto sem BOM tem material zero', async () => {
      mockPrisma.bomVersion.findFirst.mockResolvedValue(null);
      const r = await service.computeProductCost('co-1', 'p-1');
      expect(r.material.total).toBe(0);
      expect(r.material.breakdown).toEqual([]);
    });

    it('sem CIF configurado, custo com e sem CIF são iguais', async () => {
      mockPrisma.costCenter.findMany.mockResolvedValue([]);
      const r = await service.computeProductCost('co-1', 'p-1');
      expect(r.cif.total).toBe(0);
      expect(r.totalWithCif).toBe(r.totalWithoutCif);
      expect(r.cifImpactPct).toBe(0);
    });

    it('rejeita produto inexistente', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);
      await expect(service.computeProductCost('co-1', 'p-x')).rejects.toThrow(NotFoundException);
    });
  });
});
