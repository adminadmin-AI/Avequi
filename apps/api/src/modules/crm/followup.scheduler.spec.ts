import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmSettingsService } from './crm-settings.service';
import { FollowupScheduler } from './followup.scheduler';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappTemplateService } from './whatsapp/template.service';

const COMPANY = 'company-1';

describe('FollowupScheduler (F3.5-C4 #554)', () => {
  let scheduler: FollowupScheduler;
  let prisma: any;
  let settings: { get: jest.Mock };
  let whatsapp: { send: jest.Mock };
  let templates: { sendTemplate: jest.Mock };

  const baseCfg = {
    autoFollowupEnabled: true,
    autoFollowupStageId: 's-prop',
    autoFollowupHours: 48,
    autoFollowupTemplate: 'reengaja',
  };

  beforeEach(async () => {
    prisma = {
      company: { findMany: jest.fn().mockResolvedValue([{ id: COMPANY }]) },
      lead: { findMany: jest.fn().mockResolvedValue([]) },
      leadActivity: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    settings = { get: jest.fn().mockResolvedValue(baseCfg) };
    whatsapp = { send: jest.fn().mockResolvedValue({}) };
    templates = { sendTemplate: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowupScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: CrmSettingsService, useValue: settings },
        { provide: WhatsappService, useValue: whatsapp },
        { provide: WhatsappTemplateService, useValue: templates },
      ],
    }).compile();
    scheduler = module.get(FollowupScheduler);
  });

  it('desligado → não faz nada', async () => {
    settings.get.mockResolvedValue({ ...baseCfg, autoFollowupEnabled: false });
    await scheduler.run();
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });

  it('janela ABERTA → mensagem livre', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-1', name: 'João Silva', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() + 3600_000) } },
    ]);
    await scheduler.run();
    expect(whatsapp.send).toHaveBeenCalledWith(
      COMPANY,
      'lead-1',
      expect.objectContaining({ text: expect.stringContaining('João') }),
      'AUTO_FOLLOWUP',
    );
    expect(templates.sendTemplate).not.toHaveBeenCalled();
    // marca anti-spam
    expect(prisma.leadActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: 'AUTO_FOLLOWUP', properties: expect.objectContaining({ kind: 'auto_followup', stageId: 's-prop' }) }),
      }),
    );
  });

  it('janela FECHADA → template aprovado', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-2', name: 'Maria', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() - 1000) } },
    ]);
    await scheduler.run();
    expect(templates.sendTemplate).toHaveBeenCalledWith(COMPANY, 'lead-2', 'reengaja', ['Maria'], 'AUTO_FOLLOWUP');
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('anti-spam: já teve follow-up automático NESTE estágio → pula', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-3', name: 'Ana', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() + 3600_000) } },
    ]);
    prisma.leadActivity.findFirst.mockResolvedValue({ properties: { stageId: 's-prop', kind: 'auto_followup' } });
    await scheduler.run();
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(templates.sendTemplate).not.toHaveBeenCalled();
  });

  it('follow-up anterior em OUTRO estágio → dispara de novo', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-4', name: 'Bia', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() + 3600_000) } },
    ]);
    prisma.leadActivity.findFirst.mockResolvedValue({ properties: { stageId: 's-outro' } });
    await scheduler.run();
    expect(whatsapp.send).toHaveBeenCalled();
  });

  it('janela fechada e SEM template configurado → não envia', async () => {
    settings.get.mockResolvedValue({ ...baseCfg, autoFollowupTemplate: null });
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-5', name: 'Léo', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() - 1000) } },
    ]);
    await scheduler.run();
    expect(templates.sendTemplate).not.toHaveBeenCalled();
    expect(prisma.leadActivity.create).not.toHaveBeenCalled();
  });

  it('falha em 1 lead não derruba a varredura dos demais', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { id: 'lead-a', name: 'A', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() + 3600_000) } },
      { id: 'lead-b', name: 'B', stageId: 's-prop', conversation: { windowExpiresAt: new Date(Date.now() + 3600_000) } },
    ]);
    whatsapp.send.mockRejectedValueOnce(new Error('meta down')).mockResolvedValueOnce({});
    await scheduler.run();
    expect(whatsapp.send).toHaveBeenCalledTimes(2);
  });
});
