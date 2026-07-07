import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { buildSchedule, DebtService } from './debt.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  debt: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  debtInstallment: { findMany: jest.fn(), update: jest.fn() },
  alert: { findFirst: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn() },
};

describe('buildSchedule (#392)', () => {
  it('PRICE: parcela fixa, saldo zera na última', () => {
    // R$ 12.000, 1% a.m., 12 parcelas → PMT ≈ 1.066,18
    const sched = buildSchedule(12000, 0.01, 12, new Date('2026-08-05'), 'PRICE');
    expect(sched).toHaveLength(12);
    expect(sched[0].amount).toBeCloseTo(1066.18, 1);
    expect(sched[0].interest).toBe(120); // 12000 × 1%
    expect(sched[11].balance).toBe(0);
    // amortização cresce ao longo do tempo no PRICE
    expect(sched[11].amortization).toBeGreaterThan(sched[0].amortization);
    // datas mensais
    expect(sched[1].dueDate.getMonth()).toBe((sched[0].dueDate.getMonth() + 1) % 12);
  });

  it('SAC: amortização fixa, parcela decrescente, saldo zera', () => {
    const sched = buildSchedule(12000, 0.01, 12, new Date('2026-08-05'), 'SAC');
    expect(sched[0].amortization).toBe(1000);
    expect(sched[0].amount).toBe(1120); // 1000 + 120 juros
    expect(sched[5].amount).toBeLessThan(sched[0].amount);
    expect(sched[11].balance).toBe(0);
  });

  it('taxa zero divide o principal igualmente', () => {
    const sched = buildSchedule(9000, 0, 3, new Date('2026-08-05'), 'PRICE');
    expect(sched.map((s) => s.amount)).toEqual([3000, 3000, 3000]);
    expect(sched[2].balance).toBe(0);
  });
});

describe('DebtService (#392)', () => {
  let service: DebtService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DebtService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(DebtService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('create valida tipo e gera cronograma junto', async () => {
    mockPrisma.debt.create.mockResolvedValue({ id: 'd1', installments: [] });
    await service.create('co-1', {
      type: 'FINAME',
      bank: 'BNDES',
      principal: 12000,
      interestRate: 1,
      installmentsCount: 12,
      contractedAt: '2026-07-07',
      firstDueDate: '2026-08-05',
    });
    const data = mockPrisma.debt.create.mock.calls[0][0].data;
    expect(data.installments.create).toHaveLength(12);
    expect(data.amortizationType).toBe('PRICE');

    await expect(
      service.create('co-1', { type: 'CONSIGNADO' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('payInstallment baixa a parcela e quita a dívida na última', async () => {
    mockPrisma.debt.findFirst.mockResolvedValue({
      id: 'd1',
      installments: [
        { id: 'i1', number: 1, status: 'PAID', amount: 100 },
        { id: 'i2', number: 2, status: 'PENDING', amount: 100 },
      ],
    });
    mockPrisma.debtInstallment.update.mockResolvedValue({});
    mockPrisma.debt.update.mockResolvedValue({});

    const r = await service.payInstallment('d1', 2, 'co-1');
    expect(r.settled).toBe(true);
    expect(mockPrisma.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SETTLED' } }),
    );
  });

  it('dashboard soma saldo devedor (amortizações pendentes) por tipo', async () => {
    mockPrisma.debt.findMany.mockResolvedValue([
      {
        id: 'd1',
        type: 'FINAME',
        installments: [
          { status: 'PAID', amortization: 1000 },
          { status: 'PENDING', amortization: 1000 },
          { status: 'PENDING', amortization: 1000 },
        ],
      },
    ]);
    mockPrisma.debtInstallment.findMany.mockResolvedValue([]);
    const dash = await service.dashboard('co-1');
    expect(dash.saldoDevedorTotal).toBe(2000);
    expect(dash.porTipo[0]).toMatchObject({ tipo: 'FINAME', saldoDevedor: 2000 });
  });

  it('alerta de parcelas em 7d não duplica alerta aberto', async () => {
    mockPrisma.debtInstallment.findMany.mockResolvedValue([
      {
        number: 3,
        amount: 1120,
        dueDate: new Date(Date.now() + 3 * 86_400_000),
        debt: { companyId: 'co-1', bank: 'BNDES', type: 'FINAME' },
      },
    ]);
    mockPrisma.alert.findFirst.mockResolvedValueOnce(null);
    mockPrisma.alert.create.mockResolvedValue({});
    await service.alertUpcomingInstallments();
    expect(mockPrisma.alert.create).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockPrisma.debtInstallment.findMany.mockResolvedValue([
      { number: 3, amount: 1120, dueDate: new Date(), debt: { companyId: 'co-1', bank: 'BNDES', type: 'FINAME' } },
    ]);
    mockPrisma.alert.findFirst.mockResolvedValue({ id: 'a1' });
    await service.alertUpcomingInstallments();
    expect(mockPrisma.alert.create).not.toHaveBeenCalled();
  });
});
