import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: any;

  const mockUser = { id: 'user-1', role: 'MANAGER', companyId: 'company-1' };

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
      };

      prisma.product.findUnique.mockResolvedValue({
        id: 'existing-id',
        ...dto,
      });

      await expect(service.create(dto, mockUser)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.product.findUnique).toHaveBeenCalledWith({
        where: { companyId_sku: { companyId: 'company-1', sku: 'EXISTING-SKU' } },
      });
    });

    it('should succeed when type=FINISHED_GOOD and NCM is provided', async () => {
      const dto = {
        sku: 'CAL-001',
        name: 'Calçado Social',
        type: 'FINISHED_GOOD' as any,
        ncm: '6403.99.00',
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should succeed when type=RAW_MATERIAL without NCM', async () => {
      const dto = {
        sku: 'MP-001',
        name: 'Couro Bovino',
        type: 'RAW_MATERIAL' as any,
      };

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id', ...dto });

      const result = await service.create(dto, mockUser);

      expect(result).toHaveProperty('id', 'new-id');
      expect(prisma.product.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('IDOR: ignora companyId externo injetado no payload e usa o do JWT', async () => {
      // Mesmo que um atacante consiga injetar companyId no objeto,
      // o service SEMPRE persiste a empresa do usuário autenticado.
      const dto = {
        sku: 'MAL-001',
        name: 'Produto Malicioso',
        type: 'RAW_MATERIAL' as any,
        companyId: 'company-VITIMA',
      } as any;

      prisma.product.findUnique.mockResolvedValue(null);
      prisma.product.create.mockResolvedValue({ id: 'new-id' });

      await service.create(dto, mockUser);

      const createArg = prisma.product.create.mock.calls[0][0];
      expect(createArg.data.companyId).toBe('company-1');
      expect(createArg.data.companyId).not.toBe('company-VITIMA');
    });
  });

  describe('update', () => {
    it('IDOR: busca escopada pela empresa do usuário (não edita produto de outro tenant)', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.update('prod-de-outra-empresa', { name: 'Hack' }, mockUser),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-de-outra-empresa', companyId: 'company-1' },
      });
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('IDOR: update nunca move produto de empresa (companyId imutável)', async () => {
      const existing = {
        id: 'prod-1',
        sku: 'PROD-001',
        name: 'Produto',
        type: 'RAW_MATERIAL',
        ncm: null,
        companyId: 'company-1',
      };
      prisma.product.findFirst.mockResolvedValue(existing);
      prisma.product.update.mockResolvedValue(existing);

      // Tentativa de mover o produto para outra empresa via body
      const dto = { name: 'Novo Nome', companyId: 'company-VITIMA' } as any;

      await service.update('prod-1', dto, mockUser);

      // O data enviado ao Prisma NÃO contém companyId (imutável)
      const updateArg = prisma.product.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('companyId');
      expect(updateArg.data.name).toBe('Novo Nome');

      // AuditLog registra a empresa original, nunca a injetada
      const auditArg = prisma.auditLog.create.mock.calls[0][0];
      expect(auditArg.data.companyId).toBe('company-1');
    });
  });
});
