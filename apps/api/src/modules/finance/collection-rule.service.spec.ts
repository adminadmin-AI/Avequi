import { Test } from '@nestjs/testing';
import { CollectionRuleService, DEFAULT_RULES } from './collection-rule.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  collectionRule: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  financialEntry: { findMany: jest.fn() },
  collectionAttempt: { findFirst: jest.fn(), create: jest.fn() },
  customer: { update: jest.fn() },
};

// Relógio congelado ao meio-dia de São Paulo (15:00Z): datas por offset de 24h
// mantêm o MESMO dia calendário em UTC e em America/Sao_Paulo. Sem isso, os
// specs de contagem de dias flakam todo dia entre 21h e 00h de SP (janela em
// que o dia UTC já virou e o dia operacional #1092/#1095 ainda não).
beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-08-15T15:00:00Z'),
    doNotFake: [
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
    ],
  });
});
afterAll(() => jest.useRealTimers());

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000);

function entry(overrides: Record<string, any> = {}) {
  return {
    id: 'fe-1',
    amount: 4500,
    dueDate: diasAtras(10),
    description: 'Venda OV X',
    salesOrder: { customerId: 'cust-1', customer: { name: 'Cliente X', billingBlocked: false } },
    ...overrides,
  };
}

describe('CollectionRuleService (#384)', () => {
  let service: CollectionRuleService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CollectionRuleService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CollectionRuleService);
    jest.clearAllMocks();
    mockPrisma.collectionRule.findMany.mockResolvedValue(
      DEFAULT_RULES.map((r, i) => ({ id: `rule-${i}`, companyId: 'co-1', isActive: true, ...r })),
    );
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    mockPrisma.collectionAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.collectionAttempt.create.mockResolvedValue({});
    mockPrisma.customer.update.mockResolvedValue({});
  });

  it('classifica 10 dias de atraso no estágio OVERDUE_30 (8-30d) e registra tentativa', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([entry({ dueDate: diasAtras(10) })]);
    const result = await service.run('co-1');
    expect(result.attempts).toBe(1);
    const data = mockPrisma.collectionAttempt.create.mock.calls[0][0].data;
    expect(data.note).toContain('[REGUA:OVERDUE_30]');
    expect(data.note).toContain('10d de atraso');
    expect(data.channel).toBe('EMAIL'); // primeiro canal do estágio
    expect(result.blocked).toBe(0); // OVERDUE_30 não bloqueia
  });

  it('pré-vencimento (-3 a -1 dias) registra lembrete', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([entry({ dueDate: diasAtras(-2) })]);
    const result = await service.run('co-1');
    expect(result.attempts).toBe(1);
    const data = mockPrisma.collectionAttempt.create.mock.calls[0][0].data;
    expect(data.note).toContain('[REGUA:PRE_DUE]');
    expect(data.note).toContain('vence em 2d');
  });

  it('estágio com autoBlock bloqueia o faturamento do cliente (#475)', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([entry({ dueDate: diasAtras(45) })]); // OVERDUE_60
    const result = await service.run('co-1');
    expect(result.blocked).toBe(1);
    expect(mockPrisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-1' },
        data: expect.objectContaining({
          billingBlocked: true,
          billingBlockReason: expect.stringContaining('OVERDUE_60'),
        }),
      }),
    );
  });

  it('cliente já bloqueado não é re-bloqueado', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([
      entry({ dueDate: diasAtras(45), salesOrder: { customerId: 'cust-1', customer: { name: 'X', billingBlocked: true } } }),
    ]);
    const result = await service.run('co-1');
    expect(result.blocked).toBe(0);
    expect(mockPrisma.customer.update).not.toHaveBeenCalled();
  });

  it('>90 dias vai pro estágio LEGAL com flag de jurídico', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([entry({ dueDate: diasAtras(120) })]);
    await service.run('co-1');
    const data = mockPrisma.collectionAttempt.create.mock.calls[0][0].data;
    expect(data.note).toContain('[REGUA:LEGAL]');
    expect(data.note).toContain('ENCAMINHAR AO JURÍDICO');
  });

  it('dedup: mesma entry+estágio não registra duas vezes', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([entry({ dueDate: diasAtras(10) })]);
    mockPrisma.collectionAttempt.findFirst.mockResolvedValue({ id: 'attempt-existente' });
    const result = await service.run('co-1');
    expect(result.attempts).toBe(0);
    expect(mockPrisma.collectionAttempt.create).not.toHaveBeenCalled();
  });

  it('seedDefaults é idempotente', async () => {
    mockPrisma.collectionRule.findFirst
      .mockResolvedValueOnce({ id: 'r1' }) // PRE_DUE já existe
      .mockResolvedValue(null);
    mockPrisma.collectionRule.create.mockResolvedValue({});
    const result = await service.seedDefaults('co-1');
    expect(result.created).toBe(5);
    expect(result.total).toBe(6);
  });
});
