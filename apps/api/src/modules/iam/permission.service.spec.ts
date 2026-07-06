import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService, permissionMatches } from './permission.service';
import { PermissionCacheService } from './permission-cache.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Testes do PermissionService (#340) — PrismaService e cache mockados
 * (convenção do repo: nunca chamada real ao banco).
 */

const mockPrisma = {
  userRoleAssignment: { findMany: jest.fn() },
  userPermission: { findMany: jest.fn() },
  role: { findMany: jest.fn() },
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delUserAllCompanies: jest.fn(),
  delCompany: jest.fn(),
};

/** Linha de Role como o resolveFromDatabase seleciona. */
function roleRow(
  id: string,
  parentId: string | null,
  perms: Array<[code: string, granted?: boolean]>,
) {
  return {
    id,
    parentId,
    rolePermissions: perms.map(([code, granted = true]) => ({
      granted,
      permission: { code },
    })),
  };
}

/** Configura role.findMany para responder por frontier (where.id.in). */
function mockRoleChain(rolesById: Record<string, ReturnType<typeof roleRow>>) {
  mockPrisma.role.findMany.mockImplementation(({ where }: any) => {
    const ids: string[] = where?.id?.in ?? [];
    return Promise.resolve(ids.map((id) => rolesById[id]).filter(Boolean));
  });
}

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(PermissionService);
    jest.clearAllMocks();

    // Defaults: cache miss e banco vazio — cada teste sobrescreve o que precisa
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
    mockPrisma.userPermission.findMany.mockResolvedValue([]);
    mockPrisma.role.findMany.mockResolvedValue([]);
  });

  // ─── permissionMatches (wildcard) ──────────────────────────────────────────

  describe('permissionMatches (wildcard)', () => {
    const effective = new Set(['sales.orders.view', 'sales.orders.create', 'stock.balances.view']);

    it('casa code exato', () => {
      expect(permissionMatches(effective, 'sales.orders.view')).toBe(true);
      expect(permissionMatches(effective, 'sales.orders.delete')).toBe(false);
    });

    it('casa wildcard de módulo (sales.*)', () => {
      expect(permissionMatches(effective, 'sales.*')).toBe(true);
      expect(permissionMatches(effective, 'finance.*')).toBe(false);
    });

    it('casa wildcard de recurso (sales.orders.*)', () => {
      expect(permissionMatches(effective, 'sales.orders.*')).toBe(true);
      expect(permissionMatches(effective, 'sales.quotations.*')).toBe(false);
    });

    it('"*" casa qualquer conjunto não vazio', () => {
      expect(permissionMatches(effective, '*')).toBe(true);
      expect(permissionMatches(new Set<string>(), '*')).toBe(false);
    });

    it('padrão inválido nunca casa (fail-closed) e nunca lança', () => {
      expect(permissionMatches(effective, 'sa*les.orders.view')).toBe(false);
      expect(permissionMatches(effective, 'sales.*.view')).toBe(false);
      expect(permissionMatches(effective, 'sales*')).toBe(false);
    });
  });

  // ─── Resolução com herança ─────────────────────────────────────────────────

  describe('getUserPermissions — herança de perfis', () => {
    it('resolve a cadeia parent → child (Supervisor herda Operador)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-sup', role: { code: 'SUPERVISOR' } },
      ]);
      mockRoleChain({
        'r-sup': roleRow('r-sup', 'r-op', [['production.orders.approve']]),
        'r-op': roleRow('r-op', null, [['production.orders.view'], ['production.orders.report']]),
      });

      const result = await service.getUserPermissions('u1', 'c1');

      expect(result.roles).toEqual(['SUPERVISOR']);
      expect(result.permissions).toEqual([
        'production.orders.approve',
        'production.orders.report',
        'production.orders.view',
      ]);
    });

    it('resolve herança de N níveis (neto herda avô)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-3', role: { code: 'NIVEL_3' } },
      ]);
      mockRoleChain({
        'r-3': roleRow('r-3', 'r-2', [['c.c.three']]),
        'r-2': roleRow('r-2', 'r-1', [['b.b.two']]),
        'r-1': roleRow('r-1', null, [['a.a.one']]),
      });

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).toEqual(['a.a.one', 'b.b.two', 'c.c.three']);
    });

    it('é defensivo contra ciclo de herança no banco (termina e une as permissões)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-a', role: { code: 'A' } },
      ]);
      // A → B → A (ciclo corrompido no banco)
      mockRoleChain({
        'r-a': roleRow('r-a', 'r-b', [['x.x.a']]),
        'r-b': roleRow('r-b', 'r-a', [['x.x.b']]),
      });

      const { permissions } = await service.getUserPermissions('u1', 'c1');

      expect(permissions).toEqual(['x.x.a', 'x.x.b']);
      // 2 iterações (frontier r-a, depois r-b) — não loop infinito
      expect(mockPrisma.role.findMany).toHaveBeenCalledTimes(2);
    });

    it('múltiplos perfis: união das permissões', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-v', role: { code: 'VENDEDOR' } },
        { roleId: 'r-a', role: { code: 'ALMOXARIFE' } },
      ]);
      mockRoleChain({
        'r-v': roleRow('r-v', null, [['sales.orders.create']]),
        'r-a': roleRow('r-a', null, [['stock.balances.view']]),
      });

      const result = await service.getUserPermissions('u1', 'c1');
      expect(result.roles).toEqual(['VENDEDOR', 'ALMOXARIFE']);
      expect(result.permissions).toEqual(['sales.orders.create', 'stock.balances.view']);
    });

    it('sem perfil e sem exceção → conjunto vazio (na dúvida, restringir)', async () => {
      const result = await service.getUserPermissions('u1', 'c1');
      expect(result).toEqual({ roles: [], permissions: [] });
    });

    it('filtra atribuições expiradas e perfis inativos na query', async () => {
      await service.getUserPermissions('u1', 'c1');

      const where = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.companyId).toBe('c1');
      expect(where.role).toEqual({ isActive: true });
      expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);

      const upWhere = mockPrisma.userPermission.findMany.mock.calls[0][0].where;
      expect(upWhere.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
    });
  });

  // ─── Precedência grant/deny ────────────────────────────────────────────────

  describe('precedência', () => {
    beforeEach(() => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-1', role: { code: 'VENDEDOR' } },
      ]);
      mockRoleChain({
        'r-1': roleRow('r-1', null, [['sales.orders.view'], ['sales.orders.create']]),
      });
    });

    it('grant individual acrescenta permissão que nenhum perfil dá', async () => {
      mockPrisma.userPermission.findMany.mockResolvedValue([
        { granted: true, permission: { code: 'finance.entries.view' } },
      ]);

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).toContain('finance.entries.view');
    });

    it('deny individual remove permissão concedida por perfil', async () => {
      mockPrisma.userPermission.findMany.mockResolvedValue([
        { granted: false, permission: { code: 'sales.orders.create' } },
      ]);

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).toEqual(['sales.orders.view']);
    });

    it('deny individual vence grant individual (deny mais forte no mesmo nível)', async () => {
      mockPrisma.userPermission.findMany.mockResolvedValue([
        { granted: true, permission: { code: 'finance.entries.view' } },
        { granted: false, permission: { code: 'finance.entries.view' } },
      ]);

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).not.toContain('finance.entries.view');
    });

    it('deny de perfil (RolePermission.granted=false) vence grant de outro perfil', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-1', role: { code: 'VENDEDOR' } },
        { roleId: 'r-2', role: { code: 'RESTRITO' } },
      ]);
      mockRoleChain({
        'r-1': roleRow('r-1', null, [['sales.orders.view'], ['sales.orders.create']]),
        'r-2': roleRow('r-2', null, [['sales.orders.create', false]]),
      });

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).toEqual(['sales.orders.view']);
    });

    it('grant individual SOBREPÕE deny de perfil (exceção vence perfil)', async () => {
      mockRoleChain({
        'r-1': roleRow('r-1', null, [['sales.orders.view'], ['sales.orders.create', false]]),
      });
      mockPrisma.userPermission.findMany.mockResolvedValue([
        { granted: true, permission: { code: 'sales.orders.create' } },
      ]);

      const { permissions } = await service.getUserPermissions('u1', 'c1');
      expect(permissions).toContain('sales.orders.create');
    });
  });

  // ─── Checks ────────────────────────────────────────────────────────────────

  describe('hasPermission / hasAnyPermission / hasAllPermissions / hasRole', () => {
    beforeEach(() => {
      mockCache.get.mockResolvedValue({
        v: 1,
        roles: ['VENDEDOR'],
        permissions: ['sales.orders.view', 'sales.orders.create'],
      });
    });

    it('hasPermission: exato e wildcard', async () => {
      await expect(service.hasPermission('u1', 'c1', 'sales.orders.view')).resolves.toBe(true);
      await expect(service.hasPermission('u1', 'c1', 'sales.*')).resolves.toBe(true);
      await expect(service.hasPermission('u1', 'c1', 'finance.entries.view')).resolves.toBe(false);
    });

    it('hasAnyPermission: true se pelo menos uma; lista vazia = false', async () => {
      await expect(
        service.hasAnyPermission('u1', 'c1', ['finance.entries.view', 'sales.orders.create']),
      ).resolves.toBe(true);
      await expect(service.hasAnyPermission('u1', 'c1', ['finance.entries.view'])).resolves.toBe(false);
      await expect(service.hasAnyPermission('u1', 'c1', [])).resolves.toBe(false);
    });

    it('hasAllPermissions: exige todas; lista vazia = true (vacuamente)', async () => {
      await expect(
        service.hasAllPermissions('u1', 'c1', ['sales.orders.view', 'sales.orders.create']),
      ).resolves.toBe(true);
      await expect(
        service.hasAllPermissions('u1', 'c1', ['sales.orders.view', 'finance.entries.view']),
      ).resolves.toBe(false);
      await expect(service.hasAllPermissions('u1', 'c1', [])).resolves.toBe(true);
    });

    it('hasRole: só perfil diretamente atribuído', async () => {
      await expect(service.hasRole('u1', 'c1', 'VENDEDOR')).resolves.toBe(true);
      await expect(service.hasRole('u1', 'c1', 'OPERADOR')).resolves.toBe(false);
    });
  });

  // ─── Cache ─────────────────────────────────────────────────────────────────

  describe('cache', () => {
    it('cache hit: NÃO toca o banco', async () => {
      mockCache.get.mockResolvedValue({ v: 1, roles: ['X'], permissions: ['a.b.c'] });

      const result = await service.getUserPermissions('u1', 'c1');

      expect(result).toEqual({ roles: ['X'], permissions: ['a.b.c'] });
      expect(mockPrisma.userRoleAssignment.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.userPermission.findMany).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('cache miss: resolve no banco e popula o cache', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-1', role: { code: 'VENDEDOR' } },
      ]);
      mockRoleChain({ 'r-1': roleRow('r-1', null, [['sales.orders.view']]) });

      await service.getUserPermissions('u1', 'c1');

      expect(mockCache.set).toHaveBeenCalledWith('c1', 'u1', {
        v: 1,
        roles: ['VENDEDOR'],
        permissions: ['sales.orders.view'],
      });
    });

    it('fallback gracioso: cache.get devolvendo null (Redis fora) → banco responde', async () => {
      mockCache.get.mockResolvedValue(null); // indisponível = miss
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { roleId: 'r-1', role: { code: 'VENDEDOR' } },
      ]);
      mockRoleChain({ 'r-1': roleRow('r-1', null, [['sales.orders.view']]) });

      await expect(service.hasPermission('u1', 'c1', 'sales.orders.view')).resolves.toBe(true);
    });
  });

  // ─── Invalidação ativa ─────────────────────────────────────────────────────

  describe('invalidação', () => {
    it('invalidateUser com companyId: deleta a chave exata', async () => {
      await service.invalidateUser('u1', 'c1');
      expect(mockCache.del).toHaveBeenCalledWith('c1', 'u1');
      expect(mockCache.delUserAllCompanies).not.toHaveBeenCalled();
    });

    it('invalidateUser sem companyId: deleta em todas as empresas', async () => {
      await service.invalidateUser('u1');
      expect(mockCache.delUserAllCompanies).toHaveBeenCalledWith('u1');
    });

    it('invalidateCompany: deleta todas as chaves da empresa', async () => {
      await service.invalidateCompany('c1');
      expect(mockCache.delCompany).toHaveBeenCalledWith('c1');
    });

    it('invalidateRole: invalida usuários do perfil E dos perfis descendentes', async () => {
      // r-op tem filho r-sup (r-sup herda de r-op → mudar r-op afeta r-sup)
      mockPrisma.role.findMany.mockImplementation(({ where }: any) => {
        const parents: string[] = where?.parentId?.in ?? [];
        if (parents.includes('r-op')) return Promise.resolve([{ id: 'r-sup' }]);
        return Promise.resolve([]);
      });
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { userId: 'u1', companyId: 'c1' },
        { userId: 'u2', companyId: 'c1' },
        { userId: 'u2', companyId: 'c1' }, // duplicado → 1 del só
      ]);

      await service.invalidateRole('r-op');

      const where = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where;
      expect(where.roleId.in).toEqual(expect.arrayContaining(['r-op', 'r-sup']));
      expect(mockCache.del).toHaveBeenCalledTimes(2);
      expect(mockCache.del).toHaveBeenCalledWith('c1', 'u1');
      expect(mockCache.del).toHaveBeenCalledWith('c1', 'u2');
    });
  });
});
