import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SupplierAdvanceService } from './supplier-advance.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  supplier: { findFirst: jest.fn() },
  supplierAdvance: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  financialEntry: { findFirst: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
};

describe('SupplierAdvanceService (#393)', () => {
  let service: SupplierAdvanceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SupplierAdvanceService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SupplierAdvanceService);
    jest.clearAllMocks();
    mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', name: 'Aço Forte' });
    mockPrisma.supplierAdvance.create.mockResolvedValue({ id: 'adv-1' });
    mockPrisma.supplierAdvance.update.mockResolvedValue({});
    mockPrisma.financialEntry.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('applyToPayable abate FIFO e dá baixa total quando adiantamento cobre a NF', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1', amount: 10000, paidAmount: 0 });
    mockPrisma.supplierAdvance.findMany.mockResolvedValue([
      { id: 'adv-1', amount: 6000, appliedAmount: 0, paidAt: new Date('2026-06-01') },
      { id: 'adv-2', amount: 8000, appliedAmount: 0, paidAt: new Date('2026-06-15') },
    ]);

    const aplicado = await service.applyToPayable('co-1', 'sup-1', 'fe-1');
    expect(aplicado).toBe(10000);
    // adv-1 (mais antigo) consumido inteiro → APPLIED
    expect(mockPrisma.supplierAdvance.update).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ where: { id: 'adv-1' }, data: expect.objectContaining({ appliedAmount: 6000, status: 'APPLIED' }) }),
    );
    // adv-2 parcial: 4000 de 8000 → PARTIALLY_APPLIED
    expect(mockPrisma.supplierAdvance.update).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ where: { id: 'adv-2' }, data: expect.objectContaining({ appliedAmount: 4000, status: 'PARTIALLY_APPLIED' }) }),
    );
    // payable PAGO
    expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paidAmount: 10000, status: 'PAID' }) }),
    );
  });

  it('adiantamento menor que a NF gera baixa PARCIAL', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1', amount: 10000, paidAmount: 0 });
    mockPrisma.supplierAdvance.findMany.mockResolvedValue([
      { id: 'adv-1', amount: 3000, appliedAmount: 0, paidAt: new Date() },
    ]);
    const aplicado = await service.applyToPayable('co-1', 'sup-1', 'fe-1');
    expect(aplicado).toBe(3000);
    expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paidAmount: 3000, status: 'PARTIALLY_PAID' }) }),
    );
  });

  it('sem adiantamento aberto não mexe no payable', async () => {
    mockPrisma.financialEntry.findFirst.mockResolvedValue({ id: 'fe-1', amount: 10000, paidAmount: 0 });
    mockPrisma.supplierAdvance.findMany.mockResolvedValue([]);
    const aplicado = await service.applyToPayable('co-1', 'sup-1', 'fe-1');
    expect(aplicado).toBe(0);
    expect(mockPrisma.financialEntry.update).not.toHaveBeenCalled();
  });

  it('cancel rejeita adiantamento já aplicado', async () => {
    mockPrisma.supplierAdvance.findFirst.mockResolvedValue({ id: 'adv-1', appliedAmount: 100 });
    await expect(service.cancel('adv-1', 'co-1')).rejects.toThrow(BadRequestException);
  });

  it('report agrega saldo aberto por fornecedor', async () => {
    mockPrisma.supplierAdvance.findMany.mockResolvedValue([
      { supplierId: 's1', status: 'OPEN', amount: 5000, appliedAmount: 0, supplier: { id: 's1', name: 'A' } },
      { supplierId: 's1', status: 'PARTIALLY_APPLIED', amount: 8000, appliedAmount: 6000, supplier: { id: 's1', name: 'A' } },
      { supplierId: 's2', status: 'APPLIED', amount: 3000, appliedAmount: 3000, supplier: { id: 's2', name: 'B' } },
    ]);
    const r = await service.report('co-1');
    expect(r.totalAberto).toBe(7000); // 5000 + 2000
    expect(r.porFornecedor).toHaveLength(1);
    expect(r.porFornecedor[0].saldoAberto).toBe(7000);
  });
});
