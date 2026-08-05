import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadIntakeService } from './lead-intake.service';

const COMPANY = 'company-1';

const makeLead = (overrides = {}) => ({
  id: 'lead-1',
  companyId: COMPANY,
  phone: '5545999998888',
  source: LeadSource.WHATSAPP,
  assignedToId: 'seller-1',
  stage: { type: 'OPEN' },
  updatedAt: new Date(),
  ...overrides,
});

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('LeadIntakeService', () => {
  let service: LeadIntakeService;
  let prisma: any;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      lead: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]), // #574 — dup cross-loja
        groupBy: jest.fn().mockResolvedValue([]),
      },
      leadActivity: { create: jest.fn() }, // #574
      user: { findMany: jest.fn(), findFirst: jest.fn() },
      pipelineStage: { findFirst: jest.fn().mockResolvedValue({ id: 'stage-novo', type: 'OPEN' }) },
      company: {
        findFirst: jest.fn(),
        // #984 — árvore do tenant do lead (cross-store scoped)
        findUnique: jest.fn().mockResolvedValue({ id: COMPANY, parentId: 'root-1' }),
      },
      systemParameter: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    events = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadIntakeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();

    service = module.get(LeadIntakeService);
  });

  describe('normalizePhone', () => {
    it.each([
      ['(45) 99999-8888', '5545999998888'], // celular com máscara
      ['45 3333-4444', '554533334444'], // fixo com DDD
      ['5545999998888', '5545999998888'], // já E.164
      ['+55 45 99999-8888', '5545999998888'], // com DDI e +
      ['045 99999-8888', '5545999998888'], // zero de discagem
    ])('normaliza %s → %s', (input, expected) => {
      expect(service.normalizePhone(input)).toBe(expected);
    });

    it.each([
      ['99999-8888'], // sem DDD — ambíguo, não arriscar
      ['123'],
      [''],
      [undefined],
    ])('rejeita formato ambíguo/curto: %s', (input) => {
      expect(service.normalizePhone(input as any)).toBeNull();
    });
  });

  describe('intake — criação', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([{ id: 'seller-1' }, { id: 'seller-2' }]);
      prisma.lead.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'lead-new', ...data }),
      );
    });

    it('cria lead com telefone normalizado, stage inicial e vendedor do rodízio', async () => {
      const result = await service.intake(COMPANY, {
        phone: '(45) 99999-8888',
        source: LeadSource.SITE,
      });

      expect(result.created).toBe(true);
      const data = prisma.lead.create.mock.calls[0][0].data;
      expect(data.phone).toBe('5545999998888');
      expect(data.stageId).toBe('stage-novo');
      expect(data.assignedToId).toBe('seller-1'); // ambos zerados → menor id
      expect(data.assignedAt).toBeInstanceOf(Date);
      expect(events.emit).toHaveBeenCalledWith(
        'crm.lead.created',
        expect.objectContaining({ leadId: 'lead-new', companyId: COMPANY }),
      );
    });

    it('rodízio escolhe o vendedor com MENOS leads hoje', async () => {
      prisma.lead.groupBy.mockResolvedValue([
        { assignedToId: 'seller-1', _count: { _all: 5 }, _max: { assignedAt: new Date() } },
        { assignedToId: 'seller-2', _count: { _all: 2 }, _max: { assignedAt: new Date() } },
      ]);
      await service.intake(COMPANY, { phone: '45999998888', source: LeadSource.OLX });
      expect(prisma.lead.create.mock.calls[0][0].data.assignedToId).toBe('seller-2');
    });

    it('sem vendedor elegível → lead criado sem atribuição (não explode)', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      const result = await service.intake(COMPANY, {
        phone: '45999998888',
        source: LeadSource.TELEFONE,
      });
      expect(result.created).toBe(true);
      expect(prisma.lead.create.mock.calls[0][0].data.assignedToId).toBeNull();
    });

    it('sem loja identificada → triagem na matriz do tenant da env SEM vendedor (#984)', async () => {
      process.env.CRM_CONNECTOR_TENANT_ID = 'matriz-1';
      try {
        await service.intake(null, { phone: '45999998888', source: LeadSource.META_ADS });
      } finally {
        delete process.env.CRM_CONNECTOR_TENANT_ID;
      }
      const data = prisma.lead.create.mock.calls[0][0].data;
      expect(data.companyId).toBe('matriz-1');
      expect(data.assignedToId).toBeNull();
      // #984: a triagem NUNCA volta a varrer o banco atrás de "alguma matriz"
      expect(prisma.company.findFirst).not.toHaveBeenCalled();
    });

    it('sem loja identificada E sem CRM_CONNECTOR_TENANT_ID → 503 fail-closed (#984)', async () => {
      delete process.env.CRM_CONNECTOR_TENANT_ID;
      await expect(
        service.intake(null, { phone: '45999998888', source: LeadSource.META_ADS }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });

    it('rejeita lead sem telefone válido e sem externalRef', async () => {
      await expect(
        service.intake(COMPANY, { phone: '9999-8888', source: LeadSource.SITE }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // #574 — aviso de duplicidade de lead entre lojas
  describe('intake — duplicidade cross-loja (#574)', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([{ id: 'seller-1' }]);
      prisma.lead.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'lead-new', ...data }),
      );
    });

    it('telefone em negociação em OUTRA loja → activity com SÓ o nome da loja', async () => {
      prisma.lead.findMany.mockResolvedValue([
        { company: { name: 'GDR Cascavel' } },
        { company: { name: 'GDR Cascavel' } }, // dedup de nomes
      ]);

      await service.intake(COMPANY, { phone: '45999998888', source: LeadSource.SITE });

      const call = prisma.leadActivity.create.mock.calls[0][0];
      expect(call.data.leadId).toBe('lead-new');
      expect(call.data.properties.kind).toBe('cross_store_duplicate');
      expect(call.data.properties.stores).toEqual(['GDR Cascavel']);
      // tenancy: nada além do nome da loja vaza pro lead novo
      expect(JSON.stringify(call.data.properties)).not.toMatch(/seller|vendedor|leadId|phone/i);
      // busca exclui a própria loja e leads anonimizados/fechados
      const where = prisma.lead.findMany.mock.calls[0][0].where;
      expect(where.companyId).toEqual({ not: COMPANY });
      expect(where.anonymizedAt).toBeNull();
      // #984: "outra loja" = SÓ a árvore matriz+filiais do tenant do lead —
      // telefone repetido em outro TENANT nunca entra no aviso
      expect(where.company).toEqual({ OR: [{ id: 'root-1' }, { parentId: 'root-1' }] });
    });

    it('sem lead em outra loja → nenhuma activity de aviso', async () => {
      prisma.lead.findMany.mockResolvedValue([]);
      await service.intake(COMPANY, { phone: '45999998888', source: LeadSource.SITE });
      expect(prisma.leadActivity.create).not.toHaveBeenCalled();
    });

    it('falha no check de duplicidade NÃO derruba a captação (best-effort)', async () => {
      prisma.lead.findMany.mockRejectedValue(new Error('db fora'));
      const result = await service.intake(COMPANY, {
        phone: '45999998888',
        source: LeadSource.SITE,
      });
      expect(result.created).toBe(true);
    });
  });

  describe('intake — dedup', () => {
    it('corrida entre canais: P2002 → registra contato repetido no lead existente', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'seller-1' }]);
      prisma.lead.create.mockRejectedValue(p2002());
      prisma.lead.findUnique.mockResolvedValue(makeLead());
      prisma.lead.update.mockResolvedValue(makeLead());

      const result = await service.intake(COMPANY, {
        phone: '45 99999-8888',
        source: LeadSource.MERCADO_LIVRE,
      });

      expect(result.created).toBe(false);
      expect(result.lead.id).toBe('lead-1');
      const update = prisma.lead.update.mock.calls[0][0].data;
      expect(update.activities.create[0].properties.kind).toBe('repeat_contact');
      expect(events.emit).toHaveBeenCalledWith(
        'crm.lead.contact_repeated',
        expect.objectContaining({ leadId: 'lead-1', reopened: false }),
      );
    });

    it('lead PERDIDO há menos de 90 dias volta pro primeiro stage aberto', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'seller-1' }]);
      prisma.lead.create.mockRejectedValue(p2002());
      prisma.lead.findUnique.mockResolvedValue(
        makeLead({ stage: { type: 'LOST' }, updatedAt: new Date(Date.now() - 10 * 86400000) }),
      );
      prisma.lead.update.mockResolvedValue(makeLead());

      await service.intake(COMPANY, { phone: '45999998888', source: LeadSource.WHATSAPP });

      const update = prisma.lead.update.mock.calls[0][0].data;
      expect(update.stageId).toBe('stage-novo');
      expect(update.lostReason).toBeNull();
      expect(events.emit).toHaveBeenCalledWith(
        'crm.lead.contact_repeated',
        expect.objectContaining({ reopened: true }),
      );
    });

    it('lead PERDIDO há MAIS de 90 dias NÃO reabre automaticamente', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'seller-1' }]);
      prisma.lead.create.mockRejectedValue(p2002());
      prisma.lead.findUnique.mockResolvedValue(
        makeLead({ stage: { type: 'LOST' }, updatedAt: new Date(Date.now() - 120 * 86400000) }),
      );
      prisma.lead.update.mockResolvedValue(makeLead());

      await service.intake(COMPANY, { phone: '45999998888', source: LeadSource.WHATSAPP });
      expect(prisma.lead.update.mock.calls[0][0].data.stageId).toBeUndefined();
    });

    it('sem telefone: dedup por externalRef da mesma origem', async () => {
      prisma.lead.findFirst.mockResolvedValue(makeLead({ phone: null, externalRef: 'ml-123' }));
      prisma.lead.update.mockResolvedValue(makeLead());

      const result = await service.intake(COMPANY, {
        source: LeadSource.MERCADO_LIVRE,
        externalRef: 'ml-123',
      });
      expect(result.created).toBe(false);
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });
  });

  describe('reassign', () => {
    it('reatribui com trilha ASSIGNMENT manual', async () => {
      prisma.lead.findFirst.mockResolvedValue(makeLead());
      prisma.user.findFirst.mockResolvedValue({ id: 'seller-2' });
      prisma.lead.update.mockResolvedValue(makeLead({ assignedToId: 'seller-2' }));

      await service.reassign(COMPANY, 'lead-1', 'seller-2', 'manager-1');

      const update = prisma.lead.update.mock.calls[0][0].data;
      expect(update.assignedToId).toBe('seller-2');
      expect(update.activities.create.properties).toEqual({
        fromUserId: 'seller-1',
        toUserId: 'seller-2',
        via: 'manual',
      });
      expect(update.activities.create.actorId).toBe('manager-1');
    });

    it('lead de outra company → 404 (tenancy)', async () => {
      prisma.lead.findFirst.mockResolvedValue(null);
      await expect(
        service.reassign(COMPANY, 'lead-x', 'seller-2', 'manager-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('vendedor de outra loja → 400', async () => {
      prisma.lead.findFirst.mockResolvedValue(makeLead());
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.reassign(COMPANY, 'lead-1', 'intruso', 'manager-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('distributionReport', () => {
    it('agrega leads atribuídos por vendedor no dia', async () => {
      prisma.lead.groupBy.mockResolvedValue([
        { assignedToId: 'seller-1', _count: { _all: 7 } },
        { assignedToId: 'seller-2', _count: { _all: 4 } },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'seller-1', name: 'João' },
        { id: 'seller-2', name: 'Maria' },
      ]);
      const report = await service.distributionReport(COMPANY);
      expect(report).toEqual([
        { userId: 'seller-1', userName: 'João', leadsAssigned: 7 },
        { userId: 'seller-2', userName: 'Maria', leadsAssigned: 4 },
      ]);
    });

    it('data inválida → 400', async () => {
      await expect(service.distributionReport(COMPANY, 'not-a-date')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
