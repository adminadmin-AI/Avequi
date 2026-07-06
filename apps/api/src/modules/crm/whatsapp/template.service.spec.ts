import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { WhatsappTemplateService } from './template.service';

const COMPANY = 'company-1';
const cfg = (over: Record<string, string | undefined> = {}) => ({
  get: jest.fn((k: string) => {
    const d: Record<string, string> = {
      WHATSAPP_ACCESS_TOKEN: 'tok',
      WHATSAPP_WABA_ID: 'waba-1',
    };
    return k in over ? over[k] : d[k];
  }),
});

describe('WhatsappTemplateService', () => {
  let service: WhatsappTemplateService;
  let prisma: any;
  let http: { get: jest.Mock; post: jest.Mock };

  beforeEach(async () => {
    prisma = {
      whatsappTemplate: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      whatsappConversation: { findFirst: jest.fn(), update: jest.fn() },
      company: { findUnique: jest.fn().mockResolvedValue({ waPhoneNumberId: 'pnid-1' }) },
      whatsappMessage: { create: jest.fn().mockReturnValue({ id: 'msg-1' }) },
      lead: { update: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([{ id: 'msg-1' }]),
    };
    http = { get: jest.fn(), post: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappTemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: cfg() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(WhatsappTemplateService);
  });

  describe('sync', () => {
    it('upserta templates do Meta contando variáveis do corpo', async () => {
      http.get.mockReturnValue(
        of({
          data: {
            data: [
              {
                name: 'reengaja',
                language: 'pt_BR',
                category: 'MARKETING',
                status: 'APPROVED',
                components: [{ type: 'BODY', text: 'Oi {{1}}, ainda quer o {{2}}?' }],
              },
            ],
          },
        }),
      );
      const res = await service.sync(COMPANY);
      expect(res.synced).toBe(1);
      const upsert = prisma.whatsappTemplate.upsert.mock.calls[0][0];
      expect(upsert.create.variableCount).toBe(2);
      expect(upsert.create.status).toBe('APPROVED');
    });

    it('sem WABA configurado → 400', async () => {
      const module = await Test.createTestingModule({
        providers: [
          WhatsappTemplateService,
          { provide: PrismaService, useValue: prisma },
          { provide: HttpService, useValue: http },
          { provide: ConfigService, useValue: cfg({ WHATSAPP_WABA_ID: undefined }) },
          { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        ],
      }).compile();
      await expect(module.get(WhatsappTemplateService).sync(COMPANY)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('sendTemplate', () => {
    beforeEach(() => {
      prisma.whatsappConversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        waContactId: '5545999998888',
      });
      prisma.whatsappTemplate.findFirst.mockResolvedValue({
        name: 'reengaja',
        language: 'pt_BR',
        status: 'APPROVED',
        variableCount: 2,
        bodyText: 'Oi {{1}}, ainda quer o {{2}}?',
      });
      http.post.mockReturnValue(of({ data: { messages: [{ id: 'wamid.t1' }] } }));
    });

    it('envia template marcando isTemplate + preview renderizado', async () => {
      await service.sendTemplate(COMPANY, 'lead-1', 'reengaja', ['João', 'reboque'], 'seller-1');
      const payload = http.post.mock.calls[0][1];
      expect(payload.type).toBe('template');
      expect(payload.template.components[0].parameters).toHaveLength(2);
      // mensagem gravada com isTemplate e preview
      const msgCreate = prisma.whatsappMessage.create.mock.calls[0][0].data;
      expect(msgCreate.isTemplate).toBe(true);
      expect(msgCreate.text).toBe('Oi João, ainda quer o reboque?');
    });

    it('nº errado de variáveis → 400 (não envia)', async () => {
      await expect(
        service.sendTemplate(COMPANY, 'lead-1', 'reengaja', ['só uma'], 'seller-1'),
      ).rejects.toThrow(/exige 2 variável/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('template não aprovado → 400', async () => {
      prisma.whatsappTemplate.findFirst.mockResolvedValue(null);
      await expect(
        service.sendTemplate(COMPANY, 'lead-1', 'x', [], 'seller-1'),
      ).rejects.toThrow(/não encontrado ou não aprovado/);
    });

    it('erro da Meta vira 400 sem gravar', async () => {
      http.post.mockReturnValue(
        throwError(() => ({ response: { data: { error: { message: 'template paused' } } } })),
      );
      await expect(
        service.sendTemplate(COMPANY, 'lead-1', 'reengaja', ['a', 'b'], 'seller-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lead sem conversa → 404', async () => {
      prisma.whatsappConversation.findFirst.mockResolvedValue(null);
      await expect(
        service.sendTemplate(COMPANY, 'lead-x', 'reengaja', ['a', 'b'], 'seller-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
