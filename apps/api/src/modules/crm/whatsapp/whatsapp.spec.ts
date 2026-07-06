import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, WaMessageStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadIntakeService } from '../lead-intake.service';
import { WhatsappWebhookProcessor } from './whatsapp-webhook.processor';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_QUEUE } from './whatsapp.types';
import { getQueueToken } from '@nestjs/bull';

const COMPANY = 'company-1';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const makeConfig = (over: Record<string, string | undefined> = {}) => ({
  get: jest.fn((key: string) => {
    const defaults: Record<string, string> = {
      WHATSAPP_ACCESS_TOKEN: 'token-meta',
      WHATSAPP_APP_SECRET: 'app-secret',
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
    };
    return key in over ? over[key] : defaults[key];
  }),
});

const inboundBody = (over: any = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { phone_number_id: 'pnid-cascavel' },
            contacts: [{ wa_id: '5545999998888', profile: { name: 'João Cliente' } }],
            messages: [
              {
                id: 'wamid.001',
                from: '5545999998888',
                timestamp: '1751800000',
                type: 'text',
                text: { body: 'Oi, quero um reboque pra 2 jet skis' },
              },
            ],
            ...over,
          },
        },
      ],
    },
  ],
});

describe('WhatsappWebhookProcessor', () => {
  let processor: WhatsappWebhookProcessor;
  let prisma: any;
  let intake: { intake: jest.Mock };
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      company: { findUnique: jest.fn().mockResolvedValue({ id: COMPANY }) },
      whatsappConversation: {
        upsert: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      },
      whatsappMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      lead: { update: jest.fn() },
    };
    intake = {
      intake: jest.fn().mockResolvedValue({
        lead: { id: 'lead-1', companyId: COMPANY, assignedToId: 'seller-1' },
        created: true,
      }),
    };
    events = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappWebhookProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: LeadIntakeService, useValue: intake },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    processor = module.get(WhatsappWebhookProcessor);
  });

  it('mensagem de número desconhecido vira lead via intake + conversa com janela 24h', async () => {
    await processor.handleInbound({ data: { body: inboundBody() } } as any);

    expect(intake.intake).toHaveBeenCalledWith(COMPANY, {
      phone: '5545999998888',
      name: 'João Cliente',
      source: 'WHATSAPP',
    });
    const upsert = prisma.whatsappConversation.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ leadId: 'lead-1' });
    const expectedWindow = new Date(1751800000 * 1000 + 24 * 3600 * 1000);
    expect(upsert.create.windowExpiresAt).toEqual(expectedWindow);
    expect(upsert.update.unreadCount).toEqual({ increment: 1 });
    expect(prisma.whatsappMessage.create.mock.calls[0][0].data.waMessageId).toBe('wamid.001');
    expect(events.emit).toHaveBeenCalledWith(
      'crm.whatsapp.message_received',
      expect.objectContaining({ leadId: 'lead-1' }),
    );
  });

  it('retry da Meta (mesmo wamid) não duplica mensagem nem timeline', async () => {
    prisma.whatsappMessage.create.mockRejectedValue(p2002());
    await processor.handleInbound({ data: { body: inboundBody() } } as any);
    expect(prisma.lead.update).not.toHaveBeenCalled(); // sem atividade duplicada
  });

  it('phone_number_id desconhecido é ignorado (não cria lead em loja errada)', async () => {
    prisma.company.findUnique.mockResolvedValue(null);
    await processor.handleInbound({ data: { body: inboundBody() } } as any);
    expect(intake.intake).not.toHaveBeenCalled();
  });

  it('status delivered/read atualiza mensagem respeitando ordem', async () => {
    prisma.whatsappMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      status: WaMessageStatus.READ,
    });
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [{ id: 'wamid.out1', status: 'delivered', timestamp: '1751800100' }],
              },
            },
          ],
        },
      ],
    };
    await processor.handleInbound({ data: { body } } as any);
    // delivered chegou DEPOIS de read → não regride
    expect(prisma.whatsappMessage.update).not.toHaveBeenCalled();

    prisma.whatsappMessage.findUnique.mockResolvedValue({
      id: 'msg-1',
      status: WaMessageStatus.SENT,
    });
    await processor.handleInbound({ data: { body } } as any);
    expect(prisma.whatsappMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERED' }) }),
    );
  });

  it('mídia recebida guarda waMediaId p/ o proxy sob demanda', async () => {
    const body = inboundBody({
      messages: [
        {
          id: 'wamid.audio1',
          from: '5545999998888',
          type: 'audio',
          audio: { id: 'media-123', mime_type: 'audio/ogg', voice: true },
        },
      ],
    });
    await processor.handleInbound({ data: { body } } as any);
    const data = prisma.whatsappMessage.create.mock.calls[0][0].data;
    expect(data.waMediaId).toBe('media-123');
    expect(data.type).toBe('AUDIO');
  });
});

describe('WhatsappService.send', () => {
  let service: WhatsappService;
  let prisma: any;
  let http: { post: jest.Mock; get: jest.Mock };

  const openConversation = () => ({
    id: 'conv-1',
    companyId: COMPANY,
    leadId: 'lead-1',
    waContactId: '5545999998888',
    windowExpiresAt: new Date(Date.now() + 3600_000),
    lead: { id: 'lead-1', firstRespondedAt: null },
  });

  beforeEach(async () => {
    prisma = {
      whatsappConversation: {
        findFirst: jest.fn().mockResolvedValue(openConversation()),
        update: jest.fn(),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ waPhoneNumberId: 'pnid-cascavel' }),
      },
      whatsappMessage: { create: jest.fn().mockReturnValue({ id: 'out-1' }) },
      lead: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([{ id: 'out-1' }]),
    };
    http = {
      post: jest.fn().mockReturnValue(of({ data: { messages: [{ id: 'wamid.out9' }] } })),
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(WhatsappService);
  });

  it('envia texto livre dentro da janela e marca firstRespondedAt', async () => {
    await service.send(COMPANY, 'lead-1', { text: 'Temos sim! Modelo MOD-CAR-2000' }, 'seller-1');

    const [url, payload] = http.post.mock.calls[0];
    expect(url).toContain('/pnid-cascavel/messages');
    expect(payload.text.body).toContain('MOD-CAR-2000');
    // transação: mensagem OUT + conversa + lead (firstRespondedAt na primeira resposta)
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('janela de 24h expirada → 400 orientando template (nunca envia)', async () => {
    prisma.whatsappConversation.findFirst.mockResolvedValue({
      ...openConversation(),
      windowExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.send(COMPANY, 'lead-1', { text: 'oi' }, 'seller-1'),
    ).rejects.toThrow(/Janela de 24h expirada/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('erro da Meta vira 400 com detalhe (sem gravar mensagem)', async () => {
    http.post.mockReturnValue(
      throwError(() => ({
        response: { data: { error: { message: 'Recipient not available' } } },
        message: 'Request failed',
      })),
    );
    await expect(
      service.send(COMPANY, 'lead-1', { text: 'oi' }, 'seller-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('loja sem waPhoneNumberId → 400', async () => {
    prisma.company.findUnique.mockResolvedValue({ waPhoneNumberId: null });
    await expect(
      service.send(COMPANY, 'lead-1', { text: 'oi' }, 'seller-1'),
    ).rejects.toThrow(/sem número de WhatsApp/);
  });

  describe('sendUploadedMedia (F3.5-C2 #552)', () => {
    const img = {
      buffer: Buffer.from('fake'),
      mimetype: 'image/jpeg',
      originalname: 'reboque.jpg',
      size: 1024,
    };

    it('sobe pra Media API e envia por id', async () => {
      http.post
        .mockReturnValueOnce(of({ data: { id: 'media-99' } })) // upload
        .mockReturnValueOnce(of({ data: { messages: [{ id: 'wamid.m1' }] } })); // send
      await service.sendUploadedMedia(COMPANY, 'lead-1', img, 'olha o modelo', 'seller-1');
      // 1ª chamada = upload em /media, 2ª = /messages com type image + id
      expect(http.post.mock.calls[0][0]).toContain('/media');
      const sendPayload = http.post.mock.calls[1][1];
      expect(sendPayload.type).toBe('image');
      expect(sendPayload.image.id).toBe('media-99');
      expect(sendPayload.image.caption).toBe('olha o modelo');
    });

    it('imagem acima de 5MB → 400 (não sobe)', async () => {
      await expect(
        service.sendUploadedMedia(COMPANY, 'lead-1', { ...img, size: 6 * 1024 * 1024 }, undefined, 'seller-1'),
      ).rejects.toThrow(/limite de 5MB/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('janela expirada → 400', async () => {
      prisma.whatsappConversation.findFirst.mockResolvedValue({
        ...openConversation(),
        windowExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.sendUploadedMedia(COMPANY, 'lead-1', img, undefined, 'seller-1'),
      ).rejects.toThrow(/Janela de 24h expirada/);
    });
  });
});

describe('WhatsappController — segurança do webhook', () => {
  let controller: WhatsappController;
  const queue = { add: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [
        { provide: WhatsappService, useValue: {} },
        { provide: ConfigService, useValue: makeConfig() },
        { provide: getQueueToken(WHATSAPP_QUEUE), useValue: queue },
      ],
    }).compile();
    controller = module.get(WhatsappController);
    queue.add.mockClear();
  });

  const sign = (raw: Buffer, secret = 'app-secret') =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('GET verify: token correto devolve o challenge', () => {
    expect(controller.verify('subscribe', 'verify-me', '12345')).toBe('12345');
  });

  it('GET verify: token errado → 401', () => {
    expect(() => controller.verify('subscribe', 'hacker', '12345')).toThrow(
      UnauthorizedException,
    );
  });

  it('POST: assinatura válida enfileira e responde ok', async () => {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
    const req: any = { rawBody: raw };
    const result = await controller.webhook(req, {} as any, sign(raw));
    expect(result).toEqual({ ok: true });
    expect(queue.add).toHaveBeenCalledWith('inbound', expect.anything(), expect.anything());
  });

  it('POST: assinatura inválida → 401 sem enfileirar', async () => {
    const raw = Buffer.from('{"a":1}');
    const req: any = { rawBody: raw };
    await expect(
      controller.webhook(req, {} as any, sign(raw, 'outro-secret')),
    ).rejects.toThrow(UnauthorizedException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('POST: sem assinatura → 401 (fail-closed)', async () => {
    const req: any = { rawBody: Buffer.from('{}') };
    await expect(controller.webhook(req, {} as any, undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('POST: sem WHATSAPP_APP_SECRET configurado → 401 (fail-closed)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [
        { provide: WhatsappService, useValue: {} },
        { provide: ConfigService, useValue: makeConfig({ WHATSAPP_APP_SECRET: undefined }) },
        { provide: getQueueToken(WHATSAPP_QUEUE), useValue: queue },
      ],
    }).compile();
    const c = module.get(WhatsappController);
    const raw = Buffer.from('{}');
    await expect(c.webhook({ rawBody: raw } as any, {} as any, sign(raw))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
