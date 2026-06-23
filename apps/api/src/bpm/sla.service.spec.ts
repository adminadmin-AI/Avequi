import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { SlaService } from './sla.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const companyId = 'company-1';

const mockSlaDefinition = {
  id: 'sla-1',
  companyId,
  entityType: 'PURCHASE_ORDER',
  statusFrom: 'PENDING',
  statusTo: 'APPROVED',
  maxDurationHours: 48,
  escalateToRole: 'DIRECTOR',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockBreach = {
  id: 'breach-1',
  slaDefinitionId: 'sla-1',
  entityType: 'PURCHASE_ORDER',
  entityId: 'po-1',
  expectedAt: new Date(Date.now() - 3600000), // 1 hour ago
  breachedAt: new Date(),
  resolved: false,
  resolvedAt: null,
  createdAt: new Date(),
};

const mockPrisma = {
  slaDefinition: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  slaBreach: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('SlaService', () => {
  let service: SlaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SlaService>(SlaService);
    jest.clearAllMocks();
  });

  describe('createDefinition', () => {
    it('should create SLA definition', async () => {
      mockPrisma.slaDefinition.create.mockResolvedValue(mockSlaDefinition);

      const result = await service.createDefinition(companyId, {
        entityType: 'PURCHASE_ORDER',
        statusFrom: 'PENDING',
        statusTo: 'APPROVED',
        maxDurationHours: 48,
        escalateToRole: 'DIRECTOR',
      });

      expect(mockPrisma.slaDefinition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId,
          entityType: 'PURCHASE_ORDER',
          maxDurationHours: 48,
          isActive: true,
        }),
      });
      expect(result).toEqual(mockSlaDefinition);
    });

    it('should default isActive to true', async () => {
      mockPrisma.slaDefinition.create.mockResolvedValue(mockSlaDefinition);

      await service.createDefinition(companyId, {
        entityType: 'PURCHASE_ORDER',
        statusFrom: 'PENDING',
        statusTo: 'APPROVED',
        maxDurationHours: 24,
      });

      expect(mockPrisma.slaDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findDefinitions', () => {
    it('should return all definitions for company', async () => {
      mockPrisma.slaDefinition.findMany.mockResolvedValue([mockSlaDefinition]);

      const result = await service.findDefinitions(companyId);
      expect(result).toHaveLength(1);
    });

    it('should filter by entityType', async () => {
      mockPrisma.slaDefinition.findMany.mockResolvedValue([mockSlaDefinition]);

      await service.findDefinitions(companyId, 'PURCHASE_ORDER');
      expect(mockPrisma.slaDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'PURCHASE_ORDER' }),
        }),
      );
    });
  });

  describe('updateDefinition', () => {
    it('should update definition', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(mockSlaDefinition);
      mockPrisma.slaDefinition.update.mockResolvedValue({
        ...mockSlaDefinition,
        maxDurationHours: 72,
      });

      const result = await service.updateDefinition(companyId, 'sla-1', {
        maxDurationHours: 72,
      });
      expect(result.maxDurationHours).toBe(72);
    });

    it('should throw NOT_FOUND if definition does not exist', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDefinition(companyId, 'bad-id', {}),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('deleteDefinition', () => {
    it('should delete definition', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(mockSlaDefinition);
      mockPrisma.slaDefinition.delete.mockResolvedValue(mockSlaDefinition);

      await service.deleteDefinition(companyId, 'sla-1');
      expect(mockPrisma.slaDefinition.delete).toHaveBeenCalledWith({ where: { id: 'sla-1' } });
    });

    it('should throw NOT_FOUND if definition does not exist', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(null);

      await expect(service.deleteDefinition(companyId, 'bad-id')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe('checkSla', () => {
    it('should return not breached when within SLA', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(mockSlaDefinition);

      const recentStart = new Date(); // started right now → 48h window not elapsed
      const result = await service.checkSla(
        companyId,
        'PURCHASE_ORDER',
        'po-1',
        'PENDING',
        'APPROVED',
        recentStart,
      );

      expect(result.breached).toBe(false);
      expect(result.expectedAt).toBeInstanceOf(Date);
    });

    it('should detect and record breach when SLA is exceeded', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(mockSlaDefinition);
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null);
      mockPrisma.slaBreach.create.mockResolvedValue(mockBreach);

      const oldStart = new Date(Date.now() - 50 * 60 * 60 * 1000); // 50 hours ago
      const result = await service.checkSla(
        companyId,
        'PURCHASE_ORDER',
        'po-1',
        'PENDING',
        'APPROVED',
        oldStart,
      );

      expect(result.breached).toBe(true);
      expect(mockPrisma.slaBreach.create).toHaveBeenCalled();
    });

    it('should not duplicate breach records', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(mockSlaDefinition);
      mockPrisma.slaBreach.findFirst.mockResolvedValue(mockBreach); // already exists

      const oldStart = new Date(Date.now() - 50 * 60 * 60 * 1000);
      await service.checkSla(companyId, 'PURCHASE_ORDER', 'po-1', 'PENDING', 'APPROVED', oldStart);

      expect(mockPrisma.slaBreach.create).not.toHaveBeenCalled();
    });

    it('should return no breach when no matching SLA definition', async () => {
      mockPrisma.slaDefinition.findFirst.mockResolvedValue(null);

      const result = await service.checkSla(
        companyId,
        'SALES_ORDER',
        'so-1',
        'PENDING',
        'APPROVED',
        new Date(),
      );

      expect(result.breached).toBe(false);
      expect(result.definition).toBeNull();
    });
  });

  describe('findBreaches', () => {
    it('should return breaches for company', async () => {
      mockPrisma.slaBreach.findMany.mockResolvedValue([mockBreach]);

      const result = await service.findBreaches(companyId);
      expect(result).toHaveLength(1);
    });

    it('should filter by resolved status', async () => {
      mockPrisma.slaBreach.findMany.mockResolvedValue([]);

      await service.findBreaches(companyId, { resolved: false });
      expect(mockPrisma.slaBreach.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resolved: false }),
        }),
      );
    });
  });

  describe('resolveBreach', () => {
    it('should mark breach as resolved', async () => {
      mockPrisma.slaBreach.findUnique.mockResolvedValue(mockBreach);
      mockPrisma.slaBreach.update.mockResolvedValue({
        ...mockBreach,
        resolved: true,
        resolvedAt: new Date(),
      });

      const result = await service.resolveBreach('breach-1');
      expect(result.resolved).toBe(true);
      expect(result.resolvedAt).toBeInstanceOf(Date);
    });

    it('should throw NOT_FOUND when breach does not exist', async () => {
      mockPrisma.slaBreach.findUnique.mockResolvedValue(null);

      await expect(service.resolveBreach('bad-id')).rejects.toThrow(
        new BusinessException('Violação de SLA não encontrada', HttpStatus.NOT_FOUND),
      );
    });
  });
});
