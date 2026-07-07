import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DiscountPolicyService } from './discount-policy.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  discountPolicy: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  product: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

const POLICIES = [
  { role: 'COMMERCIAL', maxDiscountPct: 10, isActive: true },
  { role: 'MANAGER', maxDiscountPct: 20, isActive: true },
  { role: 'DIRECTOR', maxDiscountPct: 100, isActive: true },
];

describe('DiscountPolicyService (#391)', () => {
  let service: DiscountPolicyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DiscountPolicyService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(DiscountPolicyService);
    jest.clearAllMocks();
    mockPrisma.discountPolicy.findMany.mockResolvedValue(POLICIES);
    mockPrisma.auditLog.create.mockResolvedValue({});
    // salePrice 1000
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'MOD-CAR-001', salePrice: 1000 }]);
  });

  it('desconto dentro da alçada passa (COMMERCIAL 8% ≤ 10%)', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 920 }]),
    ).resolves.toBeUndefined();
  });

  it('COMMERCIAL com 15% bloqueia e orienta quem aprova', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).rejects.toThrow(/15% no item MOD-CAR-001 excede sua alçada \(teto 10%.*MANAGER, DIRECTOR/);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DISCOUNT_BLOCKED' }) }),
    );
  });

  it('MANAGER aprova 15% (teto 20%)', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'MANAGER', [{ productId: 'p1', unitPrice: 850 }]),
    ).resolves.toBeUndefined();
  });

  it('venda acima da tabela (desconto negativo) não valida alçada', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 1200 }]),
    ).resolves.toBeUndefined();
  });

  it('produto sem salePrice não tem base de alçada', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'X', salePrice: null }]);
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 1 }]),
    ).resolves.toBeUndefined();
  });

  it('papel sem política usa fallback 10%; SUPER_ADMIN sem política é liberado', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'WAREHOUSE', [{ productId: 'p1', unitPrice: 850 }]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.assertWithinLimit('co-1', 'SUPER_ADMIN', [{ productId: 'p1', unitPrice: 500 }]),
    ).resolves.toBeUndefined();
  });
});
