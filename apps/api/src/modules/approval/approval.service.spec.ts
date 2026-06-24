import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalService } from './approval.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  approvalMatrix: { findMany: jest.fn() },
  purchaseOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
};

describe('ApprovalService', () => {
  let service: ApprovalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ApprovalService>(ApprovalService);
    jest.clearAllMocks();
  });

  describe('approve', () => {
    it('PO R$3k → MANAGER aprova direto (nível único)', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 10, unitCost: 300 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: 'amount', conditionOp: 'lte', conditionValue: '5000', approverRoles: ['MANAGER', 'DIRECTOR', 'SUPER_ADMIN'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-1', 'PO', 'co-1', 'user-1', 'MANAGER');
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
    });

    it('PO R$20k → MANAGER aprova nível 1, pendente DIRECTOR nível 2', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-2', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 100, unitCost: 200 }], // R$20k
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['MANAGER', 'DIRECTOR', 'SUPER_ADMIN'] },
        { level: 2, conditionField: 'amount', conditionOp: 'gte', conditionValue: '5000', approverRoles: ['DIRECTOR', 'SUPER_ADMIN'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.approve('po-2', 'PO', 'co-1', 'user-1', 'MANAGER');
      expect(result.status).toBe('PENDING_NEXT_LEVEL');
      expect(result.remainingLevels).toHaveLength(1);
      expect(result.remainingLevels[0].level).toBe(2);
    });

    it('WAREHOUSE não pode aprovar → ForbiddenException', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-3', companyId: 'co-1', status: 'DRAFT',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([
        { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['MANAGER', 'DIRECTOR'] },
      ]);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-3', 'PO', 'co-1', 'user-1', 'WAREHOUSE'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
