import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BomService } from './bom.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  product: {
    findMany: jest.fn(),
  },
  bomVersion: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('BomService', () => {
  let service: BomService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BomService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BomService>(BomService);
  });

  describe('create', () => {
    it('should throw NotFoundException when a componentId does not exist in DB', async () => {
      const dto = {
        productId: 'prod-1',
        companyId: 'company-1',
        items: [
          { componentId: 'comp-missing', quantity: 1 },
        ],
      };

      // Return empty array — component not found
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('should auto-increment version (first BOM = v1)', async () => {
      const dto = {
        productId: 'prod-1',
        companyId: 'company-1',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      };

      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce(null); // no existing version
      mockPrisma.bomVersion.create.mockResolvedValueOnce({
        id: 'bom-v1',
        version: 1,
        isActive: false,
        productId: 'prod-1',
        companyId: 'company-1',
        items: [],
      });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.create(dto);
      expect(mockPrisma.bomVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1 }),
        }),
      );
      expect(result.version).toBe(1);
    });

    it('should auto-increment version to v2 when v1 already exists', async () => {
      const dto = {
        productId: 'prod-1',
        companyId: 'company-1',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      };

      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce({ version: 1 }); // existing v1
      mockPrisma.bomVersion.create.mockResolvedValueOnce({
        id: 'bom-v2',
        version: 2,
        isActive: false,
        productId: 'prod-1',
        companyId: 'company-1',
        items: [],
      });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.create(dto);
      expect(mockPrisma.bomVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 2 }),
        }),
      );
      expect(result.version).toBe(2);
    });
  });

  describe('activate', () => {
    it('should set old active version to isActive=false, new one to isActive=true', async () => {
      const bomVersionId = 'bom-v2';
      const companyId = 'company-1';

      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce({
        id: bomVersionId,
        productId: 'prod-1',
        companyId,
        version: 2,
        isActive: false,
      });

      const txResult = {
        id: bomVersionId,
        version: 2,
        isActive: true,
        productId: 'prod-1',
        companyId,
        items: [],
      };

      mockPrisma.$transaction.mockImplementationOnce(async (fn) => {
        const txMock = {
          bomVersion: {
            updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
            update: jest.fn().mockResolvedValueOnce(txResult),
          },
        };
        return fn(txMock);
      });

      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.activate(bomVersionId, companyId);
      expect(result.isActive).toBe(true);
    });

    it('should throw NotFoundException when BOM version not found', async () => {
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.activate('non-existent-id', 'company-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
