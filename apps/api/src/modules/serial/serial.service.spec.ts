import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SerialStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSerialDto } from './dto/create-serial.dto';
import { UpdateSerialDto } from './dto/update-serial.dto';
import { SerialService } from './serial.service';

const mockPrisma = {
  serialNumber: {
    create: jest.fn(),
    createMany: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  product: { findFirst: jest.fn() },
  saleItem: { update: jest.fn() },
};

describe('SerialService', () => {
  let service: SerialService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SerialService>(SerialService);
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a serial number with IN_STOCK default', async () => {
      const dto: CreateSerialDto = {
        serial: 'SN-001',
        productId: 'prod-1',
      };
      const expected = { id: 'uuid-1', ...dto, status: SerialStatus.IN_STOCK };
      mockPrisma.serialNumber.create.mockResolvedValue(expected);

      const result = await service.create('company-1', dto);

      expect(mockPrisma.serialNumber.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          serial: 'SN-001',
          productId: 'prod-1',
          warehouseId: undefined,
          status: SerialStatus.IN_STOCK,
          productionOrderId: undefined,
          observations: undefined,
        },
      });
      expect(result).toEqual(expected);
    });
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should list without filters', async () => {
      const items = [{ id: '1', serial: 'SN-001' }];
      mockPrisma.serialNumber.findMany.mockResolvedValue(items);

      const result = await service.list('company-1');

      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-1' } }),
      );
      expect(result).toEqual(items);
    });

    it('should list with status and productId filters', async () => {
      mockPrisma.serialNumber.findMany.mockResolvedValue([]);

      await service.list('company-1', {
        status: SerialStatus.IN_STOCK,
        productId: 'prod-1',
      });

      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'company-1',
            status: SerialStatus.IN_STOCK,
            productId: 'prod-1',
          },
        }),
      );
    });

    it('should list with search filter', async () => {
      mockPrisma.serialNumber.findMany.mockResolvedValue([]);

      await service.list('company-1', { search: 'SN-0' });

      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'company-1',
            serial: { contains: 'SN-0', mode: 'insensitive' },
          },
        }),
      );
    });
  });

  // ─── getById ─────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('should return serial when found', async () => {
      const serial = { id: 'uuid-1', companyId: 'company-1' };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);

      const result = await service.getById('uuid-1', 'company-1');
      expect(result).toEqual(serial);
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.serialNumber.findFirst.mockResolvedValue(null);

      await expect(service.getById('bad-id', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── linkToProduction ────────────────────────────────────────────────────

  describe('linkToProduction', () => {
    it('should link serial to production order when IN_STOCK', async () => {
      const serial = {
        id: 'uuid-1',
        serial: 'SN-001',
        status: SerialStatus.IN_STOCK,
        companyId: 'company-1',
      };
      const updated = { ...serial, status: SerialStatus.IN_PRODUCTION };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);
      mockPrisma.serialNumber.update.mockResolvedValue(updated);

      const result = await service.linkToProduction(
        'uuid-1',
        'po-1',
        'company-1',
      );

      expect(mockPrisma.serialNumber.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'uuid-1' },
          data: expect.objectContaining({
            productionOrderId: 'po-1',
            status: SerialStatus.IN_PRODUCTION,
          }),
        }),
      );
      expect(result.status).toBe(SerialStatus.IN_PRODUCTION);
    });

    it('should throw BadRequestException if status is not IN_STOCK', async () => {
      const serial = {
        id: 'uuid-1',
        serial: 'SN-001',
        status: SerialStatus.SOLD,
        companyId: 'company-1',
      };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);

      await expect(
        service.linkToProduction('uuid-1', 'po-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── linkToSale ───────────────────────────────────────────────────────────

  describe('linkToSale', () => {
    it('should link serial to sales order when IN_STOCK', async () => {
      const serial = {
        id: 'uuid-1',
        serial: 'SN-001',
        status: SerialStatus.IN_STOCK,
        companyId: 'company-1',
      };
      const updated = { ...serial, status: SerialStatus.SOLD };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);
      mockPrisma.serialNumber.update.mockResolvedValue(updated);

      const result = await service.linkToSale('uuid-1', 'so-1', 'company-1');

      expect(mockPrisma.serialNumber.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'uuid-1' },
          data: expect.objectContaining({
            salesOrderId: 'so-1',
            status: SerialStatus.SOLD,
          }),
        }),
      );
      expect(result.status).toBe(SerialStatus.SOLD);
    });

    it('should throw BadRequestException if status is not IN_STOCK', async () => {
      const serial = {
        id: 'uuid-1',
        serial: 'SN-001',
        status: SerialStatus.IN_PRODUCTION,
        companyId: 'company-1',
      };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);

      await expect(
        service.linkToSale('uuid-1', 'so-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── scrap ────────────────────────────────────────────────────────────────

  describe('scrap', () => {
    it('should set status to SCRAPPED with reason', async () => {
      const serial = { id: 'uuid-1', companyId: 'company-1' };
      const updated = { ...serial, status: SerialStatus.SCRAPPED, observations: 'damaged' };
      mockPrisma.serialNumber.findFirst.mockResolvedValue(serial);
      mockPrisma.serialNumber.update.mockResolvedValue(updated);

      const result = await service.scrap('uuid-1', 'company-1', 'damaged');

      expect(mockPrisma.serialNumber.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: SerialStatus.SCRAPPED, observations: 'damaged' },
      });
      expect(result.status).toBe(SerialStatus.SCRAPPED);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct structure with groupBy status', async () => {
      mockPrisma.serialNumber.count.mockResolvedValue(42);
      mockPrisma.serialNumber.groupBy.mockResolvedValue([
        { status: SerialStatus.IN_STOCK, _count: { _all: 30 } },
        { status: SerialStatus.SOLD, _count: { _all: 10 } },
        { status: SerialStatus.SCRAPPED, _count: { _all: 2 } },
      ]);
      mockPrisma.serialNumber.findMany.mockResolvedValue([
        { id: '1', serial: 'SN-001', producedAt: new Date() },
      ]);

      const result = await service.getStats('company-1');

      expect(result.total).toBe(42);
      expect(result.byStatus.IN_STOCK).toBe(30);
      expect(result.byStatus.SOLD).toBe(10);
      expect(result.byStatus.SCRAPPED).toBe(2);
      expect(result.byStatus.IN_PRODUCTION).toBe(0);
      expect(result.byStatus.TRANSFERRED).toBe(0);
      expect(Array.isArray(result.recentlyProduced)).toBe(true);
    });
  });

  // ─── generateForProduction (#176) ─────────────────────────────────────────

  describe('generateForProduction', () => {
    it('should generate serials for product with tracksSerial=true', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ tracksSerial: true, sku: 'REB-3E' });
      mockPrisma.serialNumber.findFirst.mockResolvedValue(null); // no existing serials
      mockPrisma.serialNumber.createMany.mockResolvedValue({ count: 3 });

      const result = await service.generateForProduction(
        'company-1', 'op-1', 'p-1', 'wh-1', 3,
      );

      expect(result.generated).toBe(3);
      expect(result.serials).toHaveLength(3);
      expect(result.serials[0]).toMatch(/^REB-3E-\d{4}-000001$/);
      expect(result.serials[2]).toMatch(/^REB-3E-\d{4}-000003$/);
      expect(mockPrisma.serialNumber.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            companyId: 'company-1',
            productId: 'p-1',
            warehouseId: 'wh-1',
            productionOrderId: 'op-1',
            status: 'IN_STOCK',
          }),
        ]),
      });
    });

    it('should continue sequence from last existing serial', async () => {
      const year = new Date().getFullYear();
      mockPrisma.product.findFirst.mockResolvedValue({ tracksSerial: true, sku: 'REB-3E' });
      mockPrisma.serialNumber.findFirst.mockResolvedValue({ serial: `REB-3E-${year}-000042` });
      mockPrisma.serialNumber.createMany.mockResolvedValue({ count: 2 });

      const result = await service.generateForProduction(
        'company-1', 'op-2', 'p-1', 'wh-1', 2,
      );

      expect(result.serials[0]).toBe(`REB-3E-${year}-000043`);
      expect(result.serials[1]).toBe(`REB-3E-${year}-000044`);
    });

    it('should skip generation for product with tracksSerial=false', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ tracksSerial: false, sku: 'MP001' });

      const result = await service.generateForProduction(
        'company-1', 'op-1', 'p-1', 'wh-1', 5,
      );

      expect(result.generated).toBe(0);
      expect(result.serials).toHaveLength(0);
      expect(mockPrisma.serialNumber.createMany).not.toHaveBeenCalled();
    });
  });

  // ─── assignForSale (#176) ─────────────────────────────────────────────────

  describe('assignForSale', () => {
    it('should assign available serials to sale items', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ tracksSerial: true });
      mockPrisma.serialNumber.findMany.mockResolvedValue([
        { id: 'sn-1', serial: 'REB-3E-2026-000001' },
      ]);
      mockPrisma.serialNumber.update.mockResolvedValue({});
      mockPrisma.saleItem.update.mockResolvedValue({});

      const result = await service.assignForSale(
        'company-1',
        'so-1',
        [{ saleItemId: 'si-1', productId: 'p-1', quantity: 1 }],
      );

      expect(result.assigned).toBe(1);
      expect(result.details[0].serial).toBe('REB-3E-2026-000001');
      expect(mockPrisma.serialNumber.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sn-1' },
          data: expect.objectContaining({ salesOrderId: 'so-1', status: 'SOLD' }),
        }),
      );
      expect(mockPrisma.saleItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'si-1' },
          data: { serialNumberId: 'sn-1' },
        }),
      );
    });

    it('should skip non-serial products', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ tracksSerial: false });

      const result = await service.assignForSale(
        'company-1',
        'so-1',
        [{ saleItemId: 'si-1', productId: 'p-mp', quantity: 10 }],
      );

      expect(result.assigned).toBe(0);
      expect(mockPrisma.serialNumber.findMany).not.toHaveBeenCalled();
    });
  });
});
