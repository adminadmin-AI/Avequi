import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bull';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadIntakeService } from '../lead-intake.service';
import { ConnectorsController } from './connectors.controller';
import { CRM_LEADS_QUEUE } from './connectors.types';
import { StoreResolver } from './connectors.util';
import { MetaLeadsController } from './meta-leads.controller';
import { MetaLeadsService } from './meta-leads.service';
import { MercadoLivreService } from './mercadolivre.service';
import { SiteLeadController } from './site.controller';

const cfg = (over: Record<string, string | undefined> = {}) => ({
  get: jest.fn((k: string) => (k in over ? over[k] : undefined)),
});

describe('SiteLeadController (F1.6 #512)', () => {
  let controller: SiteLeadController;
  const intake = { intake: jest.fn().mockResolvedValue({ lead: {}, created: true }) };
  const resolver = { resolve: jest.fn().mockResolvedValue('company-cascavel') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SiteLeadController],
      providers: [
        { provide: LeadIntakeService, useValue: intake },
        { provide: StoreResolver, useValue: resolver },
      ],
    }).compile();
    controller = module.get(SiteLeadController);
    intake.intake.mockClear();
  });

  it('cria lead SITE resolvendo a loja pelo campo store', async () => {
    await controller.create({
      name: 'João',
      phone: '45999998888',
      store: 'cascavel',
      interest: 'reboque basculante',
    } as any);
    expect(resolver.resolve).toHaveBeenCalledWith('cascavel');
    const [companyId, dto] = intake.intake.mock.calls[0];
    expect(companyId).toBe('company-cascavel');
    expect(dto.source).toBe('SITE');
  });

  it('honeypot preenchido → descarta em silêncio (não cria lead)', async () => {
    const res = await controller.create({
      name: 'bot',
      phone: '45999998888',
      website: 'http://spam.com',
    } as any);
    expect(res).toEqual({ ok: true });
    expect(intake.intake).not.toHaveBeenCalled();
  });
});

describe('MetaLeadsController webhook (F1.4 #510)', () => {
  let controller: MetaLeadsController;
  const queue = { add: jest.fn() };
  const secret = 'app-secret';
  const { createHmac } = require('crypto');
  const sign = (raw: Buffer) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetaLeadsController],
      providers: [
        { provide: ConfigService, useValue: cfg({ META_APP_SECRET: secret, META_VERIFY_TOKEN: 'vt' }) },
        { provide: getQueueToken(CRM_LEADS_QUEUE), useValue: queue },
      ],
    }).compile();
    controller = module.get(MetaLeadsController);
    queue.add.mockClear();
  });

  it('verify com token correto devolve challenge', () => {
    expect(controller.verify('subscribe', 'vt', '999')).toBe('999');
  });

  it('assinatura válida enfileira leadgen', async () => {
    const body = { entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'lg-1' } }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const res = await controller.webhook({ rawBody: raw } as any, body, sign(raw));
    expect(res).toEqual({ ok: true });
    expect(queue.add).toHaveBeenCalledWith('meta-lead', { value: { leadgen_id: 'lg-1' } }, expect.anything());
  });

  it('assinatura inválida → 401 sem enfileirar', async () => {
    const raw = Buffer.from('{}');
    await expect(controller.webhook({ rawBody: raw } as any, {}, 'sha256=deadbeef')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('MetaLeadsService.processLeadgen (F1.4 #510)', () => {
  let service: MetaLeadsService;
  const http = { get: jest.fn() };
  const intake = { intake: jest.fn().mockResolvedValue({ lead: {}, created: true }) };
  const resolver = { resolve: jest.fn().mockResolvedValue('company-x') };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaLeadsService,
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: cfg({ META_PAGE_ACCESS_TOKEN: 'tok' }) },
        { provide: LeadIntakeService, useValue: intake },
        { provide: StoreResolver, useValue: resolver },
      ],
    }).compile();
    service = module.get(MetaLeadsService);
    intake.intake.mockClear();
  });

  it('busca o form na Graph API e cria lead com campanha em sourceMeta', async () => {
    http.get.mockReturnValue(
      of({
        data: {
          field_data: [
            { name: 'full_name', values: ['Maria Silva'] },
            { name: 'phone_number', values: ['+55 45 98888-7777'] },
            { name: 'cidade', values: ['guarapuava'] },
            { name: 'modelo', values: ['Reboque 2 jetskis'] },
          ],
          campaign_name: 'Campanha Verão',
          campaign_id: 'camp-1',
          ad_id: 'ad-1',
        },
      }),
    );
    await service.processLeadgen({ leadgen_id: 'lg-9', form_id: 'f-1' });
    const [companyId, dto] = intake.intake.mock.calls[0];
    expect(resolver.resolve).toHaveBeenCalledWith('guarapuava');
    expect(companyId).toBe('company-x');
    expect(dto.name).toBe('Maria Silva');
    expect(dto.phone).toBe('+55 45 98888-7777');
    expect(dto.externalRef).toBe('lg-9');
    expect(dto.sourceMeta.campaignName).toBe('Campanha Verão');
    expect(dto.sourceMeta.adId).toBe('ad-1');
  });

  it('sem token configurado → não cria lead (loga e sai)', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaLeadsService,
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: cfg({}) },
        { provide: LeadIntakeService, useValue: intake },
        { provide: StoreResolver, useValue: resolver },
      ],
    }).compile();
    await module.get(MetaLeadsService).processLeadgen({ leadgen_id: 'lg-1' });
    expect(intake.intake).not.toHaveBeenCalled();
  });
});

describe('ConnectorsController — ML + OLX (F1.5 #511)', () => {
  let controller: ConnectorsController;
  const queue = { add: jest.fn() };
  const intake = { intake: jest.fn().mockResolvedValue({ lead: {}, created: true }) };
  const resolver = { resolve: jest.fn().mockResolvedValue(null) };
  const ml = { answerQuestion: jest.fn().mockResolvedValue({ ok: true }) };

  async function make(over: Record<string, string | undefined>) {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ConfigService, useValue: cfg(over) },
        { provide: LeadIntakeService, useValue: intake },
        { provide: StoreResolver, useValue: resolver },
        { provide: MercadoLivreService, useValue: ml },
        { provide: getQueueToken(CRM_LEADS_QUEUE), useValue: queue },
      ],
    }).compile();
    return module.get(ConnectorsController);
  }

  beforeEach(() => {
    queue.add.mockClear();
    intake.intake.mockClear();
  });

  it('ML webhook: application_id correto enfileira pergunta', async () => {
    controller = await make({ ML_CLIENT_ID: '123' });
    await controller.mlWebhook({ topic: 'questions', resource: '/questions/55', application_id: 123 });
    expect(queue.add).toHaveBeenCalledWith('ml-question', { resource: '/questions/55' }, expect.anything());
  });

  it('ML webhook: application_id de outro app → 401', async () => {
    controller = await make({ ML_CLIENT_ID: '123' });
    await expect(
      controller.mlWebhook({ topic: 'questions', resource: '/questions/55', application_id: 999 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('OLX: token válido cria lead OLX', async () => {
    controller = await make({ OLX_WEBHOOK_SECRET: 'olx-secret' });
    await controller.olxLead(
      { name: 'Pedro', phone: '45999990000', listing: 'Reboque X', externalRef: 'olx-1' } as any,
      'olx-secret',
    );
    const dto = intake.intake.mock.calls[0][1];
    expect(dto.source).toBe('OLX');
    expect(dto.externalRef).toBe('olx-1');
  });

  it('OLX: token errado → 401 (fail-closed)', async () => {
    controller = await make({ OLX_WEBHOOK_SECRET: 'olx-secret' });
    await expect(controller.olxLead({ phone: '45999990000' } as any, 'errado')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(intake.intake).not.toHaveBeenCalled();
  });

  it('OLX: sem secret configurado → 401', async () => {
    controller = await make({});
    await expect(controller.olxLead({ phone: '45999990000' } as any, 'x')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('MercadoLivreService (F1.5 #511)', () => {
  let service: MercadoLivreService;
  let prisma: any;
  const http = { get: jest.fn(), post: jest.fn() };
  const intake = {
    intake: jest.fn().mockResolvedValue({ lead: { id: 'lead-1' }, created: true }),
  };

  beforeEach(async () => {
    prisma = {
      company: { findFirst: jest.fn().mockResolvedValue({ id: 'matriz-1' }) },
      systemParameter: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', value: 'access-tok' }),
        update: jest.fn(),
        create: jest.fn(),
      },
      lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
      leadActivity: { create: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MercadoLivreService,
        { provide: HttpService, useValue: http },
        { provide: ConfigService, useValue: cfg({}) },
        { provide: PrismaService, useValue: prisma },
        { provide: LeadIntakeService, useValue: intake },
      ],
    }).compile();
    service = module.get(MercadoLivreService);
    intake.intake.mockClear();
    prisma.leadActivity.create.mockClear();
  });

  it('pergunta não respondida vira lead (dedup por conta) + atividade', async () => {
    http.get
      .mockReturnValueOnce(
        of({ data: { id: 55, status: 'UNANSWERED', item_id: 'MLB1', text: 'Tem pronta entrega?', from: { id: 777, nickname: 'COMPRADOR' } } }),
      )
      .mockReturnValueOnce(of({ data: { title: 'Reboque Rodoviário', permalink: 'http://ml/x' } }));

    await service.processQuestion('/questions/55');

    const dto = intake.intake.mock.calls[0][1];
    expect(dto.source).toBe('MERCADO_LIVRE');
    expect(dto.externalRef).toBe('ml-user-777');
    expect(dto.interest).toBe('Reboque Rodoviário');
    expect(prisma.leadActivity.create).toHaveBeenCalled();
  });

  it('pergunta já respondida é ignorada', async () => {
    http.get.mockReturnValueOnce(of({ data: { id: 55, status: 'ANSWERED' } }));
    await service.processQuestion('/questions/55');
    expect(intake.intake).not.toHaveBeenCalled();
  });

  it('answerQuestion posta no ML e registra MESSAGE_OUT', async () => {
    http.post.mockReturnValue(of({ data: { id: 1 } }));
    await service.answerQuestion('company-1', 'lead-1', '55', 'Sim, temos!', 'seller-1');
    expect(http.post).toHaveBeenCalled();
    const activity = prisma.leadActivity.create.mock.calls[0][0].data;
    expect(activity.type).toBe('MESSAGE_OUT');
    expect(activity.actorId).toBe('seller-1');
  });
});
