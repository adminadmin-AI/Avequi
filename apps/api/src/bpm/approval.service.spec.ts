import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskAssignmentService } from './task-assignment.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const companyId = 'company-1';

const mockMatrix = {
  id: 'matrix-1',
  companyId,
  entityType: 'PURCHASE_ORDER',
  conditionField: 'totalAmount',
  conditionOp: 'GT',
  conditionValue: '10000',
  level: 1,
  requiredApprovals: 1,
  approverRoles: ['DIRECTOR'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockInstance = {
  id: 'inst-1',
  companyId,
  workflowId: 'wf-1',
  entityType: 'PURCHASE_ORDER',
  entityId: 'po-1',
  status: 'WAITING_APPROVAL',
  currentNodeId: 'approval-node',
  variables: { totalAmount: 15000 },
  startedAt: new Date(),
  completedAt: null,
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockApprovalRequest = {
  id: 'req-1',
  instanceId: 'inst-1',
  level: 1,
  approverRole: 'DIRECTOR',
  approverId: null,
  status: 'PENDING',
  comments: null,
  respondedAt: null,
  createdAt: new Date(),
};

const mockPrisma = {
  approvalMatrix: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workflowInstance: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  approvalRequest: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  workflowHistory: {
    create: jest.fn(),
  },
  taskAssignment: {
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
  },
};

const mockTaskAssignmentService = {
  create: jest.fn(),
  completeTask: jest.fn(),
  cancelTask: jest.fn(),
};

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TaskAssignmentService, useValue: mockTaskAssignmentService },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
    jest.clearAllMocks();
    // Default: no task found for completion
    mockPrisma.taskAssignment.findFirst.mockResolvedValue(null);
  });

  describe('createMatrix', () => {
    it('should create an approval matrix', async () => {
      mockPrisma.approvalMatrix.create.mockResolvedValue(mockMatrix);

      const result = await service.createMatrix(companyId, {
        entityType: 'PURCHASE_ORDER',
        conditionField: 'totalAmount',
        conditionOp: 'GT',
        conditionValue: '10000',
        level: 1,
        requiredApprovals: 1,
        approverRoles: ['DIRECTOR'],
      });

      expect(mockPrisma.approvalMatrix.create).toHaveBeenCalled();
      expect(result).toEqual(mockMatrix);
    });
  });

  describe('findMatrices', () => {
    it('should return matrices for company', async () => {
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([mockMatrix]);

      const result = await service.findMatrices(companyId);
      expect(result).toHaveLength(1);
    });

    it('should filter by entityType', async () => {
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([mockMatrix]);

      await service.findMatrices(companyId, 'PURCHASE_ORDER');
      expect(mockPrisma.approvalMatrix.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'PURCHASE_ORDER' }),
        }),
      );
    });
  });

  describe('updateMatrix', () => {
    it('should update matrix', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(mockMatrix);
      mockPrisma.approvalMatrix.update.mockResolvedValue({ ...mockMatrix, level: 2 });

      const result = await service.updateMatrix(companyId, 'matrix-1', { level: 2 });
      expect(result.level).toBe(2);
    });

    it('should throw NOT_FOUND if matrix not found', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(null);

      await expect(service.updateMatrix(companyId, 'bad-id', {})).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe('deleteMatrix', () => {
    it('should delete matrix', async () => {
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(mockMatrix);
      mockPrisma.approvalMatrix.delete.mockResolvedValue(mockMatrix);

      await service.deleteMatrix(companyId, 'matrix-1');
      expect(mockPrisma.approvalMatrix.delete).toHaveBeenCalledWith({
        where: { id: 'matrix-1' },
      });
    });
  });

  describe('getRequiredApprovals', () => {
    it('should return all matrices when no context provided', async () => {
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([mockMatrix]);

      const result = await service.getRequiredApprovals(companyId, 'PURCHASE_ORDER');
      expect(result).toHaveLength(1);
    });

    it('should filter matrices by condition when context provided', async () => {
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([mockMatrix]);

      // totalAmount = 15000 > 10000 → should include
      const result = await service.getRequiredApprovals(companyId, 'PURCHASE_ORDER', {
        totalAmount: 15000,
      });
      expect(result).toHaveLength(1);
    });

    it('should exclude matrix when condition not met', async () => {
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([mockMatrix]);

      // totalAmount = 5000, NOT > 10000 → should exclude
      const result = await service.getRequiredApprovals(companyId, 'PURCHASE_ORDER', {
        totalAmount: 5000,
      });
      expect(result).toHaveLength(0);
    });

    it('should support GTE operator', async () => {
      const gteMatrix = { ...mockMatrix, conditionOp: 'GTE', conditionValue: '10000' };
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([gteMatrix]);

      const result = await service.getRequiredApprovals(companyId, 'PURCHASE_ORDER', {
        totalAmount: 10000,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('approve', () => {
    it('should approve a pending request', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(mockInstance);
      mockPrisma.approvalRequest.findMany.mockResolvedValue([mockApprovalRequest]);
      mockPrisma.approvalRequest.update.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'APPROVED',
      });
      mockPrisma.approvalRequest.count.mockResolvedValue(1);
      mockPrisma.approvalMatrix.findFirst.mockResolvedValue(mockMatrix);
      mockPrisma.approvalRequest.findFirst.mockResolvedValue(null); // no next level
      mockPrisma.workflowInstance.update.mockResolvedValue({ ...mockInstance, status: 'RUNNING' });

      const result = await service.approve('inst-1', 'user-1', 'DIRECTOR');
      expect(result.approved).toBe(true);
      expect(result.level).toBe(1);
    });

    it('should throw BAD_REQUEST if instance is not WAITING_APPROVAL', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        status: 'RUNNING',
      });

      await expect(service.approve('inst-1', 'user-1', 'DIRECTOR')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw NOT_FOUND if instance does not exist', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(null);

      await expect(service.approve('bad-id', 'user-1', 'DIRECTOR')).rejects.toThrow(
        new BusinessException('Instância não encontrada', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw BAD_REQUEST if no pending approvals exist', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(mockInstance);
      mockPrisma.approvalRequest.findMany.mockResolvedValue([]);

      await expect(service.approve('inst-1', 'user-1', 'DIRECTOR')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw FORBIDDEN if role does not match pending approval', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(mockInstance);
      mockPrisma.approvalRequest.findMany.mockResolvedValue([mockApprovalRequest]);

      await expect(service.approve('inst-1', 'user-1', 'MANAGER')).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe('reject', () => {
    it('should reject and cancel the instance', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(mockInstance);
      mockPrisma.approvalRequest.findFirst.mockResolvedValue(mockApprovalRequest);
      mockPrisma.approvalRequest.update.mockResolvedValue({
        ...mockApprovalRequest,
        status: 'REJECTED',
      });
      mockPrisma.workflowInstance.update.mockResolvedValue({
        ...mockInstance,
        status: 'CANCELLED',
      });
      mockPrisma.workflowHistory.create.mockResolvedValue({});

      const result = await service.reject('inst-1', 'user-1', 'DIRECTOR', 'Valor indevido');
      expect(result.rejected).toBe(true);
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith({
        where: { id: 'inst-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('should throw NOT_FOUND if instance does not exist', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(null);

      await expect(service.reject('bad-id', 'user-1', 'DIRECTOR')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw FORBIDDEN if role has no pending approval', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(mockInstance);
      mockPrisma.approvalRequest.findFirst.mockResolvedValue(null);

      await expect(service.reject('inst-1', 'user-1', 'MANAGER')).rejects.toThrow(
        BusinessException,
      );
    });
  });
});
