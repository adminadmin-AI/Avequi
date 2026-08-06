import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { LeadSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FunnelService } from './funnel.service';
import { LeadConversionService } from './lead-conversion.service';
import { LeadIntakeService } from './lead-intake.service';
import { SellerEligibilityService } from './seller-eligibility.service';

/**
 * F3.4 (#520) — E2E do caminho crítico do CRM com serviços REAIS encadeados
 * (Prisma mockado como um store em memória simplificado). Cobre:
 * lead → move no funil → converte → OV vinculada → NF-e fecha (WON).
 * Também valida que 200 leads em burst não perdem registro (dedup por telefone).
 */

/** Store em memória mínimo p/ encadear os serviços sem banco real */
function makeInMemoryPrisma() {
  const leads: any[] = [];
  const activities: any[] = [];
  const customers: any[] = [];
  const stages = [
    { id: 's-novo', companyId: 'c1', type: 'OPEN', order: 0, isActive: true, name: 'Novo' },
    { id: 's-prop', companyId: 'c1', type: 'OPEN', order: 2, isActive: true, name: 'Proposta' },
    { id: 's-won', companyId: 'c1', type: 'WON', order: 4, isActive: true, name: 'Fechado' },
    { id: 's-lost', companyId: 'c1', type: 'LOST', order: 5, isActive: true, name: 'Perdido' },
  ];
  const orders: any[] = [];
  let seq = 0;

  const matchWhere = (lead: any, where: any): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries<any>(where)) {
      if (k === 'companyId' && lead.companyId !== v) return false;
      else if (k === 'id' && lead.id !== v) return false;
      else if (k === 'salesOrderId' && lead.salesOrderId !== v) return false;
      else if (k === 'phone' && lead.phone !== v) return false;
      else if (k === 'stageId' && lead.stageId !== v) return false;
    }
    return true;
  };

  return {
    _leads: leads,
    _activities: activities,
    lead: {
      create: jest.fn(({ data }: any) => {
        // simula a constraint única (companyId, phone) do banco — base do dedup
        if (data.phone && leads.some((l) => l.companyId === data.companyId && l.phone === data.phone)) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          );
        }
        const lead = {
          id: `lead-${++seq}`,
          ...data,
          position: data.position ?? new Prisma.Decimal(0),
        };
        leads.push(lead);
        for (const a of data.activities?.create ?? []) activities.push({ leadId: lead.id, ...a });
        return Promise.resolve(lead);
      }),
      findFirst: jest.fn(({ where, include }: any = {}) => {
        const lead = leads.find((l) => matchWhere(l, where));
        if (!lead) return Promise.resolve(null);
        if (include?.customer) {
          return Promise.resolve({ ...lead, customer: customers.find((c) => c.id === lead.customerId) ?? null });
        }
        if (include?.stage) {
          return Promise.resolve({ ...lead, stage: stages.find((s) => s.id === lead.stageId) ?? null });
        }
        return Promise.resolve(lead);
      }),
      findUnique: jest.fn(({ where }: any) => {
        const cid = where.companyId_phone?.companyId;
        const phone = where.companyId_phone?.phone;
        const lead = leads.find((l) => l.companyId === cid && l.phone === phone);
        return Promise.resolve(lead ? { ...lead, stage: stages.find((s) => s.id === lead.stageId) } : null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const lead = leads.find((l) => l.id === where.id);
        Object.assign(lead, {
          ...data,
          activities: undefined,
        });
        for (const a of data.activities?.create ? [].concat(data.activities.create) : [])
          activities.push({ leadId: lead.id, ...a });
        return Promise.resolve(lead);
      }),
      groupBy: jest.fn(() => Promise.resolve([])),
      aggregate: jest.fn(() => Promise.resolve({ _max: { position: null } })),
      findMany: jest.fn(() => Promise.resolve(leads)),
    },
    pipelineStage: {
      findFirst: jest.fn(({ where, orderBy }: any) => {
        let matches = stages.filter(
          (s) =>
            (!where.id || s.id === where.id) &&
            (!where.type || s.type === where.type) &&
            (where.isActive === undefined || s.isActive === where.isActive),
        );
        if (orderBy?.order === 'asc') matches = matches.sort((a, b) => a.order - b.order);
        return Promise.resolve(matches[0] ?? null);
      }),
      findMany: jest.fn(({ where }: any = {}) =>
        Promise.resolve(stages.filter((s) => !where?.type || s.type === where.type)),
      ),
    },
    customer: {
      findFirst: jest.fn(({ where }: any) => {
        const phone = where.OR?.[0]?.phone;
        return Promise.resolve(customers.find((c) => c.phone === phone) ?? null);
      }),
      create: jest.fn(({ data }: any) => {
        const c = { id: `cust-${++seq}`, ...data };
        customers.push(c);
        return Promise.resolve(c);
      }),
    },
    salesOrder: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(orders.find((o) => o.id === where.id) ?? null)),
      _add: (o: any) => orders.push(o),
    },
    user: { findMany: jest.fn(() => Promise.resolve([{ id: 'seller-1' }])), findFirst: jest.fn() },
    company: { findFirst: jest.fn(() => Promise.resolve({ id: 'c1' })) },
    systemParameter: { findFirst: jest.fn(() => Promise.resolve(null)) },
  };
}

describe('CRM E2E — caminho crítico (F3.4 #520)', () => {
  let intake: LeadIntakeService;
  let funnel: FunnelService;
  let conversion: LeadConversionService;
  let prisma: any;

  beforeEach(async () => {
    prisma = makeInMemoryPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadIntakeService,
        FunnelService,
        LeadConversionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          // #1002-C3: elegibilidade resolvida pelo SellerEligibilityService.
          provide: SellerEligibilityService,
          useValue: {
            candidatosParaAtribuicao: jest.fn().mockResolvedValue([]),
            candidatosParaConfiguracao: jest.fn().mockResolvedValue([]),
            registrarSemElegivel: jest.fn(),
          },
        },
      ],
    }).compile();
    intake = module.get(LeadIntakeService);
    funnel = module.get(FunnelService);
    conversion = module.get(LeadConversionService);
  });

  it('lead → move funil → converte → OV → NF-e fecha (WON)', async () => {
    // 1. lead entra pelo WhatsApp
    const { lead, created } = await intake.intake('c1', {
      phone: '(45) 99999-8888',
      name: 'João',
      source: LeadSource.WHATSAPP,
      interest: 'reboque 2 jetskis',
    });
    expect(created).toBe(true);
    expect(prisma._leads[0].phone).toBe('5545999998888');

    // 2. vendedor move p/ Proposta no kanban
    await funnel.moveLead('c1', lead.id, { stageId: 's-prop' }, 'seller-1');
    expect(prisma._leads[0].stageId).toBe('s-prop');

    // 3. converte em cliente
    const conv = await conversion.convertToCustomer('c1', lead.id, 'seller-1');
    expect(conv.created).toBe(true);
    expect(prisma._leads[0].customerId).toBe(conv.customerId);

    // 4. OV criada e vinculada
    prisma.salesOrder._add({ id: 'so-1', companyId: 'c1', customerId: conv.customerId });
    await conversion.linkSalesOrder('c1', lead.id, 'so-1');
    expect(prisma._leads[0].salesOrderId).toBe('so-1');

    // 5. NF-e emitida → listener fecha o lead em WON
    await conversion.closeWonBySalesOrder('c1', 'so-1');
    expect(prisma._leads[0].stageId).toBe('s-won');

    // timeline registrou a jornada
    const types = prisma._activities.map((a: any) => a.type);
    expect(types).toContain('STAGE_CHANGE');
    expect(types).toContain('CONVERSION');
  });

  it('carga: 200 leads do MESMO telefone em burst → 1 lead só (dedup)', async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, () =>
        intake
          .intake('c1', { phone: '45988887777', source: LeadSource.META_ADS })
          .catch(() => ({ created: false })),
      ),
    );
    // exatamente 1 criação; as outras 199 são contato repetido
    const createdCount = results.filter((r) => r.created).length;
    expect(createdCount).toBe(1);
    expect(prisma._leads.filter((l: any) => l.phone === '5545988887777')).toHaveLength(1);
  });

  it('carga: 200 telefones distintos → 200 leads', async () => {
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        intake.intake('c1', {
          phone: `4599${String(i).padStart(7, '0')}`,
          source: LeadSource.SITE,
        }),
      ),
    );
    expect(prisma._leads).toHaveLength(200);
  });
});
