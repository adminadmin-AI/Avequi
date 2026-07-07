import { Test, TestingModule } from '@nestjs/testing';
import { AlertType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notification/push.service';
import { CrmSettingsService } from './crm-settings.service';
import { LeadIntakeService } from './lead-intake.service';
import { SlaEscalationScheduler, SLA_ACTOR } from './sla-escalation.scheduler';

const COMPANY = 'company-1';
const MIN = 60_000;

const SETTINGS = {
  slaFirstResponseMin: 15,
  slaEscalationEnabled: true,
  slaEscalationFactor: 2,
  sdrSchedule: '24_7' as const,
};

function lead(over: any = {}) {
  return {
    id: 'l1',
    name: 'João',
    phone: '5545999998888',
    createdAt: new Date(Date.now() - 20 * MIN), // 20min > SLA 15min
    slaWarnedAt: null,
    slaEscalatedAt: null,
    assignedToId: 'seller-1',
    assignedTo: { id: 'seller-1', name: 'Carlos' },
    ...over,
  };
}

describe('SlaEscalationScheduler (CRM V2.2 #569)', () => {
  let scheduler: SlaEscalationScheduler;
  let prisma: any;
  let settings: { get: jest.Mock };
  let intake: { pickNextSeller: jest.Mock; reassign: jest.Mock };
  let push: { sendToUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      systemParameter: {
        findMany: jest.fn().mockResolvedValue([{ companyId: COMPANY }]),
      },
      pipelineStage: {
        findMany: jest.fn().mockResolvedValue([{ id: 'stage-open' }]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      alert: { create: jest.fn().mockResolvedValue({}) },
    };
    settings = { get: jest.fn().mockResolvedValue({ ...SETTINGS }) };
    intake = {
      pickNextSeller: jest.fn().mockResolvedValue('seller-2'),
      reassign: jest.fn().mockResolvedValue({}),
    };
    push = { sendToUser: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaEscalationScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: CrmSettingsService, useValue: settings },
        { provide: LeadIntakeService, useValue: intake },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    scheduler = module.get(SlaEscalationScheduler);
  });

  afterEach(() => jest.useRealTimers());

  describe('gate por loja', () => {
    it('só varre lojas com CRM_SLA_ESCALATION_ENABLED=true', async () => {
      prisma.systemParameter.findMany.mockResolvedValue([]);
      const res = await scheduler.run();
      expect(res).toEqual({ warned: 0, escalated: 0 });
      expect(settings.get).not.toHaveBeenCalled();
    });

    it('loja OFF_HOURS fora do expediente (IA atendendo) → régua pausada', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-11T15:00:00-03:00')); // sábado
      settings.get.mockResolvedValue({ ...SETTINGS, sdrSchedule: 'OFF_HOURS' });
      const res = await scheduler.runForCompany(COMPANY);
      expect(res).toEqual({ warned: 0, escalated: 0 });
      expect(prisma.lead.findMany).not.toHaveBeenCalled();
    });

    it('exclusões na varredura: com vendedor, sem SDR ativo, não anonimizado', async () => {
      await scheduler.runForCompany(COMPANY);
      expect(prisma.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignedToId: { not: null },
            anonymizedAt: null,
            firstRespondedAt: null,
            sdrStatus: { notIn: ['ACTIVE', 'QUALIFIED'] },
            slaEscalatedAt: null,
          }),
        }),
      );
    });
  });

  describe('nível 1 — SLA x1 avisa o vendedor (1x)', () => {
    it('push + Alert + activity sla_warning + marca slaWarnedAt', async () => {
      prisma.lead.findMany.mockResolvedValue([lead()]);
      const res = await scheduler.runForCompany(COMPANY);

      expect(res).toEqual({ warned: 1, escalated: 0 });
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l1' },
          data: expect.objectContaining({
            slaWarnedAt: expect.any(Date),
            activities: {
              create: expect.objectContaining({
                actorId: SLA_ACTOR,
                properties: expect.objectContaining({ kind: 'sla_warning' }),
              }),
            },
          }),
        }),
      );
      expect(prisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: AlertType.CRM_SLA_WARNING, entityId: 'l1' }),
        }),
      );
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({ url: '/app/crm/inbox?lead=l1' }),
      );
      expect(intake.reassign).not.toHaveBeenCalled();
    });

    it('já avisado → não repica', async () => {
      prisma.lead.findMany.mockResolvedValue([
        lead({ slaWarnedAt: new Date(Date.now() - 4 * MIN) }),
      ]);
      const res = await scheduler.runForCompany(COMPANY);
      expect(res).toEqual({ warned: 0, escalated: 0 });
      expect(push.sendToUser).not.toHaveBeenCalled();
      expect(prisma.alert.create).not.toHaveBeenCalled();
    });
  });

  describe('nível 2 — SLA x2 realoca no rodízio (1x)', () => {
    const OLD = new Date(Date.now() - 35 * MIN); // 35min > 15 * 2

    it('REUSA LeadIntakeService.reassign excluindo quem perdeu + Alert CRITICAL pro gerente', async () => {
      prisma.lead.findMany.mockResolvedValue([lead({ createdAt: OLD, slaWarnedAt: new Date() })]);
      const res = await scheduler.runForCompany(COMPANY);

      expect(res).toEqual({ warned: 0, escalated: 1 });
      expect(intake.pickNextSeller).toHaveBeenCalledWith(COMPANY, 'seller-1');
      expect(intake.reassign).toHaveBeenCalledWith(COMPANY, 'l1', 'seller-2', SLA_ACTOR);
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slaEscalatedAt: expect.any(Date),
            activities: {
              create: expect.objectContaining({
                properties: expect.objectContaining({ kind: 'sla_escalation' }),
              }),
            },
          }),
        }),
      );
      const alertArg = prisma.alert.create.mock.calls[0][0].data;
      expect(alertArg.type).toBe(AlertType.CRM_SLA_ESCALATION);
      expect(alertArg.severity).toBe('CRITICAL');
      expect(alertArg.body).toContain('Carlos'); // gerente vê QUEM perdeu o lead
    });

    it('sem outro vendedor disponível → marca 1x, avisa o gerente e NÃO realoca', async () => {
      intake.pickNextSeller.mockResolvedValue(null);
      prisma.lead.findMany.mockResolvedValue([lead({ createdAt: OLD })]);
      const res = await scheduler.runForCompany(COMPANY);

      expect(res).toEqual({ warned: 0, escalated: 1 });
      expect(intake.reassign).not.toHaveBeenCalled();
      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slaEscalatedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.alert.create.mock.calls[0][0].data.title).toContain('sem realocação');
    });

    it('lead que estourou 2x direto (nunca avisado) vai pro nível 2, não pro 1', async () => {
      prisma.lead.findMany.mockResolvedValue([lead({ createdAt: OLD })]);
      const res = await scheduler.runForCompany(COMPANY);
      expect(res).toEqual({ warned: 0, escalated: 1 });
      expect(push.sendToUser).not.toHaveBeenCalled(); // push do nível 2 vem do reassign (#568)
    });
  });

  describe('run() agregado', () => {
    it('processa cada loja habilitada e soma os totais', async () => {
      prisma.systemParameter.findMany.mockResolvedValue([
        { companyId: 'c1' },
        { companyId: 'c2' },
      ]);
      prisma.lead.findMany.mockResolvedValue([lead()]);
      const res = await scheduler.run();
      expect(res).toEqual({ warned: 2, escalated: 0 });
      expect(settings.get).toHaveBeenCalledTimes(2);
    });

    it('falha numa loja não derruba as demais', async () => {
      prisma.systemParameter.findMany.mockResolvedValue([
        { companyId: 'c1' },
        { companyId: 'c2' },
      ]);
      settings.get
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ ...SETTINGS });
      prisma.lead.findMany.mockResolvedValue([lead()]);
      const res = await scheduler.run();
      expect(res).toEqual({ warned: 1, escalated: 0 });
    });
  });
});
