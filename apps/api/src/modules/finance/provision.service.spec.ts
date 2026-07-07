import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PROVISION_RULES, ProvisionService } from './provision.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  provisionRule: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  financialEntry: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
};

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('ProvisionService (#389)', () => {
  let service: ProvisionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ProvisionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ProvisionService);
    jest.clearAllMocks();
    mockPrisma.provisionRule.findMany.mockResolvedValue(
      DEFAULT_PROVISION_RULES.map((r, i) => ({ id: `pr-${i}`, percentage: r.percentage, ...r })),
    );
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('calcula provisão por faixa: 45d → 5%, 100d → 30%', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([
      { id: 'e1', amount: 10000, paidAmount: 0, dueDate: diasAtras(45), description: 'A', salesOrder: { customer: { id: 'c1', name: 'X' } } },
      { id: 'e2', amount: 20000, paidAmount: 5000, dueDate: diasAtras(100), description: 'B', salesOrder: null },
    ]);
    const pdd = await service.getPdd('co-1');
    // e1: 10000 × 5% = 500 | e2: saldo 15000 × 30% = 4500
    expect(pdd.totalVencido).toBe(25000);
    expect(pdd.totalProvisao).toBe(5000);
    const f5 = pdd.faixas.find((f: any) => f.percentage === 5)!;
    expect(f5.provisao).toBe(500);
    expect(f5.titulos).toBe(1);
    const f30 = pdd.faixas.find((f: any) => f.percentage === 30)!;
    expect(f30.provisao).toBe(4500);
    // detalhes ordenados por provisão desc
    expect(pdd.detalhes[0].entryId).toBe('e2');
  });

  it('>365 dias provisiona 100%', async () => {
    mockPrisma.financialEntry.findMany.mockResolvedValue([
      { id: 'e1', amount: 8000, paidAmount: 0, dueDate: diasAtras(400), description: 'X', salesOrder: null },
    ]);
    const pdd = await service.getPdd('co-1');
    expect(pdd.totalProvisao).toBe(8000);
  });

  it('write-off exige justificativa e recebível em aberto', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'e1', type: 'RECEIVABLE', status: 'OVERDUE', amount: 500 });
    await expect(service.writeOff('e1', 'co-1', 'curto')).rejects.toThrow(BadRequestException);

    mockPrisma.financialEntry.update.mockResolvedValue({ id: 'e1', status: 'WRITTEN_OFF' });
    const result = await service.writeOff('e1', 'co-1', 'Cliente encerrou atividades, sem bens', 'user-1');
    expect(result.status).toBe('WRITTEN_OFF');
    expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'WRITTEN_OFF',
          paymentNote: expect.stringContaining('WRITE-OFF:'),
        }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('write-off rejeita PAYABLE e lançamento já pago', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'e1', type: 'PAYABLE', status: 'OPEN' });
    await expect(service.writeOff('e1', 'co-1', 'justificativa válida aqui')).rejects.toThrow(/recebíveis/);

    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'e2', type: 'RECEIVABLE', status: 'PAID' });
    await expect(service.writeOff('e2', 'co-1', 'justificativa válida aqui')).rejects.toThrow(/não está em aberto/);
  });

  it('seedDefaults idempotente', async () => {
    mockPrisma.provisionRule.findFirst.mockResolvedValue(null);
    mockPrisma.provisionRule.create.mockResolvedValue({});
    const r = await service.seedDefaults('co-1');
    expect(r.created).toBe(6);
  });
});
