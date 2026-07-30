import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmDashboardService } from './crm-dashboard.service';

const COMPANY = 'company-1';
const D = (n: number) => new Prisma.Decimal(n);
const range = { companyId: COMPANY, from: new Date('2026-06-01'), to: new Date('2026-07-01') };

describe('CrmDashboardService', () => {
  let service: CrmDashboardService;
  let prisma: any;

  beforeEach(async () => {
    const ALL_STAGES = [
      { id: 's-novo', name: 'Novo', type: 'OPEN', order: 0 },
      { id: 's-atend', name: 'Atendimento', type: 'OPEN', order: 1 },
      { id: 's-prop', name: 'Proposta', type: 'OPEN', order: 2 },
      { id: 's-won', name: 'Ganho', type: 'WON', order: 4 },
      { id: 's-lost', name: 'Perdido', type: 'LOST', order: 5 },
    ];
    prisma = {
      pipelineStage: {
        // respeita where.type (como o banco faria) p/ wonStageIds/lostStageIds corretos
        findMany: jest.fn(({ where }: any = {}) =>
          Promise.resolve(where?.type ? ALL_STAGES.filter((s) => s.type === where.type) : ALL_STAGES),
        ),
      },
      lead: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      leadActivity: { count: jest.fn().mockResolvedValue(0) }, // #574
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmDashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CrmDashboardService);
  });

  describe('funnel', () => {
    it('calcula taxas de conversão entre etapas', async () => {
      // 1º count é o slaEscalations (#569, dispara antes dos awaits do funil);
      // depois: total, responded, reachedProposal, won, lost
      prisma.lead.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(20);
      const overview = await service.overview(range);
      const { funnel } = overview;
      expect(overview.slaEscalations).toBe(3);
      expect(funnel.total).toBe(100);
      expect(funnel.respondedRate).toBe(80);
      expect(funnel.proposalRate).toBe(30);
      expect(funnel.winRate).toBe(12);
    });
  });

  describe('bySource — receita real via Lead→OV', () => {
    it('soma receita só de OV INVOICED e ordena por receita', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockImplementation(({ select }: any) => {
        // primeira chamada (bySource) traz salesOrder; demais retornam []
        if (select?.salesOrder) {
          return Promise.resolve([
            {
              source: 'META_ADS',
              stageId: 's-won',
              salesOrder: {
                status: 'INVOICED',
                items: [{ quantity: D(1), unitPrice: D(15000) }],
              },
            },
            { source: 'META_ADS', stageId: 's-novo', salesOrder: null },
            {
              source: 'MERCADO_LIVRE',
              stageId: 's-won',
              salesOrder: {
                status: 'DRAFT', // não faturada → não conta receita
                items: [{ quantity: D(1), unitPrice: D(9000) }],
              },
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const { bySource } = await service.overview(range);
      const meta = bySource.find((s) => s.source === 'META_ADS')!;
      expect(meta.total).toBe(2);
      expect(meta.won).toBe(1);
      expect(meta.conversionRate).toBe(50);
      expect(meta.revenue).toBe(15000);
      // ML faturamento DRAFT → receita 0, fica depois do Meta
      expect(bySource[0].source).toBe('META_ADS');
      expect(bySource.find((s) => s.source === 'MERCADO_LIVRE')!.revenue).toBe(0);
    });
  });

  describe('bySeller', () => {
    it('média de tempo de 1ª resposta por vendedor', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockImplementation(({ select }: any) => {
        if (select?.assignedTo && !select?.salesOrder) {
          return Promise.resolve([
            {
              assignedToId: 'seller-1',
              createdAt: new Date('2026-06-10T10:00:00Z'),
              firstRespondedAt: new Date('2026-06-10T10:10:00Z'), // 10min
              stageId: 's-won',
              assignedTo: { name: 'João' },
            },
            {
              assignedToId: 'seller-1',
              createdAt: new Date('2026-06-11T10:00:00Z'),
              firstRespondedAt: new Date('2026-06-11T10:20:00Z'), // 20min
              stageId: 's-novo',
              assignedTo: { name: 'João' },
            },
          ]);
        }
        return Promise.resolve([]);
      });
      const { bySeller } = await service.overview(range);
      expect(bySeller[0].name).toBe('João');
      expect(bySeller[0].leads).toBe(2);
      expect(bySeller[0].won).toBe(1);
      expect(bySeller[0].avgFirstResponseMin).toBe(15);
    });
  });

  describe('avgSalesCycleDays (#846)', () => {
    it('média em dias de (invoicedAt da OV − createdAt do lead) no período', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockImplementation(({ select }: any) => {
        // avgSalesCycle: select tem createdAt E salesOrder
        if (select?.createdAt && select?.salesOrder) {
          return Promise.resolve([
            {
              createdAt: new Date('2026-06-01T00:00:00Z'),
              salesOrder: { invoicedAt: new Date('2026-06-11T00:00:00Z') }, // 10 dias
            },
            {
              createdAt: new Date('2026-06-10T00:00:00Z'),
              salesOrder: { invoicedAt: new Date('2026-06-30T00:00:00Z') }, // 20 dias
            },
          ]);
        }
        return Promise.resolve([]);
      });
      const { avgSalesCycleDays } = await service.overview(range);
      expect(avgSalesCycleDays).toBe(15);
    });

    it('null quando nenhum lead faturou no período', async () => {
      prisma.lead.count.mockResolvedValue(0);
      const { avgSalesCycleDays } = await service.overview(range);
      expect(avgSalesCycleDays).toBeNull();
    });
  });

  describe('coolingLeads (#846)', () => {
    it('agrupa por estágio OPEN os leads sem toque além do limite, com nome do estágio', async () => {
      prisma.lead.count.mockResolvedValue(0);
      prisma.lead.findMany.mockImplementation(({ select }: any) => {
        // coolingLeads: select só com stageId
        if (select?.stageId && !select?.createdAt && !select?.salesOrder && !select?.assignedTo) {
          return Promise.resolve([
            { stageId: 's-novo' },
            { stageId: 's-novo' },
            { stageId: 's-prop' },
          ]);
        }
        return Promise.resolve([]);
      });
      const { coolingLeads } = await service.overview(range);
      expect(coolingLeads).toEqual([
        { stageId: 's-novo', stageName: 'Novo', count: 2 },
        { stageId: 's-prop', stageName: 'Proposta', count: 1 },
      ]);
    });

    it('aplica o cutoff = to − coolingDays na query (fallback createdAt quando sem interação)', async () => {
      prisma.lead.count.mockResolvedValue(0);
      let capturedWhere: any;
      prisma.lead.findMany.mockImplementation(({ select, where }: any) => {
        if (select?.stageId && !select?.createdAt && !select?.salesOrder && !select?.assignedTo) {
          capturedWhere = where;
        }
        return Promise.resolve([]);
      });
      await service.overview(range, 7);
      const cutoff = new Date(range.to.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(capturedWhere.OR).toEqual([
        { lastInteractionAt: { lt: cutoff } },
        { lastInteractionAt: null, createdAt: { lt: cutoff } },
      ]);
      expect(capturedWhere.companyId).toBe(COMPANY);
    });
  });

  describe('sourceCsv', () => {
    it('gera CSV com header e linhas', async () => {
      prisma.lead.findMany.mockImplementation(({ select }: any) =>
        select?.salesOrder
          ? Promise.resolve([
              {
                source: 'SITE',
                stageId: 's-won',
                salesOrder: { status: 'INVOICED', items: [{ quantity: D(2), unitPrice: D(500) }] },
              },
            ])
          : Promise.resolve([]),
      );
      const csv = await service.sourceCsv(range);
      expect(csv).toContain('origem;leads;fechados;conversao_%;receita_faturada');
      expect(csv).toContain('SITE;1;1;100;1000.00');
    });
  });
});
