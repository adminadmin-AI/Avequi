import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { TaskAssignmentService } from './task-assignment.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const COMPANY_ID = 'company-1';
const USER_ID = 'user-1';
const ROLE = 'MANAGER';

const mockTask = {
  id: 'task-1',
  companyId: COMPANY_ID,
  userId: USER_ID,
  role: ROLE,
  entityType: 'APPROVAL',
  entityId: 'entity-1',
  action: 'APPROVE',
  title: 'Aprovação pendente',
  description: null,
  dueDate: null,
  priority: 'HIGH',
  status: 'PENDING',
  completedAt: null,
  completedBy: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  taskAssignment: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('TaskAssignmentService', () => {
  let service: TaskAssignmentService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskAssignmentService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TaskAssignmentService>(TaskAssignmentService);
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a task assignment', async () => {
      mockPrisma.taskAssignment.create.mockResolvedValue(mockTask);

      const result = await service.create(COMPANY_ID, {
        userId: USER_ID,
        role: ROLE,
        entityType: 'APPROVAL',
        entityId: 'entity-1',
        action: 'APPROVE',
        title: 'Aprovação pendente',
        priority: 'HIGH',
      });

      expect(mockPrisma.taskAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          entityType: 'APPROVAL',
          priority: 'HIGH',
        }),
      });
      expect(result).toEqual(mockTask);
    });

    it('should default priority to NORMAL when not provided', async () => {
      mockPrisma.taskAssignment.create.mockResolvedValue({ ...mockTask, priority: 'NORMAL' });

      await service.create(COMPANY_ID, {
        entityType: 'REVIEW',
        entityId: 'ent-2',
        action: 'REVIEW',
        title: 'Revisão',
      });

      expect(mockPrisma.taskAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ priority: 'NORMAL' }),
      });
    });
  });

  // ─── findMyTasks ─────────────────────────────────────────────────────────────

  describe('findMyTasks', () => {
    it('should return tasks assigned by userId OR role', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([mockTask]);

      const result = await service.findMyTasks(COMPANY_ID, USER_ID, ROLE);

      expect(mockPrisma.taskAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: COMPANY_ID,
            OR: [{ userId: USER_ID }, { role: ROLE }],
          }),
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should apply status filter when provided', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([]);

      await service.findMyTasks(COMPANY_ID, USER_ID, ROLE, { status: 'IN_PROGRESS' });

      expect(mockPrisma.taskAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
    });

    it('should apply entityType filter when provided', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([]);

      await service.findMyTasks(COMPANY_ID, USER_ID, ROLE, { entityType: 'PURCHASE_ORDER' });

      expect(mockPrisma.taskAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'PURCHASE_ORDER' }),
        }),
      );
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all tasks for the company', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([mockTask]);

      const result = await service.findAll(COMPANY_ID);

      expect(mockPrisma.taskAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: COMPANY_ID }),
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ─── startTask ───────────────────────────────────────────────────────────────

  describe('startTask', () => {
    it('should set task to IN_PROGRESS', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue(mockTask);
      mockPrisma.taskAssignment.update.mockResolvedValue({
        ...mockTask,
        status: 'IN_PROGRESS',
        userId: USER_ID,
      });

      const result = await service.startTask(COMPANY_ID, 'task-1', USER_ID);

      expect(mockPrisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS', userId: USER_ID },
      });
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should throw NOT_FOUND when task does not exist', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue(null);

      await expect(service.startTask(COMPANY_ID, 'missing', USER_ID)).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw BAD_REQUEST when task is not PENDING', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue({
        ...mockTask,
        status: 'IN_PROGRESS',
      });

      await expect(service.startTask(COMPANY_ID, 'task-1', USER_ID)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ─── completeTask ─────────────────────────────────────────────────────────────

  describe('completeTask', () => {
    it('should set task to COMPLETED', async () => {
      const completedAt = new Date();
      mockPrisma.taskAssignment.findFirst.mockResolvedValue({
        ...mockTask,
        status: 'IN_PROGRESS',
      });
      mockPrisma.taskAssignment.update.mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
        completedAt,
        completedBy: USER_ID,
      });

      const result = await service.completeTask(COMPANY_ID, 'task-1', USER_ID);

      expect(mockPrisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          completedBy: USER_ID,
        }),
      });
      expect(result.status).toBe('COMPLETED');
    });

    it('should throw BAD_REQUEST when task is already COMPLETED', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
      });

      await expect(service.completeTask(COMPANY_ID, 'task-1', USER_ID)).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw BAD_REQUEST when task is CANCELLED', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue({
        ...mockTask,
        status: 'CANCELLED',
      });

      await expect(service.completeTask(COMPANY_ID, 'task-1', USER_ID)).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw NOT_FOUND when task does not exist', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue(null);

      await expect(service.completeTask(COMPANY_ID, 'task-1', USER_ID)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ─── cancelTask ──────────────────────────────────────────────────────────────

  describe('cancelTask', () => {
    it('should set task to CANCELLED', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue(mockTask);
      mockPrisma.taskAssignment.update.mockResolvedValue({
        ...mockTask,
        status: 'CANCELLED',
      });

      const result = await service.cancelTask(COMPANY_ID, 'task-1');

      expect(mockPrisma.taskAssignment.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'CANCELLED' },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('should throw NOT_FOUND when task does not exist', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue(null);

      await expect(service.cancelTask(COMPANY_ID, 'task-1')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw BAD_REQUEST when task is COMPLETED', async () => {
      mockPrisma.taskAssignment.findFirst.mockResolvedValue({
        ...mockTask,
        status: 'COMPLETED',
      });

      await expect(service.cancelTask(COMPANY_ID, 'task-1')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  // ─── getInboxSummary ─────────────────────────────────────────────────────────

  describe('getInboxSummary', () => {
    it('should return correct summary counts by type and priority', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000 * 60 * 60 * 24); // 1 day ago

      mockPrisma.taskAssignment.findMany.mockResolvedValue([
        { entityType: 'APPROVAL', priority: 'URGENT', status: 'PENDING', dueDate: null },
        { entityType: 'APPROVAL', priority: 'HIGH', status: 'PENDING', dueDate: null },
        { entityType: 'REVIEW', priority: 'HIGH', status: 'IN_PROGRESS', dueDate: null },
        { entityType: 'APPROVAL', priority: 'NORMAL', status: 'PENDING', dueDate: past },
      ]);

      const summary = await service.getInboxSummary(COMPANY_ID, USER_ID, ROLE);

      expect(summary.total).toBe(4);
      expect(summary.byType['APPROVAL']).toBe(3);
      expect(summary.byType['REVIEW']).toBe(1);
      expect(summary.byPriority['URGENT']).toBe(1);
      expect(summary.byPriority['HIGH']).toBe(2);
      expect(summary.byPriority['NORMAL']).toBe(1);
      expect(summary.overdue).toBe(1); // the one with past dueDate
    });

    it('should count OVERDUE status tasks as overdue', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([
        { entityType: 'APPROVAL', priority: 'NORMAL', status: 'OVERDUE', dueDate: null },
      ]);

      const summary = await service.getInboxSummary(COMPANY_ID, USER_ID, ROLE);

      expect(summary.overdue).toBe(1);
    });

    it('should return zero counts for empty inbox', async () => {
      mockPrisma.taskAssignment.findMany.mockResolvedValue([]);

      const summary = await service.getInboxSummary(COMPANY_ID, USER_ID, ROLE);

      expect(summary.total).toBe(0);
      expect(summary.overdue).toBe(0);
      expect(summary.byType).toEqual({});
      expect(summary.byPriority).toEqual({});
    });
  });

  // ─── markOverdue ─────────────────────────────────────────────────────────────

  describe('markOverdue', () => {
    it('should mark past-due PENDING and IN_PROGRESS tasks as OVERDUE', async () => {
      mockPrisma.taskAssignment.updateMany.mockResolvedValue({ count: 3 });

      const count = await service.markOverdue();

      expect(mockPrisma.taskAssignment.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          dueDate: { lt: expect.any(Date) },
        },
        data: { status: 'OVERDUE' },
      });
      expect(count).toBe(3);
    });

    it('should return 0 when no tasks are overdue', async () => {
      mockPrisma.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

      const count = await service.markOverdue();

      expect(count).toBe(0);
    });
  });
});
