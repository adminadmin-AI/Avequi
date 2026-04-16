import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: any;

  const mockUser = { id: 'user-1', role: 'MANAGER' };

  beforeEach(async () => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('create', () => {
    it('should throw BadRequestException when type=FINISHED_GOOD and no NCM', async () => {
      const dto = {
        sku: 'PROD-001',
        name: 'Test Product',
        type: 'FINISHED_GOOD' as any,
        companyId: 'company-1',
      };

      await expect(service.create(dto, mockUser)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(dto, mockUser)).rejects.toThrow(
        'Produto acabado exige NCM',
      );
    });

    it('should throw ConflictException when SKU already exists for the company', async () => {
      const dto = {
        sku: 'EXISTING-SKU',
        name: 'Test Product',
        type: 'RAW_MATERIAL' as any,
        companyId: 'company-1',
      };

      prisma.product.findUnique.mockResolvedValue({
        id: 'existing-id',
        ...dto,
      });

      await expect(service.create(dto, mockUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should succeed when type=FINISHED_GOOD and NCM is provided', async () => {
      const dto = {
        sku: 'CAL-001',
        name: 'Calçado Social',
        type: 'FINISHED_GOOD' as any,
        ncm: '6403.99.00',
        companyId: 'company-1',
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({ data: dto });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should succeed when type=RAW_MATERIAL without NCM', async () => {
      const dto = {
        sku: 'MP-001',
        name: 'Couro Bovino',
        type: 'RAW_MATERIAL' as any,
        companyId: 'company-1',
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({ data: dto });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });
});
