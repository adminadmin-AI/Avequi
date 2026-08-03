import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from './permission.service';
import { PermissionCacheService } from './permission-cache.service';
import { companyScope, scopeWhere, EffectiveScope } from './scope';

/**
 * Testes do escopo por filial/loja — #347 fase 2 (347-A, SHADOW).
 *
 * Travam as decisões do Rafael (11/07/2026):
 * - retrocompatibilidade: assignment SEM branchId = visão COMPANY (ninguém
 *   perde acesso no dia 1 — nenhum assignment em produção tem branch);
 * - o vínculo mais amplo vence (misto null+branch → COMPANY);
 * - múltiplas lojas = múltiplos assignments (união de filiais/depósitos);
 * - filial sem depósito vinculado = fail-closed (lista vazia, não vê nada);
 * - OWN preparado no helper, ainda sem uso nos módulos (CRM decide no bloco F).
 */

const mockPrisma = {
  userRoleAssignment: { findMany: jest.fn() },
  userPermission: { findMany: jest.fn() },
  role: { findMany: jest.fn() },
  warehouse: { findMany: jest.fn() },
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  delUserAllCompanies: jest.fn(),
  delCompany: jest.fn(),
  // #347-B: cache do escopo — default miss (resolve no banco)
  getScope: jest.fn().mockResolvedValue(null),
  setScope: jest.fn().mockResolvedValue(undefined),
};

describe('Escopo por filial (#347-A)', () => {
  describe('scopeWhere (helper central)', () => {
    const base: EffectiveScope = {
      level: 'BRANCH',
      branchIds: ['b1'],
      warehouseIds: ['w1', 'w2'],
      userId: 'u1',
    };

    it('COMPANY → sem filtro adicional (services seguem só com companyId)', () => {
      expect(scopeWhere(companyScope('u1'))).toEqual({});
    });

    it('BRANCH → filtra pelos depósitos da(s) filial(is)', () => {
      expect(scopeWhere(base)).toEqual({ warehouseId: { in: ['w1', 'w2'] } });
    });

    it('BRANCH com campo customizado (ex.: fromWarehouseId em transferências)', () => {
      expect(scopeWhere(base, { warehouseField: 'fromWarehouseId' })).toEqual({
        fromWarehouseId: { in: ['w1', 'w2'] },
      });
    });

    it('BRANCH sem depósito vinculado = fail-closed (in: [] — vê nada, não tudo)', () => {
      expect(scopeWhere({ ...base, warehouseIds: [] })).toEqual({
        warehouseId: { in: [] },
      });
    });

    it('OWN → filtra pelo dono (preparado; nenhum módulo usa ainda)', () => {
      expect(scopeWhere({ ...base, level: 'OWN' })).toEqual({ createdById: 'u1' });
      expect(
        scopeWhere({ ...base, level: 'OWN' }, { ownerField: 'assignedToId' }),
      ).toEqual({ assignedToId: 'u1' });
    });
  });

  describe('PermissionService.getUserScope', () => {
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
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);
      mockPrisma.warehouse.findMany.mockResolvedValue([]);
      mockCache.getScope.mockResolvedValue(null); // #347-B: default = miss
    });

    it('usuário SEM assignments (fallback legado) → COMPANY (retrocompatível)', async () => {
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope).toEqual(companyScope('u1'));
      expect(mockPrisma.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('assignment sem branchId → COMPANY (estado atual de produção: ninguém perde acesso)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: null }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('COMPANY');
      expect(scope.warehouseIds).toEqual([]);
    });

    it('mistos (COMPANY + BRANCH) → COMPANY prevalece (decisão de produto, reconfirmada 03/08/2026)', async () => {
      // Perfil corporativo não perde a visão da empresa por também exercer
      // função local: qualquer assignment sem branchId amplia para COMPANY.
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { branchId: 'b1' },
        { branchId: null },
      ]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope).toEqual(companyScope('u1'));
      // COMPANY resolvido cedo: nem consulta depósitos
      expect(mockPrisma.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('uma filial → BRANCH com os depósitos ativos dela', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b1' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope).toEqual({
        level: 'BRANCH',
        branchIds: ['b1'],
        warehouseIds: ['w1', 'w2'],
        userId: 'u1',
      });
      expect(mockPrisma.warehouse.findMany).toHaveBeenCalledWith({
        where: { companyId: 'c1', branchId: { in: ['b1'] }, isActive: true },
        select: { id: true },
      });
    });

    it('múltiplas filiais (gerente acumula lojas) → união de branches/depósitos', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { branchId: 'b1' },
        { branchId: 'b2' },
        { branchId: 'b1' }, // dois perfis na mesma loja não duplicam
      ]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }, { id: 'w3' }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(scope.branchIds).toEqual(['b1', 'b2']);
      expect(scope.warehouseIds).toEqual(['w1', 'w3']);
    });

    it('filial sem depósito vinculado → BRANCH com lista vazia (fail-closed)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b9' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(scope.warehouseIds).toEqual([]);
    });

    it('consulta de assignments respeita expiração e perfil ativo (mesma regra das permissões)', async () => {
      await service.getUserScope('u1', 'c1');
      const arg = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0];
      expect(arg.where.userId).toBe('u1');
      expect(arg.where.companyId).toBe('c1');
      expect(arg.where.role).toEqual({ isActive: true });
      expect(arg.where.OR).toBeDefined(); // notExpired
    });

    // ─── #347-B: cache-first (mesmo ciclo do cache de permissões) ───────────

    it('cache hit: devolve o escopo cacheado sem tocar o banco', async () => {
      mockCache.getScope.mockResolvedValue({
        v: 1,
        level: 'BRANCH',
        branchIds: ['b1'],
        warehouseIds: ['w1'],
      });
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope).toEqual({ level: 'BRANCH', branchIds: ['b1'], warehouseIds: ['w1'], userId: 'u1' });
      expect(mockPrisma.userRoleAssignment.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.warehouse.findMany).not.toHaveBeenCalled();
    });

    // ── #347-B: multiempresa e falha de cache ──────────────────────

    it('multiempresa: depósitos sempre filtrados pela empresa do par (userId, companyId)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b1' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }]);
      await service.getUserScope('u1', 'c1');
      // assignments da empresa c1...
      expect(mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where.companyId).toBe('c1');
      // ...e depósitos TAMBÉM presos a c1: branch de outra empresa nunca
      // traria depósito de fora, mesmo com dado sujo no assignment.
      expect(mockPrisma.warehouse.findMany.mock.calls[0][0].where.companyId).toBe('c1');
    });

    it('multiempresa: branch que não é da empresa → zero depósitos = fail-closed (nunca amplia)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b-de-outra-empresa' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([]); // filtro por companyId não acha nada
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(scope.warehouseIds).toEqual([]); // vê NADA — jamais vira COMPANY
    });

    it('Redis fora (getScope = null): resolve no banco e BRANCH continua BRANCH', async () => {
      mockCache.getScope.mockResolvedValue(null); // é o que o cache devolve com Redis fora
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b1' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(scope.warehouseIds).toEqual(['w1']);
    });

    it('setScope falhando não impede devolver o escopo calculado do banco', async () => {
      mockCache.setScope.mockRejectedValue(new Error('redis down'));
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b1' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(scope.warehouseIds).toEqual(['w1']);
    });

    it('cache miss: resolve no banco e popula o cache (best-effort)', async () => {
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ branchId: 'b1' }]);
      mockPrisma.warehouse.findMany.mockResolvedValue([{ id: 'w1' }]);
      const scope = await service.getUserScope('u1', 'c1');
      expect(scope.level).toBe('BRANCH');
      expect(mockCache.setScope).toHaveBeenCalledWith('c1', 'u1', {
        v: 1,
        level: 'BRANCH',
        branchIds: ['b1'],
        warehouseIds: ['w1'],
      });
    });
  });
});
