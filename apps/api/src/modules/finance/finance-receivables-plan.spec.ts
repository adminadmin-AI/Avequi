import { Test, TestingModule } from '@nestjs/testing';
import { DebtorType, FinancialEntryStatus, FinancialEntryType, PaymentMethod } from '@prisma/client';
import { FinanceService } from './finance.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #586 — geração de títulos a partir do plano de pagamento (#584).
 * Cartão → recebível LÍQUIDO contra a ADQUIRENTE na data de liquidação;
 * boleto → parcelas contra o CLIENTE; à vista → D+0; MDR → despesa PAGA.
 */

const txCreated: any[] = [];
const tx = {
  financialEntry: {
    create: jest.fn((args: any) => {
      txCreated.push(args.data);
      return Promise.resolve({ id: `fe-${txCreated.length}`, ...args.data });
    }),
  },
};

const mockPrisma = {
  salesOrder: { findFirst: jest.fn() },
  financialEntry: { findFirst: jest.fn(), create: jest.fn() },
  financialCategory: { findFirst: jest.fn(), create: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(tx)),
};

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
const daysFromNow = (d: Date) => Math.round((d.getTime() - Date.now()) / DAY);

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
    txCreated.length = 0;
    mockPrisma.financialEntry.findFirst.mockResolvedValue(null); // sem CR anterior
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.financialCategory.findFirst.mockResolvedValue({ id: 'cat-mdr' });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
  });

  it('cartão crédito 4x: 4 CRs líquidos contra a ADQUIRENTE em D+30/60/90/120 + MDR paga', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [pay()] });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 8000 });

    const crs = txCreated.filter((e) => e.type === FinancialEntryType.RECEIVABLE);
    const mdr = txCreated.filter((e) => e.type === FinancialEntryType.PAYABLE);

    expect(crs).toHaveLength(4);
    // líquido: 8000 − 280 = 7720 → 1930 por parcela
    expect(crs.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(7720, 2);
    for (const [i, cr] of crs.entries()) {
      expect(cr.debtorType).toBe(DebtorType.ACQUIRER);
      expect(cr.acquirerId).toBe('acq-1');
      expect(cr.salesPaymentId).toBe('sp-1');
      expect(cr.installmentNumber).toBe(i + 1);
      expect(daysFromNow(cr.dueDate)).toBe(30 + 30 * i); // D+30, +30/parcela
    }
    // MDR: despesa PAGA na categoria própria, contra a adquirente
    expect(mdr).toHaveLength(1);
    expect(mdr[0]).toEqual(
      expect.objectContaining({
        amount: 280,
        status: FinancialEntryStatus.PAID,
        debtorType: DebtorType.ACQUIRER,
        categoryId: 'cat-mdr',
      }),
    );
  });

  it('boleto 3x: 3 parcelas contra o CLIENTE a cada 30 dias, soma = bruto', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.BOLETO, amount: 1000, installments: 3, acquirerId: null, mdrAmount: null, settlementDays: null })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 1000 });

    const crs = txCreated.filter((e) => e.type === FinancialEntryType.RECEIVABLE);
    expect(crs).toHaveLength(3);
    expect(crs.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(1000, 2);
    expect(crs.map((e) => daysFromNow(e.dueDate))).toEqual([30, 60, 90]);
    for (const cr of crs) expect(cr.debtorType).toBe(DebtorType.CUSTOMER);
    // arredondamento: 333.33 + 333.33 + 333.34
    expect(crs[2].amount).toBeCloseTo(333.34, 2);
    expect(txCreated.filter((e) => e.type === FinancialEntryType.PAYABLE)).toHaveLength(0);
  });

  it('cartão débito: 1 CR líquido contra a ADQUIRENTE em D+1', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.CARTAO_DEBITO, amount: 500, installments: 1, mdrRate: 1.99, mdrAmount: 9.95, settlementDays: 1 })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 500 });

    const crs = txCreated.filter((e) => e.type === FinancialEntryType.RECEIVABLE);
    expect(crs).toHaveLength(1);
    expect(crs[0].amount).toBeCloseTo(490.05, 2);
    expect(crs[0].debtorType).toBe(DebtorType.ACQUIRER);
    expect(daysFromNow(crs[0].dueDate)).toBe(1);
  });

  it('PIX à vista: 1 CR contra o CLIENTE em D+0', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [pay({ method: PaymentMethod.PIX, amount: 750, installments: 1, acquirerId: null, mdrAmount: null })],
    });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 750 });

    const crs = txCreated.filter((e) => e.type === FinancialEntryType.RECEIVABLE);
    expect(crs).toHaveLength(1);
    expect(crs[0]).toEqual(
      expect.objectContaining({ amount: 750, debtorType: DebtorType.CUSTOMER, installmentNumber: 1 }),
    );
    expect(daysFromNow(crs[0].dueDate)).toBe(0);
  });

  it('plano misto: NF-e vinculada só ao primeiro título; cria categoria MDR se faltar', async () => {
    mockPrisma.financialCategory.findFirst.mockResolvedValue(null);
    mockPrisma.financialCategory.create.mockResolvedValue({ id: 'cat-nova' });
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

    const withNfe = txCreated.filter((e) => e.fiscalDocumentId === 'fd-1');
    expect(withNfe).toHaveLength(1); // fiscalDocumentId é @unique
    expect(txCreated[0].fiscalDocumentId).toBe('fd-1');
    const mdr = txCreated.find((e) => e.type === FinancialEntryType.PAYABLE);
    expect(mdr?.categoryId).toBe('cat-nova');
    expect(mockPrisma.financialCategory.create).toHaveBeenCalled();
  });

  it('sem plano → legado: 1 CR cliente em 30 dias (fora da transação)', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [] });
    mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-legacy' });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 300 });

    expect(mockPrisma.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 300 }) }),
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('idempotência: CR existente → não regenera nada', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1' });

    await service.createReceivableForSale({ companyId: 'co-1', salesOrderId: 'so-1', amount: 300 });

    expect(mockPrisma.salesOrder.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
