import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';
import { LeadLgpdService, LEAD_LEGAL_BASIS } from './lead-lgpd.service';

const COMPANY = 'company-1';

describe('LeadLgpdService (F3.5-C8 #558)', () => {
  let service: LeadLgpdService;
  let prisma: any;
  let settings: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 'lead-1', phone: '5545999998888', anonymizedAt: null }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      whatsappConversation: { deleteMany: jest.fn() },
      leadActivity: { updateMany: jest.fn() },
      leadReminder: { deleteMany: jest.fn() },
      consentRecord: { create: jest.fn(), updateMany: jest.fn() },
      anonymizationRequest: { create: jest.fn() },
      company: { findMany: jest.fn().mockResolvedValue([{ id: COMPANY }]) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    settings = { get: jest.fn().mockResolvedValue({ leadRetentionDays: 0 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadLgpdService,
        { provide: PrismaService, useValue: prisma },
        { provide: CrmSettingsService, useValue: settings },
      ],
    }).compile();
    service = module.get(LeadLgpdService);
  });

  describe('onLeadCreated (base legal na captação)', () => {
    it('registra ConsentRecord COMMERCIAL com legítimo interesse e telefone como titular', async () => {
      await service.onLeadCreated({ leadId: 'lead-1', companyId: COMPANY, phone: '5545999998888' });
      expect(prisma.consentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: COMPANY,
          subjectType: 'Lead',
          subjectId: 'lead-1',
          document: '5545999998888',
          purpose: 'COMMERCIAL',
          legalBasis: LEAD_LEGAL_BASIS,
        }),
      });
    });

    it('lead sem telefone (pergunta ML) não registra consent', async () => {
      await service.onLeadCreated({ leadId: 'lead-2', companyId: COMPANY, phone: null });
      expect(prisma.consentRecord.create).not.toHaveBeenCalled();
    });

    it('falha no consent NUNCA propaga (não derruba a captação)', async () => {
      prisma.consentRecord.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.onLeadCreated({ leadId: 'lead-1', companyId: COMPANY, phone: '55459' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('anonymizeLead (direito do titular)', () => {
    it('apaga dado pessoal e preserva o esqueleto agregado, numa transação', async () => {
      const res = await service.anonymizeLead(COMPANY, 'lead-1', 'manager-1');
      expect(res.leadId).toBe('lead-1');

      // tudo dentro de UMA transação (all-or-nothing)
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(6);

      const leadUpdate = prisma.lead.update.mock.calls[0][0];
      expect(leadUpdate.data.name).toMatch(/^ANONIMIZADO_/);
      expect(leadUpdate.data.phone).toBeNull();
      expect(leadUpdate.data.email).toBeNull();
      expect(leadUpdate.data.externalRef).toBeNull();
      expect(leadUpdate.data.anonymizedAt).toEqual(expect.any(Date));
      // NÃO toca em source/stage/salesOrder — métricas agregadas preservadas
      expect(leadUpdate.data).not.toHaveProperty('source');
      expect(leadUpdate.data).not.toHaveProperty('stageId');
      expect(leadUpdate.data).not.toHaveProperty('salesOrderId');

      // conversa apagada; timeline mantém tipo/data e perde o conteúdo
      expect(prisma.whatsappConversation.deleteMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-1', companyId: COMPANY },
      });
      expect(prisma.leadActivity.updateMany).toHaveBeenCalled();
      expect(prisma.leadReminder.deleteMany).toHaveBeenCalled();

      // consent revogado + trilha no fluxo LGPD existente
      expect(prisma.consentRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ subjectType: 'Lead', subjectId: 'lead-1' }),
        }),
      );
      expect(prisma.anonymizationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          document: '5545999998888',
          status: 'COMPLETED',
          requestedById: 'manager-1',
          entitiesAffected: { leads: 1, via: 'request' },
        }),
      });
    });

    it('lead já anonimizado → 400; de outra loja → 404', async () => {
      prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1', phone: null, anonymizedAt: new Date() });
      await expect(service.anonymizeLead(COMPANY, 'lead-1', 'm1')).rejects.toThrow(
        BadRequestException,
      );

      prisma.lead.findFirst.mockResolvedValueOnce(null);
      await expect(service.anonymizeLead(COMPANY, 'lead-x', 'm1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredLostLeads (retenção)', () => {
    it('retenção 0 (default) = desligado, não varre nada', async () => {
      const n = await service.purgeExpiredLostLeads();
      expect(n).toBe(0);
      expect(prisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('anonimiza só PERDIDOS parados além da retenção, marcando via retention', async () => {
      settings.get.mockResolvedValue({ leadRetentionDays: 90 });
      prisma.lead.findMany
        .mockResolvedValueOnce([{ id: 'lead-old' }]) // varredura do expurgo
        .mockResolvedValue([]);
      prisma.lead.findFirst.mockResolvedValue({ id: 'lead-old', phone: '5545888887777', anonymizedAt: null });

      const n = await service.purgeExpiredLostLeads();
      expect(n).toBe(1);

      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.stage).toEqual({ type: 'LOST' });
      expect(where.anonymizedAt).toBeNull();
      expect(where.updatedAt.lt).toEqual(expect.any(Date));

      // trilha marca origem "retention" e sem requestedById (é o sistema)
      expect(prisma.anonymizationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestedById: null,
          entitiesAffected: { leads: 1, via: 'retention' },
        }),
      });
    });

    it('falha num lead não interrompe o expurgo da company', async () => {
      settings.get.mockResolvedValue({ leadRetentionDays: 30 });
      prisma.lead.findMany.mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }]);
      prisma.lead.findFirst
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValueOnce({ id: 'l2', phone: null, anonymizedAt: null });
      const n = await service.purgeExpiredLostLeads();
      expect(n).toBe(1); // l2 seguiu apesar do l1 falhar
    });
  });
});
