import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { TenantScopeService } from '../iam/tenant-scope.service';
import { LastAdminInvariantService } from '../iam/last-admin-invariant.service';
import { SessionService } from '../iam/session.service';
import { UserService } from './user.service';

/**
 * OPS WP4 (#911) — limite de usuários do plano (maxUsers).
 * Contratos: legado (null) = ilimitado; no teto → 403 com orientação de
 * upgrade e NENHUM usuário criado; abaixo do teto → cria; conta usuários
 * ATIVOS da árvore (matriz + filiais).
 */

const mockPrisma = {
  user: { create: jest.fn(), count: jest.fn() },
  company: { findUnique: jest.fn(), findMany: jest.fn() },
  role: { findFirst: jest.fn() },
};
const mockEntitlement = { limit: jest.fn() };
const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  recordPasswordChange: jest.fn().mockResolvedValue(undefined),
};

const DTO = {
  name: 'Novo',
  email: 'novo@crd.com.br',
  password: 'Senha#Forte2026',
  role: 'READER',
} as any;

describe('UserService — limite maxUsers (OPS WP4 #911)', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        {
          provide: LastAdminInvariantService,
          useValue: { temVinculoAdminPerpetuo: jest.fn().mockResolvedValue(false) },
        },
        { provide: SessionService, useValue: { revokeAllSessions: jest.fn() } },
        { provide: EntitlementService, useValue: mockEntitlement },
        // #947: escopo empresarial por capability
        { provide: TenantScopeService, useValue: { resolverEscopo: jest.fn().mockResolvedValue({ companyIds: ['co-1'], ampliado: false }) } },
      ],
    }).compile();
    service = module.get(UserService);
    jest.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'root-1', parentId: null });
    mockPrisma.company.findMany.mockResolvedValue([{ id: 'filial-1' }]);
    mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-1' });
    mockPrisma.user.create.mockResolvedValue({ id: 'u-novo' });
  });

  it('legado (limit null) → ilimitado, nem conta usuários', async () => {
    mockEntitlement.limit.mockResolvedValue(null);
    await service.create(DTO, 'root-1', 'admin-1');
    expect(mockPrisma.user.count).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).toHaveBeenCalled();
  });

  it('no teto → 403 com orientação de plano e NADA criado', async () => {
    mockEntitlement.limit.mockResolvedValue(10);
    mockPrisma.user.count.mockResolvedValue(10);
    await expect(service.create(DTO, 'root-1', 'admin-1')).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.create(DTO, 'root-1', 'admin-1').catch((e) => Promise.reject(e)),
    ).rejects.toThrow(/limite de 10 usuários/);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('abaixo do teto → cria; contagem cobre a ÁRVORE (matriz + filiais), só ativos', async () => {
    mockEntitlement.limit.mockResolvedValue(10);
    mockPrisma.user.count.mockResolvedValue(9);
    await service.create(DTO, 'root-1', 'admin-1');
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { companyId: { in: ['root-1', 'filial-1'] }, isActive: true },
    });
    expect(mockPrisma.user.create).toHaveBeenCalled();
  });

  it('usuário criado em FILIAL conta contra o limite da RAIZ', async () => {
    mockEntitlement.limit.mockResolvedValue(5);
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'filial-1', parentId: 'root-1' });
    mockPrisma.user.count.mockResolvedValue(5);
    await expect(service.create(DTO, 'filial-1', 'admin-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
