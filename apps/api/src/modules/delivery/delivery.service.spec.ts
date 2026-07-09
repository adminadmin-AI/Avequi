import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryService } from './delivery.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  delivery: { upsert: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  serialNumber: { findFirst: jest.fn() },
};

describe('DeliveryService', () => {
  let service: DeliveryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeliveryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(DeliveryService);
    jest.clearAllMocks();
  });

  it('createOnInvoice é idempotente (upsert por salesOrderId, cria AWAITING_BIN)', async () => {
    mockPrisma.delivery.upsert.mockResolvedValue({ id: 'd-1' });
    await service.createOnInvoice('co-1', 'so-1');
    const arg = mockPrisma.delivery.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ salesOrderId: 'so-1' });
    expect(arg.create.status).toBe('AWAITING_BIN');
    expect(arg.update).toEqual({}); // já existe → não recria
  });

  it('advanceOnBinRegistered avança a entrega da venda do chassi p/ AWAITING_PICKUP', async () => {
    mockPrisma.serialNumber.findFirst.mockResolvedValue({ salesOrderId: 'so-1' });
    mockPrisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    const r = await service.advanceOnBinRegistered('co-1', 'serial-1');
    expect(r.advanced).toBe(1);
    const arg = mockPrisma.delivery.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ companyId: 'co-1', salesOrderId: 'so-1', status: 'AWAITING_BIN' });
    expect(arg.data).toEqual({ status: 'AWAITING_PICKUP' });
  });

  it('advanceOnBinRegistered é no-op quando o chassi não tem venda', async () => {
    mockPrisma.serialNumber.findFirst.mockResolvedValue({ salesOrderId: null });
    const r = await service.advanceOnBinRegistered('co-1', 'serial-x');
    expect(r.advanced).toBe(0);
    expect(mockPrisma.delivery.updateMany).not.toHaveBeenCalled();
  });

  it('updateStatus=DELIVERED grava deliveredAt; inexistente → NotFound', async () => {
    mockPrisma.delivery.findFirst.mockResolvedValue({ id: 'd-1', deliveredAt: null });
    mockPrisma.delivery.update.mockResolvedValue({ id: 'd-1' });
    await service.updateStatus('co-1', 'd-1', { status: 'DELIVERED' } as any);
    const data = mockPrisma.delivery.update.mock.calls[0][0].data;
    expect(data.status).toBe('DELIVERED');
    expect(data.deliveredAt).toBeInstanceOf(Date);

    mockPrisma.delivery.findFirst.mockResolvedValue(null);
    await expect(service.updateStatus('co-1', 'x', { status: 'IN_TRANSIT' } as any)).rejects.toThrow(NotFoundException);
  });
});
