import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from './push.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');

const PAYLOAD = { title: 'Novo lead', body: 'João', url: '/app/crm/inbox?lead=l1' };

async function makeService(prisma: any): Promise<PushService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [PushService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return module.get(PushService);
}

describe('PushService (CRM V2.1 #568)', () => {
  let prisma: any;

  beforeEach(() => {
    jest.resetAllMocks(); // limpa também a fila de mock*Once entre testes
    process.env.VAPID_PUBLIC_KEY = 'pub-key';
    process.env.VAPID_PRIVATE_KEY = 'priv-key';
    prisma = {
      pushSubscription: {
        upsert: jest.fn(async ({ create }: any) => ({ id: 'sub-1', createdAt: new Date(), ...create })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
  });

  afterAll(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  describe('configuração VAPID', () => {
    it('expõe a chave pública quando configurado', async () => {
      const service = await makeService(prisma);
      expect(service.isEnabled).toBe(true);
      expect(service.getPublicKey()).toEqual({ publicKey: 'pub-key' });
      expect(webpush.setVapidDetails).toHaveBeenCalled();
    });

    it('vira no-op sem as chaves (CRM segue funcionando)', async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const service = await makeService(prisma);
      expect(service.isEnabled).toBe(false);
      expect(service.getPublicKey()).toEqual({ publicKey: null });
      const sent = await service.sendToUser('u1', PAYLOAD);
      expect(sent).toBe(0);
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
      // restaura p/ os demais testes
      process.env.VAPID_PUBLIC_KEY = 'pub-key';
      process.env.VAPID_PRIVATE_KEY = 'priv-key';
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('faz upsert por endpoint (relogin no mesmo aparelho troca o dono)', async () => {
      const service = await makeService(prisma);
      await service.subscribe('u1', {
        endpoint: 'https://push.example/ep1',
        keys: { p256dh: 'k1', auth: 'a1' },
        userAgent: 'Chrome Android',
      });
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://push.example/ep1' },
          create: expect.objectContaining({ userId: 'u1', p256dh: 'k1', auth: 'a1' }),
          update: expect.objectContaining({ userId: 'u1' }),
        }),
      );
    });

    it('opt-out remove só a assinatura do próprio usuário', async () => {
      const service = await makeService(prisma);
      const res = await service.unsubscribe('u1', 'https://push.example/ep1');
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', endpoint: 'https://push.example/ep1' },
      });
      expect(res).toEqual({ deleted: true });
    });
  });

  describe('sendToUser', () => {
    const SUBS = [
      { id: 's1', endpoint: 'ep1', p256dh: 'k1', auth: 'a1' },
      { id: 's2', endpoint: 'ep2', p256dh: 'k2', auth: 'a2' },
    ];

    it('envia pra todos os dispositivos do usuário', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue(SUBS);
      const service = await makeService(prisma);
      const sent = await service.sendToUser('u1', PAYLOAD);
      expect(sent).toBe(2);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        { endpoint: 'ep1', keys: { p256dh: 'k1', auth: 'a1' } },
        JSON.stringify(PAYLOAD),
        expect.objectContaining({ urgency: 'high' }),
      );
    });

    it('410 Gone remove a assinatura morta e segue as demais', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue(SUBS);
      webpush.sendNotification
        .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
        .mockResolvedValueOnce({});
      const service = await makeService(prisma);
      const sent = await service.sendToUser('u1', PAYLOAD);
      expect(sent).toBe(1);
      expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('erro transitório (500) NÃO remove a assinatura nem lança', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([SUBS[0]]);
      webpush.sendNotification.mockRejectedValueOnce(
        Object.assign(new Error('server'), { statusCode: 500 }),
      );
      const service = await makeService(prisma);
      await expect(service.sendToUser('u1', PAYLOAD)).resolves.toBe(0);
      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });

    it('usuário sem assinatura → 0 envios', async () => {
      const service = await makeService(prisma);
      expect(await service.sendToUser('u1', PAYLOAD)).toBe(0);
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
  });
});
