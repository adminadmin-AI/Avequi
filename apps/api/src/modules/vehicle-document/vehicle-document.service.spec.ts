import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VehicleDocumentService } from './vehicle-document.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  vehicleDocument: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  vehicleDocumentDelivery: { create: jest.fn(), findMany: jest.fn() },
  salesOrder: { findMany: jest.fn() },
};

describe('VehicleDocumentService', () => {
  let service: VehicleDocumentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VehicleDocumentService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(VehicleDocumentService);
    jest.clearAllMocks();
  });

  it('cria documento com datas convertidas e status default ACTIVE', async () => {
    mockPrisma.vehicleDocument.create.mockResolvedValue({ id: 'vd-1' });
    await service.createDocument('co-1', {
      productId: 'p-1',
      type: 'CAT',
      documentNumber: 'CAT-123',
      issuedAt: '2026-07-01',
    } as any);

    const data = mockPrisma.vehicleDocument.create.mock.calls[0][0].data;
    expect(data.companyId).toBe('co-1');
    expect(data.type).toBe('CAT');
    expect(data.status).toBe('ACTIVE');
    expect(data.issuedAt).toBeInstanceOf(Date);
    expect(data.expiresAt).toBeNull();
  });

  it('getDocument inclui entregas; inexistente → NotFound', async () => {
    mockPrisma.vehicleDocument.findFirst.mockResolvedValue({ id: 'vd-1', deliveries: [] });
    const r = await service.getDocument('co-1', 'vd-1');
    expect(r.id).toBe('vd-1');

    mockPrisma.vehicleDocument.findFirst.mockResolvedValue(null);
    await expect(service.getDocument('co-1', 'x')).rejects.toThrow(NotFoundException);
  });

  it('registerDelivery valida o documento e usa deliveredAt=agora por padrão', async () => {
    mockPrisma.vehicleDocument.findFirst.mockResolvedValue({ id: 'vd-1' });
    mockPrisma.vehicleDocumentDelivery.create.mockResolvedValue({ id: 'del-1' });
    await service.registerDelivery('co-1', 'vd-1', {
      salesOrderId: 'so-1',
      deliveredTo: 'END_CUSTOMER',
    } as any);

    const data = mockPrisma.vehicleDocumentDelivery.create.mock.calls[0][0].data;
    expect(data.vehicleDocumentId).toBe('vd-1');
    expect(data.salesOrderId).toBe('so-1');
    expect(data.deliveredTo).toBe('END_CUSTOMER');
    expect(data.deliveredAt).toBeInstanceOf(Date);
  });

  it('registerDelivery em documento inexistente → NotFound', async () => {
    mockPrisma.vehicleDocument.findFirst.mockResolvedValue(null);
    await expect(
      service.registerDelivery('co-1', 'x', { salesOrderId: 'so-1', deliveredTo: 'RESELLER' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('salesMissingDocuments retorna vendas de veículo faturadas sem entrega', async () => {
    mockPrisma.salesOrder.findMany.mockResolvedValue([
      { id: 'so-1', invoicedAt: new Date(), createdAt: new Date() },
      { id: 'so-2', invoicedAt: new Date(), createdAt: new Date() },
    ]);
    mockPrisma.vehicleDocumentDelivery.findMany.mockResolvedValue([{ salesOrderId: 'so-1' }]);

    const r = await service.salesMissingDocuments('co-1');
    // so-1 tem entrega; só so-2 fica pendente
    expect(r.map((s) => s.id)).toEqual(['so-2']);
  });
});
