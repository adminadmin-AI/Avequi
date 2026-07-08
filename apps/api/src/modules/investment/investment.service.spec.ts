import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InvestmentService } from './investment.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  investmentProject: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  investmentCashflow: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const projectWithFlows = {
  id: 'ip-1',
  companyId: 'co-1',
  name: 'Nova prensa',
  discountRatePct: '10',
  status: 'DRAFT',
  cashflows: [
    { id: 'cf0', period: 0, amount: '-1000' },
    { id: 'cf1', period: 1, amount: '500' },
    { id: 'cf2', period: 2, amount: '500' },
    { id: 'cf3', period: 3, amount: '500' },
  ],
};

describe('InvestmentService', () => {
  let service: InvestmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvestmentService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(InvestmentService);
    jest.clearAllMocks();
  });

  describe('getProject (análise)', () => {
    it('retorna VPL, TIR, payback simples/descontado e série acumulada', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue(projectWithFlows);

      const r = await service.getProject('co-1', 'ip-1');
      const a = r.analysis;

      expect(a.npv).toBe(243.43);
      expect(a.irrPct!).toBeGreaterThan(23);
      expect(a.irrPct!).toBeLessThan(24);
      expect(a.paybackSimple).toBe(2);
      expect(a.paybackDiscounted).toBeCloseTo(2.35, 2);
      expect(a.viable).toBe(true);
      expect(a.series).toHaveLength(4);
      // fluxo acumulado do último período = -1000+1500 = 500
      expect(a.series[3].cumulative).toBe(500);
    });

    it('projeto inexistente lança NotFound', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue(null);
      await expect(service.getProject('co-1', 'x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('decide (alçada)', () => {
    it('aprova projeto em DRAFT gravando aprovador e data', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue({ id: 'ip-1', status: 'DRAFT' });
      mockPrisma.investmentProject.update.mockResolvedValue({ id: 'ip-1', status: 'APPROVED' });

      await service.decide('co-1', 'ip-1', 'user-diretor', true);

      const arg = mockPrisma.investmentProject.update.mock.calls[0][0];
      expect(arg.data.status).toBe('APPROVED');
      expect(arg.data.approvedById).toBe('user-diretor');
      expect(arg.data.approvedAt).toBeInstanceOf(Date);
    });

    it('reprova projeto em DRAFT', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue({ id: 'ip-1', status: 'DRAFT' });
      mockPrisma.investmentProject.update.mockResolvedValue({});
      await service.decide('co-1', 'ip-1', 'user-diretor', false);
      expect(mockPrisma.investmentProject.update.mock.calls[0][0].data.status).toBe('REJECTED');
    });

    it('não decide projeto que já saiu de DRAFT', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue({ id: 'ip-1', status: 'APPROVED' });
      await expect(service.decide('co-1', 'ip-1', 'u', true)).rejects.toThrow(BadRequestException);
    });
  });

  describe('compare', () => {
    it('devolve VPL/TIR/payback lado a lado', async () => {
      mockPrisma.investmentProject.findMany.mockResolvedValue([
        projectWithFlows,
        { ...projectWithFlows, id: 'ip-2', name: 'Projeto B', cashflows: [{ period: 0, amount: '-1000' }, { period: 1, amount: '1200' }] },
      ]);

      const r = await service.compare('co-1', ['ip-1', 'ip-2']);
      expect(r).toHaveLength(2);
      expect(r[0].npv).toBe(243.43);
      // Projeto B: -1000 + 1200/1.1 = 90.91
      expect(r[1].npv).toBe(90.91);
    });
  });

  describe('upsertCashflow', () => {
    it('cria fluxo quando o período ainda não existe', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue({ id: 'ip-1' });
      mockPrisma.investmentCashflow.findFirst.mockResolvedValue(null);
      mockPrisma.investmentCashflow.create.mockResolvedValue({});
      await service.upsertCashflow('co-1', 'ip-1', { period: 4, amount: 300 });
      expect(mockPrisma.investmentCashflow.create).toHaveBeenCalled();
      expect(mockPrisma.investmentCashflow.update).not.toHaveBeenCalled();
    });

    it('atualiza fluxo quando o período já existe', async () => {
      mockPrisma.investmentProject.findFirst.mockResolvedValue({ id: 'ip-1' });
      mockPrisma.investmentCashflow.findFirst.mockResolvedValue({ id: 'cf-x' });
      mockPrisma.investmentCashflow.update.mockResolvedValue({});
      await service.upsertCashflow('co-1', 'ip-1', { period: 1, amount: 600 });
      expect(mockPrisma.investmentCashflow.update).toHaveBeenCalled();
    });
  });
});
