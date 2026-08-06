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
  product: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

// Espelha EXATAMENTE o que está semeado em produção (consulta read-only
// 04/08/2026): as duas linhas de 100% são herança do seed do #391, nunca
// editadas por ninguém — e são o buraco que o #947 fecha.
const POLICIES = [
  { role: 'COMMERCIAL', maxDiscountPct: 10, isActive: true },
  { role: 'STORE', maxDiscountPct: 10, isActive: true },
  { role: 'MANAGER', maxDiscountPct: 20, isActive: true },
  { role: 'DIRECTOR', maxDiscountPct: 100, isActive: true },
  { role: 'SUPER_ADMIN', maxDiscountPct: 100, isActive: true },
];

const mockPermissions = { hasAnyPermission: jest.fn() };

describe('DiscountPolicyService (#391 + #947)', () => {
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
    ).rejects.toThrow(/15% no item MOD-CAR-001 excede sua alçada \(teto 10%.*MANAGER/);
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

  // Auditoria de segurança 06/08/2026 — este teste travava o comportamento
  // ERRADO. "Sem preço de tabela = sem base de alçada" liberava passagem: o
  // item ia para a OV com o unitPrice que viesse no corpo da requisição, sem
  // teto nenhum, justamente porque não havia com o que comparar. A alçada
  // existe para limitar preço vindo do cliente — faltar a base tem de fechar
  // a porta, não abrir. Contrato invertido para fail-closed.
  it('produto sem salePrice é RECUSADO (não há base para validar a alçada)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'X', salePrice: null }]);
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 1 }]),
    ).rejects.toThrow(/X não tem preço de tabela/);
  });

  it('salePrice zero também é recusado (mesma ausência de base)', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'X', salePrice: 0 }]);
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 1 }]),
    ).rejects.toThrow(BadRequestException);
  });

  it('produto de OUTRA empresa (findMany não retorna) é recusado, não ignorado', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    await expect(
      service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'de-outro-tenant', unitPrice: 1 }]),
    ).rejects.toThrow(/não encontrado nesta empresa/);
  });

  it('papel sem política usa fallback 10%', async () => {
    await expect(
      service.assertWithinLimit('co-1', 'WAREHOUSE', [{ productId: 'p1', unitPrice: 850 }]),
    ).rejects.toThrow(BadRequestException);
  });

  // ── #947: o override saiu do enum e virou permissão ────────────────────────
  describe('#947 — override por permissão', () => {
    const ITEM_50_PCT = [{ productId: 'p1', unitPrice: 500 }];

    it('sem a permissão, respeita o teto', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'VENDEDOR', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('com a permissão, ultrapassa o teto', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', 'VENDEDOR', ITEM_50_PCT, 'u1'),
      ).resolves.toBeUndefined();
      expect(mockPermissions.hasAnyPermission).toHaveBeenCalledWith('u1', 'co-1', [
        DISCOUNT_OVERRIDE_PERMISSION,
      ]);
    });

    it('o ENUM SOZINHO não concede mais: SUPER_ADMIN sem política e sem permissão é BLOQUEADO', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'SUPER_ADMIN', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('GERENTE_GERAL (enum MANAGER) sem a permissão fica no teto da tabela', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      // 20% é o teto do MANAGER: 25% estoura
      await expect(
        service.assertWithinLimit('co-1', 'MANAGER', [{ productId: 'p1', unitPrice: 750 }], 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('DIRETOR passa porque o PERFIL tem a permissão — não porque o enum diz DIRECTOR', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', undefined, ITEM_50_PCT, 'u-diretor'),
      ).resolves.toBeUndefined();
    });

    it('contexto SYSTEM (sem userId) NÃO ultrapassa o teto', async () => {
      await expect(
        service.assertWithinLimit('co-1', 'VENDEDOR', ITEM_50_PCT),
      ).rejects.toThrow(BadRequestException);
      expect(mockPermissions.hasAnyPermission).not.toHaveBeenCalled();
    });

    it('venda DENTRO do teto nem consulta permissão (custo zero no caminho comum)', async () => {
      await expect(
        service.assertWithinLimit('co-1', 'COMMERCIAL', [{ productId: 'p1', unitPrice: 950 }], 'u1'),
      ).resolves.toBeUndefined();
      expect(mockPermissions.hasAnyPermission).not.toHaveBeenCalled();
    });

    it('a trilha registra QUAL permissão faltou', async () => {
      await expect(
        service.assertWithinLimit('co-1', 'VENDEDOR', ITEM_50_PCT, 'u1'),
      ).rejects.toThrow(BadRequestException);
      const payload = mockPrisma.auditLog.create.mock.calls[0][0].data.payload;
      expect(payload.missingPermission).toBe(DISCOUNT_OVERRIDE_PERMISSION);
    });
  });

  // ── #947 (2ª rodada): o buraco da tabela indexada pelo enum ────────────────
  //
  // A 1ª rodada consultava a permissão só QUANDO o desconto ultrapassava o
  // teto da tabela. Com DIRECTOR/SUPER_ADMIN = 100% em produção, desconto
  // nenhum ultrapassava — a permissão nunca era consultada e o enum congelado
  // preservava o poder inteiro. Estes testes guardam o fechamento disso.
  describe('#947 — política de 100% não é alçada, é ausência de alçada', () => {
    const DESCONTO_50 = [{ productId: 'p1', unitPrice: 500 }];
    const DESCONTO_90 = [{ productId: 'p1', unitPrice: 100 }];

    it('enum DIRECTOR com política de 100%, SEM a permissão → NÃO tem override', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('enum SUPER_ADMIN com política de 100%, SEM a permissão → NÃO tem override', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'SUPER_ADMIN', DESCONTO_90, 'u1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('usuário REBAIXADO no RBAC com enum congelado em DIRECTOR cai no teto default', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      // 12% > 10% (default) — o enum congelado não segura mais os 100%
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', [{ productId: 'p1', unitPrice: 880 }], 'u1'),
      ).rejects.toThrow(/teto 10%/);
    });

    it('a permissão É consultada mesmo com política de 100% (antes nem chegava lá)', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPermissions.hasAnyPermission).toHaveBeenCalledWith('u1', 'co-1', [
        DISCOUNT_OVERRIDE_PERMISSION,
      ]);
    });

    it('DIRETOR COM a permissão passa — o comportamento aprovado é preservado', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', DESCONTO_90, 'u-diretor'),
      ).resolves.toBeUndefined();
    });

    it('ADMIN_EMPRESA com a permissão passa (o enum dele nem existe na tabela)', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      await expect(
        service.assertWithinLimit('co-1', undefined, DESCONTO_50, 'u-admin-empresa'),
      ).resolves.toBeUndefined();
    });

    it('deny explícito da permissão retira o override', async () => {
      // o deny é aplicado dentro do PermissionService: chega aqui como false
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', DESCONTO_50, 'u-negado'),
      ).rejects.toThrow(BadRequestException);
    });

    it('a trilha registra que a política sem teto foi desconsiderada', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'DIRECTOR', DESCONTO_50, 'u1'),
      ).rejects.toThrow(BadRequestException);
      const payload = mockPrisma.auditLog.create.mock.calls[0][0].data.payload;
      expect(payload.missingPermission).toBe(DISCOUNT_OVERRIDE_PERMISSION);
      expect(payload.ignoredUncappedPolicy).toBe(true);
      expect(payload.limit).toBe(10);
    });

    it('quem tem só política de 100% NÃO é oferecido como aprovador', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(false);
      await expect(
        service.assertWithinLimit('co-1', 'COMMERCIAL', DESCONTO_50, 'u1'),
      ).rejects.toThrow(/permissão "sales.discount.override"/);
    });

    it('alçada normal continua valendo: MANAGER 15% ≤ 20% passa sem consultar permissão', async () => {
      await expect(
        service.assertWithinLimit('co-1', 'MANAGER', [{ productId: 'p1', unitPrice: 850 }], 'u1'),
      ).resolves.toBeUndefined();
      expect(mockPermissions.hasAnyPermission).not.toHaveBeenCalled();
    });
  });

  describe('#947 — o buraco não pode ser recavado', () => {
    it('os defaults não semeiam mais 100% para ninguém', () => {
      for (const p of DEFAULT_DISCOUNT_POLICIES) {
        expect(p.maxDiscountPct).toBeLessThan(100);
      }
      expect(DEFAULT_DISCOUNT_POLICIES.map((p) => p.role)).toEqual([
        'COMMERCIAL',
        'STORE',
        'MANAGER',
      ]);
    });

    it('configurar uma alçada de 100% é rejeitado, apontando a permissão', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({ id: 'dp-1', role: 'DIRECTOR' });
      await expect(
        service.update('dp-1', 'co-1', { maxDiscountPct: 100 }),
      ).rejects.toThrow(/não é uma alçada.*sales\.discount\.override/s);
      expect(mockPrisma.discountPolicy.update).not.toHaveBeenCalled();
    });

    it('alçada normal continua editável', async () => {
      mockPrisma.discountPolicy.findFirst.mockResolvedValue({ id: 'dp-1', role: 'MANAGER' });
      mockPrisma.discountPolicy.update.mockResolvedValue({ id: 'dp-1' });
      await expect(service.update('dp-1', 'co-1', { maxDiscountPct: 35 })).resolves.toBeDefined();
    });
  });
});
