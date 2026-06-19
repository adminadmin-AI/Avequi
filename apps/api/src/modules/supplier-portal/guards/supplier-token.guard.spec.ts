import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SupplierTokenGuard } from './supplier-token.guard';

const mockPrisma = {
  supplierToken: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

function makeContext(headers: Record<string, string>) {
  const request = { headers, supplier: undefined as unknown };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('SupplierTokenGuard', () => {
  let guard: SupplierTokenGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierTokenGuard,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    guard = module.get<SupplierTokenGuard>(SupplierTokenGuard);
  });

  it('should pass and attach supplier when token is valid', async () => {
    const tokenRecord = {
      id: 'tok-1',
      token: 'valid-token',
      revokedAt: null,
      expiresAt: null,
      supplier: {
        id: 'sup-1',
        name: 'Fornecedor A',
        companyId: 'co-1',
      },
    };
    mockPrisma.supplierToken.findUnique.mockResolvedValue(tokenRecord);
    mockPrisma.supplierToken.update.mockResolvedValue(tokenRecord);

    const ctx = makeContext({ authorization: 'Bearer valid-token' });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.supplier).toEqual({
      id: 'sup-1',
      name: 'Fornecedor A',
      companyId: 'co-1',
      tokenId: 'tok-1',
    });
  });

  it('should pass using X-Supplier-Token header', async () => {
    const tokenRecord = {
      id: 'tok-2',
      token: 'header-token',
      revokedAt: null,
      expiresAt: null,
      supplier: { id: 'sup-2', name: 'Fornecedor B', companyId: 'co-1' },
    };
    mockPrisma.supplierToken.findUnique.mockResolvedValue(tokenRecord);
    mockPrisma.supplierToken.update.mockResolvedValue(tokenRecord);

    const ctx = makeContext({ 'x-supplier-token': 'header-token' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw UnauthorizedException when no token provided', async () => {
    const ctx = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when token not found', async () => {
    mockPrisma.supplierToken.findUnique.mockResolvedValue(null);
    const ctx = makeContext({ authorization: 'Bearer nonexistent' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when token is revoked', async () => {
    const tokenRecord = {
      id: 'tok-3',
      token: 'revoked-token',
      revokedAt: new Date('2026-01-01'),
      expiresAt: null,
      supplier: { id: 'sup-1', name: 'Fornecedor A', companyId: 'co-1' },
    };
    mockPrisma.supplierToken.findUnique.mockResolvedValue(tokenRecord);
    const ctx = makeContext({ authorization: 'Bearer revoked-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException when token is expired', async () => {
    const tokenRecord = {
      id: 'tok-4',
      token: 'expired-token',
      revokedAt: null,
      expiresAt: new Date('2020-01-01'), // in the past
      supplier: { id: 'sup-1', name: 'Fornecedor A', companyId: 'co-1' },
    };
    mockPrisma.supplierToken.findUnique.mockResolvedValue(tokenRecord);
    const ctx = makeContext({ authorization: 'Bearer expired-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
