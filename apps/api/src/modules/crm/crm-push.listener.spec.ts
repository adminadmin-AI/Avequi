import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../notification/push.service';
import { CrmPushListener } from './crm-push.listener';

const LEAD = { name: 'João', phone: '5545999998888', interest: 'reboque 2 jets', source: 'WHATSAPP' };

describe('CrmPushListener (CRM V2.1 #568)', () => {
  let listener: CrmPushListener;
  let prisma: any;
  let push: { isEnabled: boolean; sendToUser: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: { findUnique: jest.fn().mockResolvedValue(LEAD) },
      whatsappConversation: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      whatsappMessage: { findFirst: jest.fn() },
    };
    push = { isEnabled: true, sendToUser: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmPushListener,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    listener = module.get(CrmPushListener);
  });

  describe('lead novo / reatribuído', () => {
    it('push pro vendedor do rodízio com deep link da conversa', async () => {
      await listener.onLeadCreated({ leadId: 'l1', assignedToId: 'seller-1' });
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({
          title: expect.stringContaining('João'),
          url: '/app/crm/inbox?lead=l1',
        }),
      );
    });

    it('lead sem dono (triagem da matriz) NÃO dispara push', async () => {
      await listener.onLeadCreated({ leadId: 'l1', assignedToId: null });
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('reatribuição avisa o NOVO dono', async () => {
      await listener.onLeadReassigned({ leadId: 'l1', toUserId: 'seller-2' });
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-2',
        expect.objectContaining({ url: '/app/crm/inbox?lead=l1' }),
      );
    });

    it('erro no push nunca propaga (captação não pode quebrar)', async () => {
      push.sendToUser.mockRejectedValueOnce(new Error('boom'));
      await expect(listener.onLeadCreated({ leadId: 'l1', assignedToId: 's1' })).resolves.toBeUndefined();
    });
  });

  describe('handoff do SDR e lembrete', () => {
    it('handoff da IA → push "lead quente" pro vendedor', async () => {
      await listener.onSdrHandoff({ leadId: 'l1', toUserId: 'seller-1', motivo: 'quer fechar hoje' });
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({ title: expect.stringContaining('IA'), body: 'quer fechar hoje' }),
      );
    });

    it('handoff sem vendedor não dispara', async () => {
      await listener.onSdrHandoff({ leadId: 'l1', toUserId: null, motivo: 'x' });
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('lembrete vencido → push pro dono do lembrete', async () => {
      await listener.onReminderDue({ leadId: 'l1', userId: 'seller-1', text: 'ligar 14h', leadLabel: 'João' });
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({ title: expect.stringContaining('ligar 14h') }),
      );
    });
  });

  describe('cutucada de cliente sem resposta (cron 2min)', () => {
    const MIN = 60_000;
    const conv = (over: any = {}) => ({
      id: 'c1',
      pushNudgedAt: null,
      lastCustomerMessageAt: new Date(Date.now() - 5 * MIN),
      lead: { id: 'l1', name: 'João', phone: null, assignedToId: 'seller-1' },
      ...over,
    });

    it('push desativado → não consulta nada', async () => {
      (push as any).isEnabled = false;
      expect(await listener.nudgeUnanswered()).toBe(0);
      expect(prisma.whatsappConversation.findMany).not.toHaveBeenCalled();
    });

    it('cliente esperando >2min → 1 push e marca pushNudgedAt', async () => {
      prisma.whatsappConversation.findMany.mockResolvedValue([conv()]);
      prisma.whatsappMessage.findFirst
        .mockResolvedValueOnce(null) // sem OUT: vendedor nunca respondeu
        .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 5 * MIN), text: 'Oi, tem carretinha?' });

      expect(await listener.nudgeUnanswered()).toBe(1);
      expect(push.sendToUser).toHaveBeenCalledWith(
        'seller-1',
        expect.objectContaining({ body: expect.stringContaining('carretinha'), url: '/app/crm/inbox?lead=l1' }),
      );
      expect(prisma.whatsappConversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { pushNudgedAt: expect.any(Date) },
      });
    });

    it('anti-spam: já cutucado nesta janela → não repete', async () => {
      const firstPendingAt = new Date(Date.now() - 10 * MIN);
      prisma.whatsappConversation.findMany.mockResolvedValue([
        conv({ pushNudgedAt: new Date(Date.now() - 8 * MIN) }), // depois da 1ª msg pendente
      ]);
      prisma.whatsappMessage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ createdAt: firstPendingAt, text: 'oi' });

      expect(await listener.nudgeUnanswered()).toBe(0);
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('vendedor respondeu (nenhuma msg IN pendente) → não cutuca', async () => {
      prisma.whatsappConversation.findMany.mockResolvedValue([conv()]);
      prisma.whatsappMessage.findFirst
        .mockResolvedValueOnce({ createdAt: new Date() }) // último OUT recente
        .mockResolvedValueOnce(null); // nada de IN depois dele

      expect(await listener.nudgeUnanswered()).toBe(0);
      expect(push.sendToUser).not.toHaveBeenCalled();
    });

    it('janela nova depois da resposta → cutuca de novo (pushNudgedAt antigo)', async () => {
      prisma.whatsappConversation.findMany.mockResolvedValue([
        conv({ pushNudgedAt: new Date(Date.now() - 60 * MIN) }), // aviso da janela anterior
      ]);
      prisma.whatsappMessage.findFirst
        .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 30 * MIN) }) // OUT antigo
        .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 5 * MIN), text: 'e o prazo?' });

      expect(await listener.nudgeUnanswered()).toBe(1);
    });

    it('msg pendente ainda dentro dos 2min → aguarda próximo ciclo', async () => {
      prisma.whatsappConversation.findMany.mockResolvedValue([conv()]);
      prisma.whatsappMessage.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ createdAt: new Date(Date.now() - 1 * MIN), text: 'oi' });

      expect(await listener.nudgeUnanswered()).toBe(0);
    });
  });
});
