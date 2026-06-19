import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchEventType, BatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchService } from './batch.service';
import { AdjustBatchDto } from './dto/adjust-batch.dto';
import { ConsumeBatchDto } from './dto/consume-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';

const makeBatch = (overrides = {}) => ({
  id: 'batch-1',
  companyId: 'company-1',
  batchNumber: 'LOT-001',
  productId: 'prod-1',
  supplierId: null,
  goodsReceiptId: null,
  status: BatchStatus.ACTIVE,
  initialQty: new Prisma.Decimal('100'),
  currentQty: new Prisma.Decimal('100'),
  unit: 'UN',
  manufacturingDate: null,
  expirationDate: null,
  warehouseId: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockTx = {
  batch: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  batchEvent: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  batch: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
    count: jest.fn(),
  },
  batchEvent: {
    create: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb(mockTx)),
};

describe('BatchService', () => {
  let service: BatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BatchService>(BatchService);
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create batch with RECEIPT event', async () => {
      const dto: CreateBatchDto = {
        batchNumber: 'LOT-001',
        productId: 'prod-1',
        initialQty: 100,
      };
      const batch = makeBatch();

      mockPrisma.batch.findUnique.mockResolvedValue(null);
      mockTx.batch.create.mockResolvedValue(batch);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const result = await service.create('company-1', dto, 'user-1');

      expect(mockPrisma.batch.findUnique).toHaveBeenCalled();
      expect(mockTx.batch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            batchNumber: 'LOT-001',
            productId: 'prod-1',
          }),
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: BatchEventType.RECEIPT,
          }),
        }),
      );
      expect(result).toEqual(batch);
    });

    it('should throw ConflictException if batchNumber+productId already exists', async () => {
      mockPrisma.batch.findUnique.mockResolvedValue(makeBatch());

      await expect(
        service.create('company-1', {
          batchNumber: 'LOT-001',
          productId: 'prod-1',
          initialQty: 100,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── consume ─────────────────────────────────────────────────────────────

  describe('consume', () => {
    it('should deduct quantity and record CONSUMPTION event', async () => {
      const batch = makeBatch({ currentQty: new Prisma.Decimal('100') });
      const updated = makeBatch({ currentQty: new Prisma.Decimal('60') });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const dto: ConsumeBatchDto = { quantity: 40 };
      const result = await service.consume('batch-1', 'company-1', dto);

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentQty: new Prisma.Decimal('60'),
            status: BatchStatus.ACTIVE,
          }),
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: BatchEventType.CONSUMPTION }),
        }),
      );
      expect(result).toEqual(updated);
    });

    it('should set status CONSUMED when qty reaches 0', async () => {
      const batch = makeBatch({ currentQty: new Prisma.Decimal('50') });
      const updated = makeBatch({
        currentQty: new Prisma.Decimal('0'),
        status: BatchStatus.CONSUMED,
      });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      await service.consume('batch-1', 'company-1', { quantity: 50 });

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BatchStatus.CONSUMED }),
        }),
      );
    });

    it('should throw BadRequestException when quantity exceeds currentQty', async () => {
      const batch = makeBatch({ currentQty: new Prisma.Decimal('10') });
      mockTx.batch.findFirst.mockResolvedValue(batch);

      await expect(
        service.consume('batch-1', 'company-1', { quantity: 50 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when status is not ACTIVE', async () => {
      const batch = makeBatch({ status: BatchStatus.QUARANTINE });
      mockTx.batch.findFirst.mockResolvedValue(batch);

      await expect(
        service.consume('batch-1', 'company-1', { quantity: 10 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── quarantine ───────────────────────────────────────────────────────────

  describe('quarantine', () => {
    it('should set status to QUARANTINE and record event', async () => {
      const batch = makeBatch();
      const updated = makeBatch({ status: BatchStatus.QUARANTINE });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const result = await service.quarantine(
        'batch-1',
        'company-1',
        'suspeita contaminação',
      );

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: BatchStatus.QUARANTINE },
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: BatchEventType.QUARANTINE }),
        }),
      );
      expect(result.status).toBe(BatchStatus.QUARANTINE);
    });

    it('should throw BadRequestException when status is not ACTIVE', async () => {
      mockTx.batch.findFirst.mockResolvedValue(
        makeBatch({ status: BatchStatus.QUARANTINE }),
      );

      await expect(
        service.quarantine('batch-1', 'company-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('should release from QUARANTINE to ACTIVE', async () => {
      const batch = makeBatch({ status: BatchStatus.QUARANTINE });
      const updated = makeBatch({ status: BatchStatus.ACTIVE });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const result = await service.release('batch-1', 'company-1');

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: BatchStatus.ACTIVE },
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: BatchEventType.RELEASE }),
        }),
      );
      expect(result.status).toBe(BatchStatus.ACTIVE);
    });

    it('should throw BadRequestException when not in QUARANTINE', async () => {
      mockTx.batch.findFirst.mockResolvedValue(makeBatch());

      await expect(
        service.release('batch-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── scrap ────────────────────────────────────────────────────────────────

  describe('scrap', () => {
    it('should set status SCRAPPED and currentQty=0', async () => {
      const batch = makeBatch({ currentQty: new Prisma.Decimal('75') });
      const updated = makeBatch({
        status: BatchStatus.SCRAPPED,
        currentQty: new Prisma.Decimal('0'),
      });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const result = await service.scrap('batch-1', 'company-1', 'danificado');

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: BatchStatus.SCRAPPED,
            currentQty: 0,
          }),
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: BatchEventType.SCRAP }),
        }),
      );
      expect(result.status).toBe(BatchStatus.SCRAPPED);
    });
  });

  // ─── adjust ───────────────────────────────────────────────────────────────

  describe('adjust', () => {
    it('should set absolute qty and record ADJUSTMENT event with correct delta', async () => {
      const batch = makeBatch({ currentQty: new Prisma.Decimal('80') });
      const updated = makeBatch({ currentQty: new Prisma.Decimal('95') });

      mockTx.batch.findFirst.mockResolvedValue(batch);
      mockTx.batch.update.mockResolvedValue(updated);
      mockTx.batchEvent.create.mockResolvedValue({ id: 'ev-1' });

      const dto: AdjustBatchDto = { quantity: 95, notes: 'recontagem' };
      await service.adjust('batch-1', 'company-1', dto);

      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentQty: new Prisma.Decimal('95'),
          }),
        }),
      );
      expect(mockTx.batchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: BatchEventType.ADJUSTMENT,
            quantity: new Prisma.Decimal('15'), // delta abs
            qtyBefore: new Prisma.Decimal('80'),
            qtyAfter: new Prisma.Decimal('95'),
          }),
        }),
      );
    });
  });

  // ─── checkExpired ─────────────────────────────────────────────────────────

  describe('checkExpired', () => {
    it('should mark ACTIVE batches with past expirationDate as EXPIRED and return count', async () => {
      const expired = [
        makeBatch({ id: 'b-1', expirationDate: new Date('2020-01-01') }),
        makeBatch({ id: 'b-2', expirationDate: new Date('2021-01-01') }),
      ];

      mockPrisma.batch.findMany.mockResolvedValue(expired);
      mockTx.batch.update.mockResolvedValue({});
      mockTx.batchEvent.create.mockResolvedValue({});

      const count = await service.checkExpired('company-1');

      expect(count).toBe(2);
      expect(mockTx.batch.update).toHaveBeenCalledTimes(2);
      expect(mockTx.batchEvent.create).toHaveBeenCalledTimes(2);
      expect(mockTx.batch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: BatchStatus.EXPIRED },
        }),
      );
    });

    it('should return 0 when no expired batches found', async () => {
      mockPrisma.batch.findMany.mockResolvedValue([]);

      const count = await service.checkExpired('company-1');

      expect(count).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return correct stats structure', async () => {
      mockPrisma.batch.groupBy.mockResolvedValue([
        { status: BatchStatus.ACTIVE, _count: { _all: 10 } },
        { status: BatchStatus.QUARANTINE, _count: { _all: 2 } },
        { status: BatchStatus.CONSUMED, _count: { _all: 5 } },
        { status: BatchStatus.EXPIRED, _count: { _all: 1 } },
        { status: BatchStatus.SCRAPPED, _count: { _all: 3 } },
      ]);
      mockPrisma.batch.count.mockResolvedValue(3);
      mockPrisma.batch.findMany.mockResolvedValue([
        {
          currentQty: new Prisma.Decimal('10'),
          product: { avgCost: new Prisma.Decimal('5') },
        },
        {
          currentQty: new Prisma.Decimal('20'),
          product: { avgCost: new Prisma.Decimal('3') },
        },
      ]);

      const result = await service.getStats('company-1');

      expect(result.total).toBe(21);
      expect(result.active).toBe(10);
      expect(result.quarantine).toBe(2);
      expect(result.consumed).toBe(5);
      expect(result.expired).toBe(1);
      expect(result.scrapped).toBe(3);
      expect(result.expiringIn30Days).toBe(3);
      // 10*5 + 20*3 = 50 + 60 = 110
      expect(result.totalValue.toString()).toBe('110');
    });
  });
});
