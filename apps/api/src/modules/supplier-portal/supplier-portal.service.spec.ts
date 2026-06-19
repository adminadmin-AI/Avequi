import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SupplierPortalService } from './supplier-portal.service';
import { CreateSupplierTokenDto } from './dto/create-supplier-token.dto';

const mockPrisma = {
  supplierToken: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  supplier: { findFirst: jest.fn(), findUnique: jest.fn() },
  purchaseOrder: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  financialEntry: { findMany: jest.fn(), count: jest.fn() },
  nonConformance: { findMany: jest.fn(), count: jest.fn() },
  goodsReceipt: { findMany: jest.fn() },
};

describe('SupplierPortalService', () => {
  let service: SupplierPortalService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPortalService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SupplierPortalService>(SupplierPortalService);
  });

  // ─── createToken ─────────────────────────────────────────────────────────────

  describe('createToken', () => {
    const dto: CreateSupplierTokenDto = {
      supplierId: 'sup-1',
      description: 'Token de integração',
    };

    it('should create a token when supplier belongs to companyId', async () => {
      const supplier = { id: 'sup-1', companyId: 'co-1', name: 'Fornecedor A' };
      const token = { id: 'tok-1', supplierId: 'sup-1', token: 'abc123' };
      mockPrisma.supplier.findFirst.mockResolvedValue(supplier);
      mockPrisma.supplierToken.create.mockResolvedValue(token);

      const result = await service.createToken('co-1', dto);
      expect(mockPrisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'sup-1', companyId: 'co-1' },
      });
      expect(mockPrisma.supplierToken.create).toHaveBeenCalled();
      expect(result).toEqual(token);
    });

    it('should throw NotFoundException when supplier not found', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue(null);
      await expect(service.createToken('co-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when supplier belongs to different companyId', async () => {
      mockPrisma.supplier.findFirst.mockResolvedValue(null);
      await expect(service.createToken('co-other', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── revokeToken ─────────────────────────────────────────────────────────────

  describe('revokeToken', () => {
    it('should set revokedAt on the token', async () => {
      const tokenRecord = { id: 'tok-1', supplierId: 'sup-1' };
      const updatedToken = { ...tokenRecord, revokedAt: new Date() };
      mockPrisma.supplierToken.findFirst.mockResolvedValue(tokenRecord);
      mockPrisma.supplierToken.update.mockResolvedValue(updatedToken);

      const result = await service.revokeToken('tok-1', 'co-1');
      expect(mockPrisma.supplierToken.update).toHaveBeenCalledWith({
        where: { id: 'tok-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toEqual(updatedToken);
    });

    it('should throw NotFoundException when token not found', async () => {
      mockPrisma.supplierToken.findFirst.mockResolvedValue(null);
      await expect(service.revokeToken('tok-missing', 'co-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getProfile ──────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('should return supplier profile data', async () => {
      const supplier = {
        id: 'sup-1',
        name: 'Fornecedor A',
        cnpj: '12.345.678/0001-99',
        email: 'forn@example.com',
        leadTimeDays: 5,
      };
      mockPrisma.supplier.findUnique.mockResolvedValue(supplier);

      const result = await service.getProfile('sup-1');
      expect(result).toEqual(supplier);
      expect(mockPrisma.supplier.findUnique).toHaveBeenCalledWith({
        where: { id: 'sup-1' },
        select: {
          id: true,
          name: true,
          cnpj: true,
          email: true,
          leadTimeDays: true,
        },
      });
    });

    it('should throw NotFoundException when supplier not found', async () => {
      mockPrisma.supplier.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('sup-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── listPurchaseOrders ───────────────────────────────────────────────────────

  describe('listPurchaseOrders', () => {
    it('should return all POs for supplier without status filter', async () => {
      const pos = [
        { id: 'po-1', supplierId: 'sup-1', status: 'DRAFT', items: [] },
        { id: 'po-2', supplierId: 'sup-1', status: 'APPROVED', items: [] },
      ];
      mockPrisma.purchaseOrder.findMany.mockResolvedValue(pos);

      const result = await service.listPurchaseOrders('sup-1', {});
      expect(result).toEqual(pos);
      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: 'sup-1' },
        }),
      );
    });

    it('should filter POs by status when provided', async () => {
      const pos = [
        { id: 'po-2', supplierId: 'sup-1', status: 'APPROVED', items: [] },
      ];
      mockPrisma.purchaseOrder.findMany.mockResolvedValue(pos);

      const result = await service.listPurchaseOrders('sup-1', {
        status: 'APPROVED' as any,
      });
      expect(result).toEqual(pos);
      expect(mockPrisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: 'sup-1', status: 'APPROVED' },
        }),
      );
    });
  });

  // ─── getPurchaseOrder ─────────────────────────────────────────────────────────

  describe('getPurchaseOrder', () => {
    it('should return PO with items and receipts', async () => {
      const po = {
        id: 'po-1',
        supplierId: 'sup-1',
        items: [],
        receipts: [],
      };
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(po);

      const result = await service.getPurchaseOrder('sup-1', 'po-1');
      expect(result).toEqual(po);
    });

    it('should throw NotFoundException when PO not found', async () => {
      mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(
        service.getPurchaseOrder('sup-1', 'po-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── listPayments ─────────────────────────────────────────────────────────────

  describe('listPayments', () => {
    it('should return PAYABLE entries linked to supplier POs', async () => {
      const entries = [
        {
          id: 'fe-1',
          amount: 1000,
          dueDate: new Date(),
          status: 'OPEN',
          paidAt: null,
          description: null,
          purchaseOrderId: 'po-1',
        },
      ];
      mockPrisma.financialEntry.findMany.mockResolvedValue(entries);

      const result = await service.listPayments('sup-1');
      expect(result).toEqual(entries);
      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'PAYABLE',
            purchaseOrder: { supplierId: 'sup-1' },
          },
        }),
      );
    });
  });

  // ─── listNcrs ────────────────────────────────────────────────────────────────

  describe('listNcrs', () => {
    it('should return NCRs filtered by supplierId', async () => {
      const ncrs = [
        {
          id: 'ncr-1',
          title: 'Parafuso fora de especificação',
          severity: 'MAJOR',
          status: 'OPEN',
          createdAt: new Date(),
        },
      ];
      mockPrisma.nonConformance.findMany.mockResolvedValue(ncrs);

      const result = await service.listNcrs('sup-1');
      expect(result).toEqual(ncrs);
      expect(mockPrisma.nonConformance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: 'sup-1' },
        }),
      );
    });
  });

  // ─── getPortalSummary ────────────────────────────────────────────────────────

  describe('getPortalSummary', () => {
    it('should return correct summary structure and counts', async () => {
      mockPrisma.purchaseOrder.count.mockResolvedValue(3);
      mockPrisma.nonConformance.count.mockResolvedValue(2);
      mockPrisma.financialEntry.count
        .mockResolvedValueOnce(5) // pendingPayments
        .mockResolvedValueOnce(1); // overduePayments

      const result = await service.getPortalSummary('sup-1');

      expect(result).toEqual({
        pendingOrders: 3,
        openNcrs: 2,
        pendingPayments: 5,
        overduePayments: 1,
      });
      expect(mockPrisma.purchaseOrder.count).toHaveBeenCalledWith({
        where: { supplierId: 'sup-1', status: 'APPROVED' },
      });
      expect(mockPrisma.nonConformance.count).toHaveBeenCalledWith({
        where: {
          supplierId: 'sup-1',
          status: { in: ['OPEN', 'UNDER_ANALYSIS'] },
        },
      });
    });
  });
});
