import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from './entitlement.service';

/**
 * OPS WP4 (#911) — resolução de entitlements.
 * Contratos: override > plano > default DESLIGADO (fail-closed); tenant sem
 * plano = LEGADO (tudo liberado); key desconhecida sempre desligada; cache
 * TTL com invalidação ativa; resolução sempre pela RAIZ.
 */

const mockPrisma = {
  company: { findUniqueOrThrow: jest.fn() },
};

function mockCompany(overrides: { plan?: any; entitlementOverrides?: any[]; parentId?: string | null } = {}) {
  // 1ª chamada: rootIdOf; 2ª: resolve na raiz
  mockPrisma.company.findUniqueOrThrow
    .mockResolvedValueOnce({ id: 'root-1', parentId: overrides.parentId ?? null })
    .mockResolvedValueOnce({
      plan: overrides.plan ?? null,
      entitlementOverrides: overrides.entitlementOverrides ?? [],
    });
}

describe('EntitlementService (OPS WP4 #911)', () => {
  let service: EntitlementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(EntitlementService);
    jest.clearAllMocks();
  });

  it('tenant SEM plano = legado: bools true, limites null (comportamento pré-WP4)', async () => {
    mockCompany({ plan: null });
    const resolved = await service.resolve('root-1');
    expect(resolved.legacy).toBe(true);
    expect(resolved.values.crm).toBe(true);
    expect(resolved.values.renave).toBe(true);
    expect(resolved.values.maxUsers).toBeNull();
  });

  it('com plano: default é fail-closed — key não declarada no plano fica DESLIGADA', async () => {
    mockCompany({
      plan: { code: 'ESSENCIAL', entitlements: { crm: false }, active: true },
    });
    const resolved = await service.resolve('root-1');
    expect(resolved.legacy).toBe(false);
    expect(resolved.values.crm).toBe(false);
    expect(resolved.values.renave).toBe(false); // não declarado → false
    expect(resolved.values.maxUsers).toBe(0); // limite não declarado → 0
  });

  it('override do tenant VENCE o plano', async () => {
    mockCompany({
      plan: { code: 'ESSENCIAL', entitlements: { crm: false, maxUsers: 10 }, active: true },
      entitlementOverrides: [
        { key: 'crm', value: true },
        { key: 'maxUsers', value: 50 },
      ],
    });
    const resolved = await service.resolve('root-1');
    expect(resolved.values.crm).toBe(true);
    expect(resolved.values.maxUsers).toBe(50);
  });

  it('key desconhecida no banco é IGNORADA (catálogo em código é a fonte da verdade)', async () => {
    mockCompany({
      plan: { code: 'X', entitlements: { moduloFantasma: true }, active: true },
      entitlementOverrides: [{ key: 'outroFantasma', value: true }],
    });
    const resolved = await service.resolve('root-1');
    expect(resolved.values.moduloFantasma).toBeUndefined();
    expect(resolved.values.outroFantasma).toBeUndefined();
  });

  it('can(): key desconhecida → false sem tocar o banco', async () => {
    expect(await service.can('root-1', 'naoExiste')).toBe(false);
    expect(mockPrisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('filial resolve pela RAIZ', async () => {
    mockPrisma.company.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'filial-1', parentId: 'root-1' })
      .mockResolvedValueOnce({
        plan: { code: 'PROFISSIONAL', entitlements: { crm: true }, active: true },
        entitlementOverrides: [],
      });
    expect(await service.can('filial-1', 'crm')).toBe(true);
    // segunda consulta foi na raiz
    expect(mockPrisma.company.findUniqueOrThrow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'root-1' } }),
    );
  });

  it('cache: segunda resolução no TTL não consulta o banco; invalidate() força reload', async () => {
    mockCompany({ plan: null });
    await service.resolve('root-1');
    expect(mockPrisma.company.findUniqueOrThrow).toHaveBeenCalledTimes(2);

    // hit de cache: só a resolução de raiz (1 chamada) — o mapa vem do cache
    mockPrisma.company.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'root-1',
      parentId: null,
    });
    await service.resolve('root-1');
    expect(mockPrisma.company.findUniqueOrThrow).toHaveBeenCalledTimes(3);

    service.invalidate('root-1');
    mockCompany({ plan: null });
    await service.resolve('root-1');
    expect(mockPrisma.company.findUniqueOrThrow).toHaveBeenCalledTimes(5);
  });

  it('limit(): null = ilimitado; número = teto; key desconhecida = 0', async () => {
    mockCompany({
      plan: { code: 'P', entitlements: { maxUsers: 25 }, active: true },
    });
    expect(await service.limit('root-1', 'maxUsers')).toBe(25);
    expect(await service.limit('root-1', 'semLimiteConhecido')).toBe(0);
  });
});
