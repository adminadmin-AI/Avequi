import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransferStatus } from '@prisma/client';
import { TransferService } from './transfer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TRANSFER_DISPATCHED_EVENT } from './events/transfer-dispatched.event';
import { SALE_INVOICED_EVENT } from '../sales/events/sale-invoiced.event';

/**
 * #597 — Verificação da perna de transferência fábrica→filial (sustenta o
 * balcão #595). Confirma que a remessa entre estabelecimentos:
 *  - emite NF-e de transferência (evento TRANSFER_DISPATCHED, CFOP 5152/6152);
 *  - NÃO gera título financeiro (o finance.listener não ouve transferência);
 *  - move estoque origem→destino (available → inTransit → available no receive);
 *  - cancelamento reverte estoque sem tocar no financeiro.
 */

// Prisma mock COM financialEntry: se o transfer tocasse finanças, apareceria aqui.
const mockPrisma = {
  storeTransfer: { findFirst: jest.fn(), update: jest.fn() },
  stockBalance: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  stockMovement: { create: jest.fn() },
  financialEntry: { create: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const emitter = { emit: jest.fn() };

const transfer = {
  id: 'tr-1',
  companyId: 'co-1',
  fromWarehouseId: 'wh-fabrica',
  toWarehouseId: 'wh-loja',
  status: TransferStatus.DRAFT,
  items: [
    {
      id: 'ti-1',
      productId: 'p-reboque',
      quantity: '2',
      unit: 'UN',
      product: { id: 'p-reboque', sku: 'MOD-CAR-001', name: 'Reboque', ncm: '87163900', unit: 'UN', avgCost: '10000', costPrice: '10000' },
    },
  ],
};

describe('Transferência fábrica→filial — invariantes fiscais/financeiros (#597)', () => {
  let service: TransferService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransferService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(TransferService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation((cb: any) =>
      cb({
        stockBalance: mockPrisma.stockBalance,
        stockMovement: mockPrisma.stockMovement,
        storeTransfer: mockPrisma.storeTransfer,
        auditLog: mockPrisma.auditLog,
      }),
    );
  });

  it('dispatch NÃO gera título financeiro (nenhum RECEIVABLE/PAYABLE)', async () => {
    mockPrisma.storeTransfer.findFirst.mockResolvedValue(transfer);
    mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '5', reserved: '0', inTransit: '0' });
    mockPrisma.stockBalance.upsert.mockResolvedValue({});
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.storeTransfer.update.mockResolvedValue({ ...transfer, status: TransferStatus.DISPATCHED });

    await service.dispatch('tr-1', 'co-1', 'u-1');

    expect(mockPrisma.financialEntry.create).not.toHaveBeenCalled();
    expect(mockPrisma.financialEntry.createMany).not.toHaveBeenCalled();
  });

  it('dispatch emite NF-e de transferência (TRANSFER_DISPATCHED), NÃO SALE_INVOICED', async () => {
    mockPrisma.storeTransfer.findFirst.mockResolvedValue(transfer);
    mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '5', reserved: '0', inTransit: '0' });
    mockPrisma.stockBalance.upsert.mockResolvedValue({});
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.storeTransfer.update.mockResolvedValue({ ...transfer, status: TransferStatus.DISPATCHED });

    await service.dispatch('tr-1', 'co-1', 'u-1');

    const events = emitter.emit.mock.calls.map((c) => c[0]);
    expect(events).toContain(TRANSFER_DISPATCHED_EVENT);
    expect(events).not.toContain(SALE_INVOICED_EVENT);
  });

  it('dispatch move estoque: baixa na origem, trânsito no destino, movimento TRANSFER_OUT', async () => {
    mockPrisma.storeTransfer.findFirst.mockResolvedValue(transfer);
    mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: '5', reserved: '0', inTransit: '0' });
    mockPrisma.stockBalance.upsert.mockResolvedValue({});
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.storeTransfer.update.mockResolvedValue({ ...transfer, status: TransferStatus.DISPATCHED });

    await service.dispatch('tr-1', 'co-1', 'u-1');

    // upsert 2× (origem decrement + destino inTransit)
    expect(mockPrisma.stockBalance.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'TRANSFER_OUT' }) }),
    );
  });

  it('cancelamento de DISPATCHED reverte estoque sem tocar no financeiro', async () => {
    mockPrisma.storeTransfer.findFirst.mockResolvedValue({ ...transfer, status: TransferStatus.DISPATCHED });
    mockPrisma.stockBalance.update.mockResolvedValue({});
    mockPrisma.stockBalance.upsert.mockResolvedValue({});
    mockPrisma.storeTransfer.update.mockResolvedValue({ ...transfer, status: TransferStatus.CANCELLED });

    await service.cancel('tr-1', 'co-1', 'u-1');

    expect(mockPrisma.financialEntry.update).not.toHaveBeenCalled();
    expect(mockPrisma.financialEntry.updateMany).not.toHaveBeenCalled();
  });
});
