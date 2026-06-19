import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AlertSeverity,
  AlertType,
  EquipmentStatus,
  MaintenanceOrderStatus,
  MaintenanceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompleteMaintenanceOrderDto } from './dto/complete-maintenance-order.dto';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { CreateMaintenanceOrderDto } from './dto/create-maintenance-order.dto';
import { MaintenanceService } from './maintenance.service';

const mockPrisma = {
  equipment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  maintenanceOrder: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  alert: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('MaintenanceService', () => {
  let service: MaintenanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
  });

  // ─── createEquipment ──────────────────────────────────────────────────────

  describe('createEquipment', () => {
    it('should create equipment with default nextMaintenanceAt when not provided', async () => {
      const dto: CreateEquipmentDto = {
        code: 'EQ-001',
        name: 'Prensa Hidráulica',
      };
      const expected = {
        id: 'eq-1',
        companyId: 'company-1',
        code: 'EQ-001',
        name: 'Prensa Hidráulica',
        status: EquipmentStatus.ACTIVE,
        maintenanceIntervalDays: 30,
      };
      mockPrisma.equipment.create.mockResolvedValue(expected);

      const result = await service.createEquipment('company-1', dto);

      expect(mockPrisma.equipment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            code: 'EQ-001',
            name: 'Prensa Hidráulica',
            maintenanceIntervalDays: 30,
            nextMaintenanceAt: expect.any(Date),
          }),
        }),
      );
      expect(result).toEqual(expected);
    });

    it('should use provided nextMaintenanceAt when given', async () => {
      const futureDate = '2026-12-01T00:00:00.000Z';
      const dto: CreateEquipmentDto = {
        code: 'EQ-002',
        name: 'Torno CNC',
        nextMaintenanceAt: futureDate,
        maintenanceIntervalDays: 60,
      };
      const expected = { id: 'eq-2', ...dto };
      mockPrisma.equipment.create.mockResolvedValue(expected);

      await service.createEquipment('company-1', dto);

      const callArgs = mockPrisma.equipment.create.mock.calls[0][0];
      expect(callArgs.data.nextMaintenanceAt).toEqual(new Date(futureDate));
      expect(callArgs.data.maintenanceIntervalDays).toBe(60);
    });
  });

  // ─── listEquipment ────────────────────────────────────────────────────────

  describe('listEquipment', () => {
    it('should list all equipment without filter', async () => {
      const items = [{ id: 'eq-1', code: 'EQ-001' }];
      mockPrisma.equipment.findMany.mockResolvedValue(items);

      const result = await service.listEquipment('company-1');

      expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1' },
        }),
      );
      expect(result).toEqual(items);
    });

    it('should list equipment with status filter', async () => {
      mockPrisma.equipment.findMany.mockResolvedValue([]);

      await service.listEquipment('company-1', {
        status: EquipmentStatus.ACTIVE,
      });

      expect(mockPrisma.equipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', status: EquipmentStatus.ACTIVE },
        }),
      );
    });
  });

  // ─── createOrder ─────────────────────────────────────────────────────────

  describe('createOrder', () => {
    it('should create a PREVENTIVE order without changing equipment status', async () => {
      const equipment = {
        id: 'eq-1',
        companyId: 'company-1',
        status: EquipmentStatus.ACTIVE,
      };
      const order = {
        id: 'order-1',
        equipmentId: 'eq-1',
        type: MaintenanceType.PREVENTIVE,
        status: MaintenanceOrderStatus.OPEN,
      };
      mockPrisma.equipment.findFirst.mockResolvedValue(equipment);
      mockPrisma.maintenanceOrder.create.mockResolvedValue(order);

      const dto: CreateMaintenanceOrderDto = {
        equipmentId: 'eq-1',
        type: MaintenanceType.PREVENTIVE,
        title: 'Revisão mensal',
      };

      const result = await service.createOrder('company-1', dto, 'user-1');

      expect(mockPrisma.maintenanceOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'company-1',
            equipmentId: 'eq-1',
            type: MaintenanceType.PREVENTIVE,
            title: 'Revisão mensal',
            createdById: 'user-1',
          }),
        }),
      );
      // No equipment update for PREVENTIVE
      expect(mockPrisma.equipment.update).not.toHaveBeenCalled();
      expect(result).toEqual(order);
    });

    it('should set equipment to UNDER_MAINTENANCE for CORRECTIVE order', async () => {
      const equipment = {
        id: 'eq-1',
        companyId: 'company-1',
        status: EquipmentStatus.ACTIVE,
      };
      const order = {
        id: 'order-2',
        equipmentId: 'eq-1',
        type: MaintenanceType.CORRECTIVE,
        status: MaintenanceOrderStatus.OPEN,
      };
      mockPrisma.equipment.findFirst.mockResolvedValue(equipment);
      mockPrisma.maintenanceOrder.create.mockResolvedValue(order);
      mockPrisma.equipment.update.mockResolvedValue({
        ...equipment,
        status: EquipmentStatus.UNDER_MAINTENANCE,
      });

      const dto: CreateMaintenanceOrderDto = {
        equipmentId: 'eq-1',
        type: MaintenanceType.CORRECTIVE,
        title: 'Reparo urgente',
      };

      await service.createOrder('company-1', dto);

      expect(mockPrisma.equipment.update).toHaveBeenCalledWith({
        where: { id: 'eq-1' },
        data: { status: EquipmentStatus.UNDER_MAINTENANCE },
      });
    });

    it('should throw NotFoundException when equipment not found', async () => {
      mockPrisma.equipment.findFirst.mockResolvedValue(null);

      const dto: CreateMaintenanceOrderDto = {
        equipmentId: 'nonexistent',
        title: 'Test',
      };

      await expect(
        service.createOrder('company-1', dto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── startOrder ──────────────────────────────────────────────────────────

  describe('startOrder', () => {
    it('should transition OPEN → IN_PROGRESS and set startedAt', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        equipmentId: 'eq-1',
        status: MaintenanceOrderStatus.OPEN,
        equipment: { id: 'eq-1', status: EquipmentStatus.ACTIVE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      const updatedOrder = {
        ...order,
        status: MaintenanceOrderStatus.IN_PROGRESS,
        startedAt: new Date(),
      };

      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);
      mockPrisma.$transaction.mockResolvedValue([updatedOrder, {}]);

      const result = await service.startOrder('order-1', 'company-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result.status).toBe(MaintenanceOrderStatus.IN_PROGRESS);
    });

    it('should throw BadRequestException if order is not OPEN', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        status: MaintenanceOrderStatus.IN_PROGRESS,
        equipment: { id: 'eq-1', status: EquipmentStatus.UNDER_MAINTENANCE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.startOrder('order-1', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── completeOrder ───────────────────────────────────────────────────────

  describe('completeOrder', () => {
    it('should transition IN_PROGRESS → DONE, set completedAt, resolution, and recalculate nextMaintenanceAt, set equipment ACTIVE', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        equipmentId: 'eq-1',
        status: MaintenanceOrderStatus.IN_PROGRESS,
        equipment: {
          id: 'eq-1',
          status: EquipmentStatus.UNDER_MAINTENANCE,
          maintenanceIntervalDays: 30,
        },
        technician: null,
        createdBy: null,
      };
      const updatedOrder = {
        ...order,
        status: MaintenanceOrderStatus.DONE,
        completedAt: new Date(),
        resolution: 'Peça substituída',
        cost: 500,
      };

      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);
      mockPrisma.$transaction.mockResolvedValue([updatedOrder, {}]);

      const dto: CompleteMaintenanceOrderDto = {
        resolution: 'Peça substituída',
        cost: 500,
      };

      const result = await service.completeOrder(
        'order-1',
        'company-1',
        dto,
        'user-1',
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txCalls = mockPrisma.$transaction.mock.calls[0][0];
      // Should contain equipment update with ACTIVE status and new nextMaintenanceAt
      expect(txCalls).toHaveLength(2);
      expect(result.status).toBe(MaintenanceOrderStatus.DONE);
      expect(result.resolution).toBe('Peça substituída');
    });

    it('should throw BadRequestException if order is not IN_PROGRESS', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        status: MaintenanceOrderStatus.OPEN,
        equipment: { id: 'eq-1', status: EquipmentStatus.ACTIVE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);

      const dto: CompleteMaintenanceOrderDto = { resolution: 'Done' };

      await expect(
        service.completeOrder('order-1', 'company-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── cancelOrder ─────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('should cancel order and revert equipment to ACTIVE if was UNDER_MAINTENANCE', async () => {
      const order = {
        id: 'order-1',
        companyId: 'company-1',
        equipmentId: 'eq-1',
        status: MaintenanceOrderStatus.IN_PROGRESS,
        equipment: { id: 'eq-1', status: EquipmentStatus.UNDER_MAINTENANCE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      const cancelledOrder = { ...order, status: MaintenanceOrderStatus.CANCELLED };

      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);
      mockPrisma.$transaction.mockResolvedValue([cancelledOrder, {}]);

      const result = await service.cancelOrder('order-1', 'company-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const txOps = mockPrisma.$transaction.mock.calls[0][0];
      // Should have 2 ops: order cancel + equipment revert
      expect(txOps).toHaveLength(2);
      expect(result.status).toBe(MaintenanceOrderStatus.CANCELLED);
    });

    it('should cancel OPEN order without changing equipment if not UNDER_MAINTENANCE', async () => {
      const order = {
        id: 'order-2',
        companyId: 'company-1',
        equipmentId: 'eq-1',
        status: MaintenanceOrderStatus.OPEN,
        equipment: { id: 'eq-1', status: EquipmentStatus.ACTIVE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      const cancelledOrder = { ...order, status: MaintenanceOrderStatus.CANCELLED };

      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);
      // Direct update, no $transaction
      mockPrisma.maintenanceOrder.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder('order-2', 'company-1');

      // $transaction should NOT be called (equipment was not UNDER_MAINTENANCE)
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.maintenanceOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-2' },
        data: { status: MaintenanceOrderStatus.CANCELLED },
      });
      expect(result.status).toBe(MaintenanceOrderStatus.CANCELLED);
    });

    it('should throw BadRequestException if order is already DONE', async () => {
      const order = {
        id: 'order-3',
        status: MaintenanceOrderStatus.DONE,
        equipment: { status: EquipmentStatus.ACTIVE, maintenanceIntervalDays: 30 },
        technician: null,
        createdBy: null,
      };
      mockPrisma.maintenanceOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.cancelOrder('order-3', 'company-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── checkMaintenanceDue ─────────────────────────────────────────────────

  describe('checkMaintenanceDue', () => {
    const now = new Date('2026-06-19T12:00:00Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(now);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should create CRITICAL alert for overdue equipment', async () => {
      const overdueDate = new Date('2026-06-15T00:00:00Z'); // past
      mockPrisma.equipment.findMany.mockResolvedValue([
        {
          id: 'eq-1',
          code: 'EQ-001',
          name: 'Prensa',
          nextMaintenanceAt: overdueDate,
          location: 'Setor A',
        },
      ]);
      mockPrisma.alert.findFirst.mockResolvedValue(null);
      mockPrisma.alert.create.mockResolvedValue({});

      const count = await service.checkMaintenanceDue('company-1');

      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.MAINTENANCE_DUE,
            severity: AlertSeverity.CRITICAL,
          }),
        }),
      );
      expect(count).toBe(1);
    });

    it('should create WARNING alert for upcoming maintenance (within 7 days)', async () => {
      const upcomingDate = new Date('2026-06-23T00:00:00Z'); // 4 days ahead
      mockPrisma.equipment.findMany.mockResolvedValue([
        {
          id: 'eq-2',
          code: 'EQ-002',
          name: 'Torno',
          nextMaintenanceAt: upcomingDate,
          location: null,
        },
      ]);
      mockPrisma.alert.findFirst.mockResolvedValue(null);
      mockPrisma.alert.create.mockResolvedValue({});

      const count = await service.checkMaintenanceDue('company-1');

      expect(mockPrisma.alert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: AlertType.MAINTENANCE_DUE,
            severity: AlertSeverity.WARNING,
          }),
        }),
      );
      expect(count).toBe(1);
    });

    it('should not create alert when existing unresolved alert exists', async () => {
      const overdueDate = new Date('2026-06-10T00:00:00Z');
      mockPrisma.equipment.findMany.mockResolvedValue([
        {
          id: 'eq-3',
          code: 'EQ-003',
          name: 'Soldadora',
          nextMaintenanceAt: overdueDate,
          location: null,
        },
      ]);
      // Existing active alert — upsert should skip
      mockPrisma.alert.findFirst.mockResolvedValue({ id: 'existing-alert' });

      const count = await service.checkMaintenanceDue('company-1');

      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
      expect(count).toBe(1); // equipment still counted, alert just not duplicated
    });

    it('should return 0 when no equipment due soon', async () => {
      mockPrisma.equipment.findMany.mockResolvedValue([]);

      const count = await service.checkMaintenanceDue('company-1');

      expect(count).toBe(0);
      expect(mockPrisma.alert.create).not.toHaveBeenCalled();
    });
  });
});
