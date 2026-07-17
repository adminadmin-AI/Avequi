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

// ─── #747: lado fiscal da devolução (SALE_RETURNED) ───────────────────────────
import { SaleReturnedEvent } from '../sales/events/sale-returned.event';
import { Test as NestTest } from '@nestjs/testing';

describe('FiscalListener.handleSaleReturned (#747)', () => {
  let listener: FiscalListener;
  const mockFiscalService = { cancel: jest.fn(), emitReturnNote: jest.fn() };
  const prisma = { fiscalDocument: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module = await NestTest.createTestingModule({
      providers: [
        FiscalListener,
        { provide: FiscalService, useValue: mockFiscalService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    listener = module.get(FiscalListener);
    jest.clearAllMocks();
  });

  it('NF-e AUTHORIZED dentro das 24h → cancela na SEFAZ (antes só marcava no banco)', async () => {
    prisma.fiscalDocument.findFirst.mockResolvedValue({
      id: 'nfe-1',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await listener.handleSaleReturned(new SaleReturnedEvent('co-1', 'so-1', 'defeito'));

    expect(mockFiscalService.cancel).toHaveBeenCalledWith('nfe-1', 'co-1', 'Devolução de venda — defeito');
    expect(mockFiscalService.emitReturnNote).not.toHaveBeenCalled();
  });

  it('NF-e AUTHORIZED fora das 24h → emite NF-e de devolução referenciada', async () => {
    prisma.fiscalDocument.findFirst.mockResolvedValue({
      id: 'nfe-1',
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });

    await listener.handleSaleReturned(new SaleReturnedEvent('co-1', 'so-1', 'defeito'));

    expect(mockFiscalService.emitReturnNote).toHaveBeenCalledWith('nfe-1', 'co-1', 'defeito');
    expect(mockFiscalService.cancel).not.toHaveBeenCalled();
  });

  it('sem NF-e AUTHORIZED → não faz nada no fiscal', async () => {
    prisma.fiscalDocument.findFirst.mockResolvedValue(null);

    await listener.handleSaleReturned(new SaleReturnedEvent('co-1', 'so-1'));

    expect(mockFiscalService.cancel).not.toHaveBeenCalled();
    expect(mockFiscalService.emitReturnNote).not.toHaveBeenCalled();
  });

  it('falha no lado fiscal não estoura (devolução interna preservada)', async () => {
    prisma.fiscalDocument.findFirst.mockResolvedValue({
      id: 'nfe-1',
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    mockFiscalService.emitReturnNote.mockRejectedValue(new Error('SEFAZ fora'));

    await expect(
      listener.handleSaleReturned(new SaleReturnedEvent('co-1', 'so-1', 'x')),
    ).resolves.toBeUndefined();
  });
});
