import { Test } from '@nestjs/testing';
import { FiscalListener } from './fiscal.listener';
import { FiscalService } from './fiscal.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalCancelledEvent } from './events/fiscal-cancelled.event';

const mockPrisma = {
  financialEntry: { updateMany: jest.fn() },
  salesOrder: { findFirst: jest.fn() },
  stockMovement: { findMany: jest.fn(), create: jest.fn() },
  stockBalance: { updateMany: jest.fn() },
};

describe('FiscalListener.handleFiscalCancelled (#586: 1:N)', () => {
  let listener: FiscalListener;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        FiscalListener,
        { provide: FiscalService, useValue: {} },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    listener = module.get(FiscalListener);
    jest.clearAllMocks();
    mockPrisma.financialEntry.updateMany.mockResolvedValue({ count: 4 });
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ status: 'INVOICED' });
    mockPrisma.stockMovement.findMany.mockResolvedValue([]);
  });

  it('cancela TODOS os recebíveis da venda (não só o do fiscalDocumentId)', async () => {
    await listener.handleFiscalCancelled(
      new FiscalCancelledEvent('co-1', 'fd-1', 'so-1', null),
    );

    expect(mockPrisma.financialEntry.updateMany).toHaveBeenCalledWith({
      where: {
        salesOrderId: 'so-1',
        type: 'RECEIVABLE',
        status: { not: 'CANCELLED' },
      },
      data: { status: 'CANCELLED' },
    });
  });

  it('sem salesOrderId → fallback por fiscalDocumentId', async () => {
    await listener.handleFiscalCancelled(
      new FiscalCancelledEvent('co-1', 'fd-1', null, null),
    );

    expect(mockPrisma.financialEntry.updateMany).toHaveBeenCalledWith({
      where: { fiscalDocumentId: 'fd-1', status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    });
  });
});
