import { Test, TestingModule } from '@nestjs/testing';
import { DebtorType, FinancialEntryType, PaymentMethod } from '@prisma/client';
import { FinanceService } from './finance.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #586 — geração de títulos a partir do plano de pagamento (#584).
 * Cartão → recebível LÍQUIDO contra a ADQUIRENTE na data de liquidação (a MDR
 * fica netada no CR e registrada em SalesPayment, sem despesa em dobro no DRE);
 * boleto → parcelas contra o CLIENTE; à vista → D+0. 1 createMany por venda.
 */

const mockPrisma = {
  salesOrder: { findFirst: jest.fn() },
  financialEntry: { findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

/** Linhas passadas ao createMany na última chamada */
function rows(): any[] {
  return mockPrisma.financialEntry.createMany.mock.calls.at(-1)![0].data;
}

function pay(overrides: Record<string, any> = {}) {
  return {
    id: 'sp-1',
    method: PaymentMethod.CARTAO_CREDITO,
    amount: 8000,
    installments: 4,
    acquirerId: 'acq-1',
    brand: 'VISA',
    mdrRate: 3.5,
    mdrAmount: 280,
    settlementDays: 30,
    ...overrides,
  };
}

const DAY = 86_400_000;
const daysFromNow = (d: Date) => Math.round((d.getTime() - Date.now()) / DAY) || 0; // normaliza -0

describe('FinanceService — títulos por plano de pagamento (#586)', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SupplierAdvanceService, useValue: { applyToPayable: jest.fn() } },
      ],
    }).compile();
    service = module.get(FinanceService);
    jest.clearAllMocks();
    mockPrisma.financialEntry.findFirst.mockResolvedValue(null); // sem CR anterior
    mockPrisma.financialEntry.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('cartão crédito 4x: 4 CRs LÍQUIDOS contra a ADQUIRENTE em D+30/60/90/120, sem despesa MDR', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [pay()] });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 8000 });

    const all = rows();
    // nada de PAYABLE (MDR não vira despesa — netada no CR)
    expect(all.every((e) => e.type === FinancialEntryType.RECEIVABLE)).toBe(true);
    expect(all).toHaveLength(4);
    // líquido: 8000 − 280 = 7720
    expect(all.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(7720, 2);
    for (const [i, cr] of all.entries()) {
      expect(cr.debtorType).toBe(DebtorType.ACQUIRER);
      expect(cr.acquirerId).toBe('acq-1');
      expect(cr.installmentNumber).toBe(i + 1);
      expect(daysFromNow(cr.dueDate)).toBe(30 + 30 * i);
    }
    // 1 statement (createMany), não N inserts
    expect(mockPrisma.financialEntry.createMany).toHaveBeenCalledTimes(1);
  });

  it('boleto 3x: 3 parcelas contra o CLIENTE a cada 30 dias, soma = bruto', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.BOLETO, amount: 1000, installments: 3, acquirerId: null, mdrAmount: null, settlementDays: null })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 1000 });

    const all = rows();
    expect(all).toHaveLength(3);
    expect(all.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(1000, 2);
    expect(all.map((e) => daysFromNow(e.dueDate))).toEqual([30, 60, 90]);
    for (const cr of all) expect(cr.debtorType).toBe(DebtorType.CUSTOMER);
    expect(all[2].amount).toBeCloseTo(333.34, 2); // resto no último
  });

  it('cartão débito: 1 CR líquido contra a ADQUIRENTE em D+1', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.CARTAO_DEBITO, amount: 500, installments: 1, mdrRate: 1.99, mdrAmount: 9.95, settlementDays: 1 })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 500 });

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBeCloseTo(490.05, 2);
    expect(all[0].debtorType).toBe(DebtorType.ACQUIRER);
    expect(daysFromNow(all[0].dueDate)).toBe(1);
  });

  it('PIX à vista: 1 CR contra o CLIENTE em D+0', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.PIX, amount: 750, installments: 1, acquirerId: null, mdrAmount: null })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 750 });

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(
      expect.objectContaining({ amount: 750, debtorType: DebtorType.CUSTOMER, installmentNumber: 1 }),
    );
    expect(daysFromNow(all[0].dueDate)).toBe(0);
  });

  it('plano misto: NF-e vinculada só ao primeiro título', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [
        pay({ id: 'sp-pix', method: PaymentMethod.PIX, amount: 2000, installments: 1, acquirerId: null, mdrAmount: null }),
        pay({ id: 'sp-card', amount: 8000 }),
      ],
    });

    await service.createReceivableForSale({
      companyId: 'co-1',
      salesOrderId: 'so-1',
      amount: 10000,
      fiscalDocumentId: 'fd-1',
    });

    const all = rows();
    const withNfe = all.filter((e) => e.fiscalDocumentId === 'fd-1');
    expect(withNfe).toHaveLength(1); // fiscalDocumentId é @unique
    expect(all[0].fiscalDocumentId).toBe('fd-1');
  });

  it('sem plano → legado: 1 CR cliente em 30 dias (create simples, sem createMany)', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [] });
    mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-legacy' });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 300 });

    expect(mockPrisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 300 }) }),
    );
    expect(mockPrisma.financialEntry.createMany).not.toHaveBeenCalled();
  });

  it('idempotência: CR existente → não regenera nada', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1' });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 300 });

    expect(mockPrisma.salesOrder.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.financialEntry.createMany).not.toHaveBeenCalled();
  });
});
