import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SdrDashboardService } from './sdr-dashboard.service';

const COMPANY = 'company-1';
const FROM = new Date('2026-07-01');
const TO = new Date('2026-07-07');

describe('SdrDashboardService (F4.4 #524)', () => {
  let service: SdrDashboardService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      sdrUsage: {
        groupBy: jest.fn().mockResolvedValue([{ leadId: 'l1' }, { leadId: 'l2' }, { leadId: 'l3' }]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { costUsd: 4.2, inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 90000 },
          _count: { _all: 15 },
        }),
      },
      lead: {
        groupBy: jest.fn().mockResolvedValue([
          { sdrStatus: 'HANDOFF', _count: { _all: 2 } },
          { sdrStatus: 'DISCARDED', _count: { _all: 1 } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      leadActivity: {
        findMany: jest.fn().mockResolvedValue([
          {
            happensAt: new Date('2026-07-02T10:30:00Z'),
            properties: { kind: 'sdr_qualification', score: 80 },
            lead: { createdAt: new Date('2026-07-02T10:00:00Z') },
          },
          {
            happensAt: new Date('2026-07-03T09:20:00Z'),
            properties: { kind: 'sdr_qualification', score: 40 },
            lead: { createdAt: new Date('2026-07-03T09:00:00Z') },
          },
        ]),
      },
      pipelineStage: { findFirst: jest.fn().mockResolvedValue({ id: 'stage-novo' }) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SdrDashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(SdrDashboardService);
  });

  it('overview: métricas que respondem "quantos atendeu e quantos passou?" em < 5s', async () => {
    const o = await service.overview(COMPANY, FROM, TO);
    expect(o.attended).toBe(3);
    expect(o.handoffs).toBe(2);
    expect(o.handoffRate).toBeCloseTo(2 / 3);
    expect(o.discards).toBe(1);
    expect(o.qualified).toBe(2);
    expect(o.avgScore).toBe(60);
    expect(o.avgMinutesToQualify).toBe(25); // (30 + 20) / 2
    expect(o.costUsd).toBeCloseTo(4.2);
    // cache hit = cacheRead / (input + cacheRead) — critério #521 > 80%
    expect(o.cacheHitRate).toBeCloseTo(90000 / 100000);
  });

  it('revertDiscard: só lead DISCARDED volta; vira HANDOFF (humano, não IA de novo)', async () => {
    prisma.lead.findFirst.mockResolvedValue({ id: 'l1', sdrStatus: 'DISCARDED' });
    await service.revertDiscard(COMPANY, 'l1', 'manager-1');
    const update = prisma.lead.update.mock.calls[0][0];
    expect(update.data.sdrStatus).toBe('HANDOFF');
    expect(update.data.stageId).toBe('stage-novo');
    expect(update.data.lostReason).toBeNull();
  });

  it('revertDiscard: lead não descartado → 400; de outra loja → 404', async () => {
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'l1', sdrStatus: 'ACTIVE' });
    await expect(service.revertDiscard(COMPANY, 'l1', 'm1')).rejects.toThrow(BadRequestException);
    prisma.lead.findFirst.mockResolvedValueOnce(null);
    await expect(service.revertDiscard(COMPANY, 'lx', 'm1')).rejects.toThrow(NotFoundException);
  });
});
