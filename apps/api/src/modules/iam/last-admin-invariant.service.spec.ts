import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LAST_ADMIN_ERROR_MESSAGE,
  LastAdminInvariantService,
} from './last-admin-invariant.service';

/**
 * Testes da invariante do último ADMIN_GLOBAL (#752) — lógica e ordenação.
 * A prova de LOCK/serialização de verdade (FOR UPDATE em Postgres real) vive
 * em last-admin-invariant.integration.spec.ts (gated por TEST_DATABASE_URL).
 */

const chamadas: string[] = [];

const mockTx = {
  $queryRaw: jest.fn(async () => {
    chamadas.push('lock');
    return [];
  }),
  company: { findMany: jest.fn(async () => []) },
  user: {
    count: jest.fn(async () => {
      chamadas.push('count');
      return 1;
    }),
    update: jest.fn(),
  },
};

const mockPrisma = {
  company: { findUnique: jest.fn() },
  userRoleAssignment: { count: jest.fn() },
  // Transação interativa: entrega o tx e propaga rejeição (rollback = throw).
  $transaction: jest.fn(async (fn: any) => fn(mockTx)),
};

describe('LastAdminInvariantService (#752)', () => {
  let service: LastAdminInvariantService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LastAdminInvariantService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(LastAdminInvariantService);
    jest.clearAllMocks();
    chamadas.length = 0;
    mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-raiz', parentId: null });
    mockTx.user.count.mockImplementation(async () => {
      chamadas.push('count');
      return 1;
    });
    mockTx.$queryRaw.mockImplementation(async () => {
      chamadas.push('lock');
      return [];
    });
    mockTx.company.findMany.mockResolvedValue([]); // grupo = só a raiz
  });

  describe('executarProtegido', () => {
    it('adquire o lock ANTES de qualquer contagem, tudo na mesma transação', async () => {
      await service.executarProtegido('co-1', async () => {
        chamadas.push('operacao');
        return 'ok';
      });
      // Ordem estrita: lock → contagem(antes) → operação → contagem(depois)
      expect(chamadas).toEqual(['lock', 'count', 'operacao', 'count']);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('lock é na EMPRESA-RAIZ: filial resolve para o parentId', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: 'co-filial', parentId: 'co-raiz' })
        .mockResolvedValueOnce({ id: 'co-raiz', parentId: null });
      await service.executarProtegido('co-filial', async () => 'ok');
      // O template literal do $queryRaw recebe o rootId como valor interpolado
      const args = (mockTx.$queryRaw.mock.calls as unknown[][])[0];
      expect(JSON.stringify(args)).toContain('co-raiz');
      expect(JSON.stringify(args)).toContain('FOR UPDATE');
    });

    it('operação que zera os admins (antes>0, depois=0) → 409 e a transação rejeita (rollback)', async () => {
      mockTx.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      await expect(
        service.executarProtegido('co-1', async () => 'nunca-comita'),
      ).rejects.toThrow(LAST_ADMIN_ERROR_MESSAGE);
    });

    it('grupo JÁ sem admin (antes=0, depois=0) não trava operação que não piora nada', async () => {
      mockTx.user.count.mockResolvedValue(0);
      await expect(service.executarProtegido('co-1', async () => 'ok')).resolves.toBe('ok');
    });

    it('sobrou pelo menos um admin → devolve o resultado da operação', async () => {
      mockTx.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      await expect(service.executarProtegido('co-1', async () => 42)).resolves.toBe(42);
    });

    it('empresa não resolvida → fail-closed (409) sem abrir transação', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      await expect(service.executarProtegido('co-x', async () => 'ok')).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('contagem: só admin PERPÉTUO conta (perfil system ativo, sem expiração, usuário ativo, árvore do grupo)', async () => {
      await service.executarProtegido('co-1', async () => 'ok');
      const where = (mockTx.user.count.mock.calls as any[])[0][0].where;
      expect(where).toEqual({
        isActive: true,
        companyId: { in: ['co-raiz'] },
        roleAssignments: {
          some: {
            expiresAt: null,
            role: { code: 'ADMIN_GLOBAL', isActive: true, companyId: null },
          },
        },
      });
    });
  });

  describe('helpers de decisão', () => {
    it('temVinculoAdminPerpetuo: exige expiresAt null + perfil system ativo', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1);
      await expect(service.temVinculoAdminPerpetuo('u1')).resolves.toBe(true);
      const where = mockPrisma.userRoleAssignment.count.mock.calls[0][0].where;
      expect(where.expiresAt).toBeNull();
      expect(where.role).toEqual({ code: 'ADMIN_GLOBAL', isActive: true, companyId: null });
    });

    it('ehAdminGlobalEfetivo: vínculo expirável mas VÁLIDO ainda conta (para as sanidades de deny)', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1);
      await expect(service.ehAdminGlobalEfetivo('u1')).resolves.toBe(true);
      const where = mockPrisma.userRoleAssignment.count.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
    });
  });

  describe('árvore empresarial de N níveis (#752)', () => {
    it('sobe até a RAIZ VERDADEIRA em 3 níveis (neta → filha → raiz)', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: 'co-neta', parentId: 'co-filha' })
        .mockResolvedValueOnce({ id: 'co-filha', parentId: 'co-raiz' })
        .mockResolvedValueOnce({ id: 'co-raiz', parentId: null });

      await service.executarProtegido('co-neta', async () => 'ok');

      expect(JSON.stringify(mockTx.$queryRaw.mock.calls[0])).toContain('co-raiz');
    });

    it('conta o grupo INTEIRO: raiz + filhas + netas (BFS)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-raiz', parentId: null });
      mockTx.company.findMany
        .mockResolvedValueOnce([{ id: 'co-filha' }])
        .mockResolvedValueOnce([{ id: 'co-neta' }])
        .mockResolvedValue([]);

      await service.executarProtegido('co-raiz', async () => 'ok');

      const where = (mockTx.user.count.mock.calls as any[])[0][0].where;
      expect(where.companyId.in.sort()).toEqual(['co-filha', 'co-neta', 'co-raiz']);
    });

    it('ciclo na hierarquia → fail-closed (409) sem abrir transação', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: 'co-a', parentId: 'co-b' })
        .mockResolvedValueOnce({ id: 'co-b', parentId: 'co-a' });

      await expect(service.executarProtegido('co-a', async () => 'ok')).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('árvore mais funda que o limite defensivo → fail-closed', async () => {
      mockPrisma.company.findUnique.mockImplementation(async ({ where }: any) => ({
        id: where.id,
        parentId: `${where.id}-pai`, // nunca chega a uma raiz
      }));

      await expect(service.executarProtegido('co-x', async () => 'ok')).rejects.toThrow(
        ConflictException,
      );
    });

    it('contexto entregue à operação traz raiz, grupo e contagem pós-lock', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ id: 'co-raiz', parentId: null });
      mockTx.company.findMany.mockResolvedValueOnce([{ id: 'co-filha' }]).mockResolvedValue([]);
      mockTx.user.count.mockResolvedValue(2);

      let recebido: any;
      await service.executarProtegido('co-raiz', async (_tx, ctx) => {
        recebido = ctx;
        return 'ok';
      });

      expect(recebido.rootId).toBe('co-raiz');
      expect(recebido.grupoIds.sort()).toEqual(['co-filha', 'co-raiz']);
      expect(recebido.adminsPerpetuosAntes).toBe(2);
    });
  });
});
