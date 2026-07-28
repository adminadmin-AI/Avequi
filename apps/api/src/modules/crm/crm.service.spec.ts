import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmService } from './crm.service';

const COMPANY = 'company-1';

describe('CrmService', () => {
  let service: CrmService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      whatsappConversation: { findMany: jest.fn().mockResolvedValue([]) },
      lead: { findFirst: jest.fn(), update: jest.fn() },
      pipelineStage: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    events = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'sk-ant-test') } },
      ],
    }).compile();
    service = module.get(CrmService);
  });

  describe('listConversations', () => {
    it('scope=mine filtra pelos leads do vendedor; janela calculada', async () => {
      prisma.whatsappConversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          leadId: 'lead-1',
          unreadCount: 2,
          lastMessageAt: new Date(),
          windowExpiresAt: new Date(Date.now() + 3600_000),
          lead: { id: 'lead-1', name: 'João' },
          messages: [
            {
              direction: 'IN',
              type: 'TEXT',
              text: 'Quero um reboque',
              status: 'DELIVERED',
              createdAt: new Date(),
            },
          ],
        },
      ]);
      const result = await service.listConversations(COMPANY, {
        scope: 'mine',
        userId: 'seller-1',
      });
      const where = prisma.whatsappConversation.findMany.mock.calls[0][0].where;
      expect(where.lead.assignedToId).toBe('seller-1');
      expect(result[0].windowOpen).toBe(true);
      expect(result[0].lastMessage?.preview).toBe('Quero um reboque');
    });

    it('busca por telefone normaliza dígitos', async () => {
      await service.listConversations(COMPANY, {
        scope: 'all',
        search: '(45) 99999',
        userId: 'u1',
      });
      const where = prisma.whatsappConversation.findMany.mock.calls[0][0].where;
      expect(where.lead.OR[1].phone.contains).toBe('4599999');
    });
  });

  describe('changeStage', () => {
    beforeEach(() => {
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-1', stageId: 'stage-novo' });
      prisma.lead.update.mockResolvedValue({ id: 'lead-1' });
    });

    it('muda estágio com atividade STAGE_CHANGE e evento', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-prop',
        name: 'Proposta',
        type: 'OPEN',
      });
      await service.changeStage(COMPANY, 'lead-1', 'stage-prop', 'seller-1');
      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.stageId).toBe('stage-prop');
      expect(data.activities.create.type).toBe('STAGE_CHANGE');
      expect(data.activities.create.actorId).toBe('seller-1');
      expect(events.emit).toHaveBeenCalledWith(
        'crm.lead.stage_changed',
        expect.objectContaining({ toStageId: 'stage-prop' }),
      );
    });

    it('mover para Perdido SEM categoria → 400 (#570: categoria é o obrigatório)', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        name: 'Perdido',
        type: 'LOST',
      });
      await expect(
        service.changeStage(COMPANY, 'lead-1', 'stage-lost', 'seller-1', 'texto sem categoria'),
      ).rejects.toThrow(/exige a categoria/);
    });

    it('Perdido com categoria grava lostReasonCategory + texto opcional', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        name: 'Perdido',
        type: 'LOST',
      });
      await service.changeStage(
        COMPANY,
        'lead-1',
        'stage-lost',
        'seller-1',
        'achou caro na concorrência',
        'PRECO' as any,
      );
      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.lostReasonCategory).toBe('PRECO');
      expect(data.lostReason).toBe('achou caro na concorrência');
    });

    it('Perdido só com categoria (sem texto) passa — texto é opcional (#570)', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-lost',
        name: 'Perdido',
        type: 'LOST',
      });
      await service.changeStage(COMPANY, 'lead-1', 'stage-lost', 'seller-1', undefined, 'SEM_RESPOSTA' as any);
      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.lostReasonCategory).toBe('SEM_RESPOSTA');
      expect(data.lostReason).toBeNull();
    });

    it('sair de Perdido limpa categoria e texto', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue({
        id: 'stage-open',
        name: 'Negociação',
        type: 'OPEN',
      });
      await service.changeStage(COMPANY, 'lead-1', 'stage-open', 'seller-1');
      const data = prisma.lead.update.mock.calls[0][0].data;
      expect(data.lostReasonCategory).toBeNull();
      expect(data.lostReason).toBeNull();
    });

    it('estágio de outra loja → 400 (tenancy)', async () => {
      prisma.pipelineStage.findFirst.mockResolvedValue(null);
      await expect(
        service.changeStage(COMPANY, 'lead-1', 'stage-alheio', 'seller-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('lead inexistente → 404', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      prisma.pipelineStage.findFirst.mockResolvedValue({ id: 's', type: 'OPEN', name: 'x' });
      await expect(
        service.changeStage(COMPANY, 'lead-x', 's', 'seller-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('getLead: lead de outra company → 404', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    await expect(service.getLead(COMPANY, 'lead-x')).rejects.toThrow(NotFoundException);
  });
});
