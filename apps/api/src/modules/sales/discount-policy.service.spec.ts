import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_DISCOUNT_POLICIES,
  DISCOUNT_OVERRIDE_PERMISSION,
  DiscountPolicyService,
} from './discount-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

const mockPrisma = {
  discountPolicy: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  role: { findFirst: jest.fn(), findMany: jest.fn() },
  product: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

// #1004: o eixo é o PERFIL v2. Ids fixos fazem o papel dos cuids do banco.
const ROLE = {
  VENDEDOR: { id: 'r-vendedor', code: 'VENDEDOR', name: 'Vendedor' },
  LOJA_OPERACIONAL: { id: 'r-loja', code: 'LOJA_OPERACIONAL', name: 'Loja — Operação' },
  GERENTE_GERAL: { id: 'r-gerente', code: 'GERENTE_GERAL', name: 'Gerente Geral' },
  DIRETOR: { id: 'r-diretor', code: 'DIRETOR', name: 'Diretor' },
  ADMIN_GLOBAL: { id: 'r-admin', code: 'ADMIN_GLOBAL', name: 'Admin Global' },
} as const;

type RoleKey = keyof typeof ROLE;

function politica(role: RoleKey, maxDiscountPct: number, isActive = true) {
  const { id, code, name } = ROLE[role];
  return { roleId: id, role: null, roleRef: { code, name }, maxDiscountPct, isActive };
}

// Espelha a produção PÓS-migration da #1004 (conversão da contagem read-only
// de 11/08/2026): 3 alçadas vivas por perfil; as duas linhas de 100%
// (DIRETOR/ADMIN_GLOBAL, herança do seed do #391) foram DESATIVADAS pela
// migration — o serviço filtra isActive no banco, então elas nem chegam.
const POLICIES = [
  politica('VENDEDOR', 10),
  politica('LOJA_OPERACIONAL', 10),
  politica('GERENTE_GERAL', 20),
];

const mockPermissions = { hasAnyPermission: jest.fn(), getVigentAssignments: jest.fn() };

/**
 * O usuário do teste tem estes perfis v2 vigentes — resolvidos pelo
 * PermissionService (#1004 pós-review: a definição de "vigente" mora lá).
 */
function perfisDoUsuario(...roles: RoleKey[]) {
  mockPermissions.getVigentAssignments.mockResolvedValue(
    roles.map((r) => ({ roleId: ROLE[r].id, role: { code: ROLE[r].code } })),
  );
}

describe('DiscountPolicyService (#391 + #947 + #1004)', () => {
  let service: DiscountPolicyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DiscountPolicyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();
    service = module.get(DiscountPolicyService);
    jest.clearAllMocks();
    // padrão: NINGUÉM ultrapassa o teto — o override é exceção declarada
    mockPermissions.hasAnyPermission.mockResolvedValue(false);
    mockPrisma.discountPolicy.findMany.mockResolvedValue(POLICIES);
    mockPrisma.auditLog.create.mockResolvedValue({});
    perfisDoUsuario(); // padrão: sem perfil com política → fallback
    // nomes de aprovador (ramo do bloqueio) resolvidos por roleId
    mockPrisma.role.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        Object.values(ROLE)
          .filter((r) => where.id.in.includes(r.id))
          .map((r) => ({ name: r.name })),
      ),
    );
    // salePrice 1000
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'MOD-CAR-001', salePrice: 1000 }]);
  });

  it('desconto dentro da alçada passa (VENDEDOR 8% ≤ 10%)', async () => {
    perfisDoUsuario('VENDEDOR');
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 920 }], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('VENDEDOR com 15% bloqueia e orienta quem aprova pelo NOME do perfil', async () => {
    perfisDoUsuario('VENDEDOR');
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).rejects.toThrow(/15% no item MOD-CAR-001 excede sua alçada \(teto 10%\).*Gerente Geral/);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DISCOUNT_BLOCKED' }) }),
    );
  });

  it('GERENTE_GERAL aprova 15% (teto 20%)', async () => {
    perfisDoUsuario('GERENTE_GERAL');
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('com DOIS perfis com política, vale a MAIOR alçada (10% e 20% → 20%)', async () => {
    perfisDoUsuario('VENDEDOR', 'GERENTE_GERAL');
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('venda acima da tabela (desconto negativo) não valida alçada', async () => {
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 1200 }], 'u1'),
    ).resolves.toBeUndefined();
    expect(mockPermissions.getVigentAssignments).not.toHaveBeenCalled();
  });

  // Produto sem preço de tabela passa SEM validação de alçada. É um buraco
  // conhecido e documentado no serviço, não um descuido: o fail-closed foi
  // escrito e revertido antes do deploy porque 338 dos 339 produtos ativos da
  // GDR têm salePrice nulo — recusar travaria o catálogo inteiro no POST
  // /sales. O caso fica coberto aqui para que a mudança de contrato, se um
  // dia acontecer, seja deliberada e não um efeito colateral.
  it('produto sem salePrice passa sem validação (buraco conhecido, ver issue)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'X', salePrice: null }]);
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 1 }], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('salePrice zero também passa (mesma ausência de base)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'X', salePrice: 0 }]);
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 1 }], 'u1'),
    ).resolves.toBeUndefined();
  });

  it('produto de OUTRA empresa (findMany não retorna) é recusado, não ignorado', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'de-outro-tenant', unitPrice: 1 }], 'u1'),
    ).rejects.toThrow(/não encontrado nesta empresa/);
  });

  it('usuário sem perfil com política usa fallback 10%', async () => {
    perfisDoUsuario('DIRETOR'); // tem perfil, mas nenhum com política ativa
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).rejects.toThrow(/teto 10%/);
  });

  it('usuário SEM NENHUM perfil v2 usa fallback 10% (sem fallback de enum)', async () => {
    perfisDoUsuario();
    await expect(
      service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
    ).rejects.toThrow(/teto 10%/);
  });

  // ── #947: o override saiu do enum e virou permissão ────────────────────────
  describe('#947 — override por permissão', () => {
    const ITEM_50_PCT = [{ productId: 'p1', unitPrice: 500 }];

    it('sem a permissão, respeita o teto', async () => {
      perfisDoUsuario('VENDEDOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('com a permissão, ultrapassa o teto', async () => {
      perfisDoUsuario('VENDEDOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT, 'u1'),
      ).resolves.toBeUndefined();
      expect(mockPermissions.hasAnyPermission).toHaveBeenCalledWith('u1', 'co-1', [
        DISCOUNT_OVERRIDE_PERMISSION,
      ]);
    });

    it('ADMIN_GLOBAL sem política e sem permissão é BLOQUEADO (perfil sozinho não concede)', async () => {
      perfisDoUsuario('ADMIN_GLOBAL');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('DIRETOR passa porque o PERFIL tem a permissão — não por ser diretor', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT, 'u-diretor'),
      ).resolves.toBeUndefined();
    });

    it('contexto SYSTEM (sem userId) NÃO ultrapassa o teto e nem resolve perfis', async () => {
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT),
      ).rejects.toThrow(BadRequestException);
      expect(mockPermissions.hasAnyPermission).not.toHaveBeenCalled();
      expect(mockPermissions.getVigentAssignments).not.toHaveBeenCalled();
    });

    it('venda DENTRO do teto nem consulta permissão (custo zero no caminho comum)', async () => {
      perfisDoUsuario('VENDEDOR');
      await expect(
        service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 950 }], 'u1'),
      ).resolves.toBeUndefined();
      expect(mockPermissions.hasAnyPermission).not.toHaveBeenCalled();
      // nomes de aprovador também só são resolvidos no ramo do bloqueio
      expect(mockPrisma.role.findMany).not.toHaveBeenCalled();
    });

    it('a trilha registra QUAL permissão faltou e os PERFIS de quem operou', async () => {
      perfisDoUsuario('VENDEDOR');
      await expect(
        service.assertWithinLimit('co-1', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
      const payload = mockPrisma.auditLog.create.mock.calls[0][0].data.payload;
      expect(payload.missingPermission).toBe(DISCOUNT_OVERRIDE_PERMISSION);
      expect(payload.roleCodes).toEqual(['VENDEDOR']);
    });
  });

  // ── #947/#1004: política de 100% não é alçada, é ausência de alçada ────────
  //
  // A migration da #1004 DESATIVA as duas linhas de 100% em produção (o
  // filtro isActive do banco já as exclui). Estes testes cobrem a defesa em
  // profundidade: se uma linha dessas voltasse à vida, ela continua ignorada.
  describe('#947 — política de 100% reativada continua ignorada', () => {
    const DESCONTO_50 = [{ productId: 'p1', unitPrice: 500 }];

    beforeEach(() => {
      mockPrisma.discountPolicy.findMany.mockResolvedValue([
        ...POLICIES,
        politica('DIRETOR', 100),
        politica('ADMIN_GLOBAL', 100),
      ]);
    });

    it('DIRETOR com política de 100%, SEM a permissão → NÃO tem override', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('a permissão É consultada mesmo com política de 100% (antes nem chegava lá)', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPermissions.hasAnyPermission).toHaveBeenCalledWith('u1', 'co-1', [
        DISCOUNT_OVERRIDE_PERMISSION,
      ]);
    });

    it('cai no teto default: a política de 100% não segura o desconto', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      // 12% > 10% (default) — os 100% reativados não valem como teto
      await expect(
        service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 880 }], 'u1'),
      ).rejects.toThrow(/teto 10%/);
    });

    it('DIRETOR COM a permissão passa — o comportamento aprovado é preservado', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', [{ productId: 'p1', unitPrice: 100 }], 'u-diretor'),
      ).resolves.toBeUndefined();
    });

    it('a trilha registra que a política sem teto foi desconsiderada', async () => {
      perfisDoUsuario('DIRETOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
      const payload = mockPrisma.auditLog.create.mock.calls[0][0].data.payload;
      expect(payload.missingPermission).toBe(DISCOUNT_OVERRIDE_PERMISSION);
      expect(payload.ignoredUncappedPolicy).toBe(true);
      expect(payload.limit).toBe(10);
    });

    it('quem tem só política de 100% NÃO é oferecido como aprovador', async () => {
      perfisDoUsuario('VENDEDOR');
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', DESCONTO_50, 'u1'),
      ).rejects.toThrow(/permissão "sales.discount.override"/);
    });
  });

  describe('#947 — o buraco não pode ser recavado', () => {
    it('os defaults não semeiam mais 100% para ninguém e já são por perfil v2', () => {
      for (const p of DEFAULT_DISCOUNT_POLICIES) {
        expect(p.maxDiscountPct).toBeLessThan(100);
      }
      expect(DEFAULT_DISCOUNT_POLICIES.map((p) => p.roleCode)).toEqual([
        'VENDEDOR',
        'LOJA_OPERACIONAL',
        'GERENTE_GERAL',
      ]);
    });

    it('configurar uma alçada de 100% é rejeitado, apontando a permissão', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({
        id: 'dp-1',
        roleId: ROLE.DIRETOR.id,
        maxDiscountPct: 20,
      });
      await expect(
        service.update('dp-1', 'co-1', { maxDiscountPct: 100 }),
      ).rejects.toThrow(/não é uma alçada.*sales\.discount\.override/s);
      expect(mockPrisma.discountPolicy.update).not.toHaveBeenCalled();
    });

    it('reativar uma linha de 100% herdada do seed é rejeitado (#1004)', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({
        id: 'dp-100',
        roleId: ROLE.DIRETOR.id,
        maxDiscountPct: 100,
        isActive: false,
      });
      await expect(service.update('dp-100', 'co-1', { isActive: true })).rejects.toThrow(
        /não pode ser reativada.*sales\.discount\.override/s,
      );
      expect(mockPrisma.discountPolicy.update).not.toHaveBeenCalled();
    });

    it('reativar CORRIGINDO o teto no mesmo pedido é aceito (pós-review #1066)', async () => {
      // Sem isso, a linha de 100% desativada pela migration ficava num beco:
      // não podia reativar (guarda) nem havia outro caminho de volta.
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({
        id: 'dp-100',
        roleId: ROLE.DIRETOR.id,
        maxDiscountPct: 100,
        isActive: false,
      });
      mockPrisma.discountPolicy.update.mockResolvedValue({ id: 'dp-100' });
      await expect(
        service.update('dp-100', 'co-1', { isActive: true, maxDiscountPct: 25 }),
      ).resolves.toBeDefined();
      expect(mockPrisma.discountPolicy.update).toHaveBeenCalledWith({
        where: { id: 'dp-100' },
        data: { isActive: true, maxDiscountPct: 25 },
      });
    });

    it('alçada normal continua editável', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({
        id: 'dp-1',
        roleId: ROLE.GERENTE_GERAL.id,
        maxDiscountPct: 20,
      });
      mockPrisma.discountPolicy.update.mockResolvedValue({ id: 'dp-1' });
      await expect(service.update('dp-1', 'co-1', { maxDiscountPct: 35 })).resolves.toBeDefined();
    });
  });

  // ── #1004: seed por perfil v2 ───────────────────────────────────────────────
  describe('#1004 — seedDefaults por perfil v2', () => {
    beforeEach(() => {
      mockPrisma.role.findFirst.mockImplementation(({ where }: any) => {
        const found = Object.values(ROLE).find((r) => r.code === where.code);
        return Promise.resolve(found ? { id: found.id } : null);
      });
      mockPrisma.discountPolicy.findFirst.mockResolvedValue(null);
      mockPrisma.discountPolicy.create.mockResolvedValue({});
    });

    it('cria as 3 alçadas apontando para o roleId do perfil system', async () => {
      const result = await service.seedDefaults('co-1');
      expect(result).toEqual({ created: 3, total: 3 });
      expect(mockPrisma.discountPolicy.create).toHaveBeenCalledWith({
        data: { companyId: 'co-1', roleId: ROLE.VENDEDOR.id, maxDiscountPct: 10 },
      });
      expect(mockPrisma.discountPolicy.create).toHaveBeenCalledWith({
        data: { companyId: 'co-1', roleId: ROLE.GERENTE_GERAL.id, maxDiscountPct: 20 },
      });
      // nenhuma criação escreve o enum legado
      for (const call of mockPrisma.discountPolicy.create.mock.calls) {
        expect(call[0].data.role).toBeUndefined();
      }
    });

    it('é idempotente: alçada existente para o perfil não é recriada', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({ id: 'dp-exists' });
      const result = await service.seedDefaults('co-1');
      expect(result).toEqual({ created: 0, total: 3 });
      expect(mockPrisma.discountPolicy.create).not.toHaveBeenCalled();
    });

    it('sem o catálogo IAM semeado, falha em vez de criar alçada cega', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(service.seedDefaults('co-1')).rejects.toThrow(/seed do IAM v2/);
      expect(mockPrisma.discountPolicy.create).not.toHaveBeenCalled();
    });
  });

  describe('#1004 — findAll expõe o perfil para a tela', () => {
    it('inclui code e name do perfil no retorno', async () => {
      await service.findAll('co-1');
      expect(mockPrisma.discountPolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'co-1' },
          include: { roleRef: { select: { id: true, code: true, name: true } } },
        }),
      );
    });
  });
});
