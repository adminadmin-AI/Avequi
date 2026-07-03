import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalService } from './approval.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  approvalMatrix: { findMany: jest.fn() },
  purchaseOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  purchaseRequest: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
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

  describe('SoD — Segregação de Funções (#160)', () => {
    const matrixSingleLevel = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['MANAGER', 'DIRECTOR', 'SUPER_ADMIN'] },
    ];
    const matrixTwoLevels = [
      { level: 1, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['MANAGER', 'DIRECTOR', 'SUPER_ADMIN'] },
      { level: 2, conditionField: null, conditionOp: null, conditionValue: null, approverRoles: ['DIRECTOR', 'SUPER_ADMIN'] },
    ];

    it('criador da PO não pode aprová-la (auto-aprovação bloqueada)', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-10', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });

      await expect(
        service.approve('po-10', 'PO', 'co-1', 'user-1', 'MANAGER'),
      ).rejects.toThrow('Segregação de funções: o criador do documento não pode aprová-lo');
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('SUPER_ADMIN NÃO é isento da auto-aprovação', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-11', companyId: 'co-1', status: 'DRAFT', createdById: 'admin-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });

      await expect(
        service.approve('po-11', 'PO', 'co-1', 'admin-1', 'SUPER_ADMIN'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('auto-aprovação bloqueada também no fallback sem matriz', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-12', companyId: 'co-1', status: 'DRAFT', createdById: 'user-1',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]);

      await expect(
        service.approve('po-12', 'PO', 'co-1', 'user-1', 'MANAGER'),
      ).rejects.toThrow('Segregação de funções: o criador do documento não pode aprová-lo');
    });

    it('criador da PR (requestedById) não pode aprová-la', async () => {
      mockPrisma.purchaseRequest.findFirst.mockResolvedValue({
        id: 'pr-1', companyId: 'co-1', status: 'OPEN', requestedById: 'user-1',
        quantity: 5, product: { costPrice: 100 },
      });

      await expect(
        service.approve('pr-1', 'PR', 'co-1', 'user-1', 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('quem aprovou nível 1 não pode aprovar nível 2 do mesmo documento', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-13', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixTwoLevels);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'director-1', payload: { documentId: 'po-13', level: 1 } },
      ]);

      await expect(
        service.approve('po-13', 'PO', 'co-1', 'director-1', 'DIRECTOR'),
      ).rejects.toThrow('você já aprovou um nível deste documento');
      expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('fluxo feliz multi-nível: usuários distintos em cada nível → APPROVED', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-14', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixTwoLevels);
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { userId: 'manager-1', payload: { documentId: 'po-14', level: 1 } },
      ]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-14', 'PO', 'co-1', 'director-1', 'DIRECTOR');
      expect(result.status).toBe('APPROVED');
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approvedById: 'director-1' }),
        }),
      );
    });

    it('fluxo feliz nível único: aprovador diferente do criador → APPROVED', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-15', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-15', 'PO', 'co-1', 'manager-1', 'MANAGER');
      expect(result.status).toBe('APPROVED');
    });

    it('fallback sem matriz: MANAGER que não criou a PO aprova normalmente', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-16', companyId: 'co-1', status: 'DRAFT', createdById: 'user-0',
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue([]);
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-16', 'PO', 'co-1', 'manager-1', 'MANAGER');
      expect(result.status).toBe('APPROVED');
    });

    it('PO legada sem createdById (null) não bloqueia aprovação', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-17', companyId: 'co-1', status: 'DRAFT', createdById: null,
        items: [{ quantity: 1, unitCost: 100 }],
      });
      mockPrisma.approvalMatrix.findMany.mockResolvedValue(matrixSingleLevel);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.purchaseOrder.update.mockResolvedValue({});

      const result = await service.approve('po-17', 'PO', 'co-1', 'manager-1', 'MANAGER');
      expect(result.status).toBe('APPROVED');
    });
  });
});
