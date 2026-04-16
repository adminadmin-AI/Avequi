import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MovementType } from '@prisma/client';
import { StockService } from './stock.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  stockBalance: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('StockService', () => {
  let service: StockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StockService>(StockService);

    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  describe('move', () => {
    it('should throw BadRequestException when EXIT quantity exceeds available balance', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 5,
        reserved: 0,
      });

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.EXIT,
        quantity: 10,
        reason: 'Saída teste',
      };

      await expect(service.move(dto, 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.move(dto, 'user-1')).rejects.toThrow(
        'Saldo insuficiente. Disponível: 5, solicitado: 10',
      );
    });

    it('should create ENTRY movement and update balance with positive increment', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 10,
        reserved: 0,
      });

      const createdMovement = {
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 20,
        reason: 'Entrada de teste',
      };

      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue(createdMovement);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 20,
        reason: 'Entrada de teste',
      };

      const result = await service.move(dto, 'user-1');

      expect(result).toEqual(createdMovement);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { increment: 20 } },
        }),
      );
    });

    it('should call prisma.$transaction when moving stock', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 50,
        reserved: 0,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({ id: 'mov-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.EXIT,
        quantity: 10,
        reason: 'Saída de teste',
      };

      await service.move(dto, 'user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('reverse', () => {
    it('should throw BadRequestException when trying to reverse a REVERSAL movement', async () => {
      mockPrisma.stockMovement.findFirst.mockResolvedValue({
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.REVERSAL,
        quantity: 10,
        reversedById: null,
      });

      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow('Não é possível estornar um estorno');
    });

    it('should throw ConflictException when movement already has reversedById set', async () => {
      mockPrisma.stockMovement.findFirst.mockResolvedValue({
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 10,
        reversedById: 'mov-estorno-1',
      });

      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow('Este movimento já foi estornado');
    });
  });
});
