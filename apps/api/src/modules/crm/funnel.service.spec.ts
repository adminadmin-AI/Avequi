import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FunnelService } from './funnel.service';

const COMPANY = 'company-1';
const D = (n: number) => new Prisma.Decimal(n);

describe('FunnelService', () => {
  let service: FunnelService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      pipelineStage: { findMany: jest.fn(), findFirst: jest.fn() },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'lead-1' }),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      systemParameter: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    events = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunnelService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    service = module.get(FunnelService);
  });

  describe('board', () => {
    it('agrupa leads por coluna com contadores e soma de valor', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([
        { id: 's1', name: 'Novo', type: 'OPEN', order: 0 },
        { id: 's2', name: 'Proposta', type: 'OPEN', order: 1 },
      ]);
      prisma.lead.findMany.mockResolvedValue([
        { id: 'l1', stageId: 's1', position: D(1000), estimatedValue: D(5000), conversation: null },
        { id: 'l2', stageId: 's1', position: D(2000), estimatedValue: D(3000), conversation: { unreadCount: 2, windowExpiresAt: new Date(Date.now() + 3600_000) } },
        { id: 'l3', stageId: null, position: D(0), estimatedValue: null, conversation: null },
      ]);
      const board = await service.board({ companyId: COMPANY });
      expect(board.columns[0].count).toBe(2);
      expect(board.columns[0].totalValue).toBe(8000);
      expect(board.columns[0].leads[1].unreadCount).toBe(2);
      expect(board.columns[0].leads[1].windowOpen).toBe(true);
      expect(board.unstaged).toHaveLength(1);
    });
  });

  describe('moveLead — position (padrão Twenty)', () => {
    beforeEach(() => {
      prisma.lead.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === 'lead-move') return Promise.resolve({ id: 'lead-move', stageId: 's-old' });
        if (where.id === 'before') return Promise.resolve({ position: D(1000) });
        if (where.id === 'after') return Promise.resolve({ position: D(2000) });
        return Promise.resolve(null);
      });
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's-new', name: 'Proposta', type: 'OPEN' });
    });

    it('entre dois vizinhos → média das posições', async () => {
      await service.moveLead(COMPANY, 'lead-move', { stageId: 's-new', beforeLeadId: 'before', afterLeadId: 'after' }, 'u1');
      const pos = prisma.lead.update.mock.calls[0][0].data.position;
      expect(Number(pos)).toBe(1500);
    });

    it('no topo (só after) → after - gap', async () => {
      await service.moveLead(COMPANY, 'lead-move', { stageId: 's-new', afterLeadId: 'after' }, 'u1');
      expect(Number(prisma.lead.update.mock.calls[0][0].data.position)).toBe(1000);
    });

    it('coluna vazia → max + gap', async () => {
      prisma.lead.aggregate.mockResolvedValue({ _max: { position: D(5000) } });
      await service.moveLead(COMPANY, 'lead-move', { stageId: 's-new' }, 'u1');
      expect(Number(prisma.lead.update.mock.calls[0][0].data.position)).toBe(6000);
    });

    it('mudança de estágio emite evento e cria STAGE_CHANGE', async () => {
      await service.moveLead(COMPANY, 'lead-move', { stageId: 's-new' }, 'u1');
      expect(prisma.lead.update.mock.calls[0][0].data.activities.create.type).toBe('STAGE_CHANGE');
      expect(events.emit).toHaveBeenCalledWith('crm.lead.stage_changed', expect.any(Object));
    });

    it('reordenar dentro do MESMO estágio não emite evento nem atividade', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's-old', name: 'Novo', type: 'OPEN' });
      await service.moveLead(COMPANY, 'lead-move', { stageId: 's-old' }, 'u1');
      expect(prisma.lead.update.mock.calls[0][0].data.activities).toBeUndefined();
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('mover para Perdido sem motivo → 400', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's-lost', name: 'Perdido', type: 'LOST' });
      await expect(
        service.moveLead(COMPANY, 'lead-move', { stageId: 's-lost' }, 'u1'),
      ).rejects.toThrow(/exige o motivo/);
    });

    it('estágio de outra loja → 400', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue(null);
      await expect(
        service.moveLead(COMPANY, 'lead-move', { stageId: 'x' }, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('slaPanel', () => {
    it('separa leads estourando (sem 1ª resposta) e esfriando', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([{ id: 'open-1' }]);
      prisma.lead.findMany
        .mockResolvedValueOnce([
          { id: 'b1', name: 'X', createdAt: new Date(Date.now() - 30 * 60_000), assignedTo: null },
        ])
        .mockResolvedValueOnce([
          {
            id: 'c1',
            name: 'Y',
            lastInteractionAt: new Date(Date.now() - 30 * 3600_000),
            stage: { name: 'Proposta' },
            assignedTo: null,
          },
        ]);
      const panel = await service.slaPanel(COMPANY);
      expect(panel.slaMinutes).toBe(15);
      expect(panel.breaching[0].waitingMinutes).toBeGreaterThanOrEqual(29);
      expect(panel.cooling[0].idleHours).toBeGreaterThanOrEqual(29);
    });

    it('respeita SLA configurado por company', async () => {
      prisma.systemParameter.findFirst.mockImplementation(({ where }: any) =>
        where.key === 'CRM_SLA_FIRST_RESPONSE_MIN'
          ? Promise.resolve({ value: '30' })
          : Promise.resolve(null),
      );
      prisma.pipelineStage.findMany.mockResolvedValue([{ id: 'open-1' }]);
      const panel = await service.slaPanel(COMPANY);
      expect(panel.slaMinutes).toBe(30);
    });
  });

  describe('lostReasons', () => {
    it('agrega motivos ordenados por contagem', async () => {
      prisma.pipelineStage.findMany.mockResolvedValue([{ id: 'lost-1' }]);
      prisma.lead.groupBy.mockResolvedValue([
        { lostReason: 'preço', _count: { _all: 8 } },
        { lostReason: 'prazo', _count: { _all: 3 } },
      ]);
      const result = await service.lostReasons(COMPANY);
      expect(result[0]).toEqual({ reason: 'preço', count: 8 });
    });
  });
});
