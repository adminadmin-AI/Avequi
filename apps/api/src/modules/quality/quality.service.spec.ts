import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InspectionStatus, InspectionType, NcrSeverity, NcrStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from './quality.service';

const mockPrisma = {
  inspection: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  nonConformance: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  supplier: {
    findMany: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

describe('QualityService', () => {
  let service: QualityService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<QualityService>(QualityService);
  });

  // ─── createInspection ────────────────────────────────────────────────────────

  describe('createInspection', () => {
    it('should create an inspection successfully', async () => {
      const dto = { type: InspectionType.RECEIVING, goodsReceiptId: 'gr-1' };
      const expected = {
        id: 'insp-1',
        companyId: 'company-1',
        type: InspectionType.RECEIVING,
        status: InspectionStatus.PENDING,
        goodsReceiptId: 'gr-1',
      };
      mockPrisma.inspection.create.mockResolvedValue(expected);

      const result = await service.createInspection('company-1', dto, 'user-1');

      expect(mockPrisma.inspection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          type: InspectionType.RECEIVING,
          goodsReceiptId: 'gr-1',
          status: InspectionStatus.PENDING,
        }),
      });
      expect(result).toEqual(expected);
    });

    it('should create auto inspection from goods receipt', async () => {
      const dto = {
        type: InspectionType.RECEIVING,
        goodsReceiptId: 'gr-auto',
        notes: 'Inspeção automática de recebimento',
      };
      mockPrisma.inspection.create.mockResolvedValue({ id: 'insp-auto' });

      await service.createInspection('company-1', dto);

      expect(mockPrisma.inspection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ goodsReceiptId: 'gr-auto' }),
      });
    });
  });

  // ─── startInspection ─────────────────────────────────────────────────────────

  describe('startInspection', () => {
    it('should transition PENDING → IN_PROGRESS', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.PENDING,
      });
      mockPrisma.inspection.update.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.IN_PROGRESS,
      });

      const result = await service.startInspection('insp-1', 'company-1', 'user-1');

      expect(mockPrisma.inspection.update).toHaveBeenCalledWith({
        where: { id: 'insp-1' },
        data: expect.objectContaining({
          status: InspectionStatus.IN_PROGRESS,
          startedAt: expect.any(Date),
        }),
      });
      expect(result.status).toBe(InspectionStatus.IN_PROGRESS);
    });

    it('should throw BadRequestException if inspection is not PENDING', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.IN_PROGRESS,
      });

      await expect(
        service.startInspection('insp-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if inspection not found', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue(null);

      await expect(
        service.startInspection('non-existent', 'company-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── passInspection ──────────────────────────────────────────────────────────

  describe('passInspection', () => {
    it('should transition IN_PROGRESS → PASSED', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.IN_PROGRESS,
      });
      mockPrisma.inspection.update.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.PASSED,
      });

      const result = await service.passInspection('insp-1', 'company-1');

      expect(mockPrisma.inspection.update).toHaveBeenCalledWith({
        where: { id: 'insp-1' },
        data: expect.objectContaining({
          status: InspectionStatus.PASSED,
          finishedAt: expect.any(Date),
        }),
      });
      expect(result.status).toBe(InspectionStatus.PASSED);
    });

    it('should throw BadRequestException if not IN_PROGRESS', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.PENDING,
      });

      await expect(
        service.passInspection('insp-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── failInspection ──────────────────────────────────────────────────────────

  describe('failInspection', () => {
    it('should transition IN_PROGRESS → FAILED and auto-create NCR', async () => {
      const inspectionFailed = { id: 'insp-1', status: InspectionStatus.FAILED };
      const ncrCreated = { id: 'ncr-1', status: NcrStatus.OPEN };

      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.IN_PROGRESS,
      });
      mockPrisma.inspection.update.mockResolvedValue(inspectionFailed);
      mockPrisma.nonConformance.create.mockResolvedValue(ncrCreated);

      const ncrDto = {
        title: 'Defeito na peça',
        description: 'Dimensional fora do tolerado',
        severity: NcrSeverity.MAJOR,
      };

      const result = await service.failInspection(
        'insp-1',
        'company-1',
        ncrDto,
        'user-1',
      );

      expect(mockPrisma.inspection.update).toHaveBeenCalledWith({
        where: { id: 'insp-1' },
        data: expect.objectContaining({ status: InspectionStatus.FAILED }),
      });
      expect(mockPrisma.nonConformance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          inspectionId: 'insp-1',
          title: 'Defeito na peça',
        }),
      });
      expect(result.inspection.status).toBe(InspectionStatus.FAILED);
      expect(result.ncr).toBeDefined();
    });

    it('should throw BadRequestException if not IN_PROGRESS', async () => {
      mockPrisma.inspection.findFirst.mockResolvedValue({
        id: 'insp-1',
        status: InspectionStatus.PASSED,
      });

      await expect(
        service.failInspection('insp-1', 'company-1', {
          title: 'T',
          description: 'D',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createNcr ───────────────────────────────────────────────────────────────

  describe('createNcr', () => {
    it('should create a manual NCR', async () => {
      const dto = {
        title: 'NCR manual',
        description: 'Produto com defeito visível',
        productId: 'prod-1',
      };
      const expected = { id: 'ncr-2', ...dto, status: NcrStatus.OPEN };
      mockPrisma.nonConformance.create.mockResolvedValue(expected);

      const result = await service.createNcr('company-1', dto, 'user-1');

      expect(mockPrisma.nonConformance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          title: 'NCR manual',
          productId: 'prod-1',
          createdById: 'user-1',
        }),
      });
      expect(result).toEqual(expected);
    });
  });

  // ─── closeNcr ────────────────────────────────────────────────────────────────

  describe('closeNcr', () => {
    it('should close NCR and set closedAt and closedById', async () => {
      mockPrisma.nonConformance.findFirst.mockResolvedValue({
        id: 'ncr-1',
        status: NcrStatus.CORRECTIVE_ACTION,
      });
      mockPrisma.nonConformance.update.mockResolvedValue({
        id: 'ncr-1',
        status: NcrStatus.CLOSED,
        closedAt: new Date(),
        closedById: 'user-1',
      });

      const result = await service.closeNcr('ncr-1', 'company-1', 'user-1');

      expect(mockPrisma.nonConformance.update).toHaveBeenCalledWith({
        where: { id: 'ncr-1' },
        data: expect.objectContaining({
          status: NcrStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 'user-1',
        }),
      });
      expect(result.status).toBe(NcrStatus.CLOSED);
    });

    it('should throw BadRequestException if already CLOSED', async () => {
      mockPrisma.nonConformance.findFirst.mockResolvedValue({
        id: 'ncr-1',
        status: NcrStatus.CLOSED,
      });

      await expect(
        service.closeNcr('ncr-1', 'company-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getQualityStats ─────────────────────────────────────────────────────────

  describe('getQualityStats', () => {
    it('should return the correct stats structure', async () => {
      mockPrisma.inspection.count
        .mockResolvedValueOnce(10)  // total
        .mockResolvedValueOnce(3)   // pending
        .mockResolvedValueOnce(5)   // passed
        .mockResolvedValueOnce(2)   // failed
        .mockResolvedValueOnce(0);  // onHold

      mockPrisma.nonConformance.count
        .mockResolvedValueOnce(4)   // total
        .mockResolvedValueOnce(2)   // open
        .mockResolvedValueOnce(1)   // underAnalysis
        .mockResolvedValueOnce(1);  // closed

      mockPrisma.nonConformance.groupBy
        .mockResolvedValueOnce([
          { supplierId: 'sup-1', _count: { id: 2 } },
        ])
        .mockResolvedValueOnce([
          { productId: 'prod-1', _count: { id: 1 } },
        ]);

      mockPrisma.supplier.findMany.mockResolvedValue([
        { id: 'sup-1', name: 'Fornecedor A' },
      ]);
      mockPrisma.product.findMany.mockResolvedValue([
        { id: 'prod-1', sku: 'SKU-001', name: 'Produto A' },
      ]);

      const result = await service.getQualityStats('company-1');

      expect(result).toMatchObject({
        inspections: {
          total: 10,
          pending: 3,
          passed: 5,
          failed: 2,
          onHold: 0,
        },
        ncrs: {
          total: 4,
          open: 2,
          underAnalysis: 1,
          closed: 1,
        },
        rejectionRateBySupplier: expect.arrayContaining([
          expect.objectContaining({
            supplierId: 'sup-1',
            supplierName: 'Fornecedor A',
          }),
        ]),
        rejectionRateByProduct: expect.arrayContaining([
          expect.objectContaining({
            productId: 'prod-1',
            sku: 'SKU-001',
          }),
        ]),
      });
    });
  });
});
