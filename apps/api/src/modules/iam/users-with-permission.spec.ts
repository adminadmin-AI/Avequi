import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from './permission.service';
import { PermissionCacheService } from './permission-cache.service';

/**
 * #1002-C3 — consulta REVERSA: quem tem esta permissão nesta empresa?
 *
 * O resto do serviço responde "este usuário pode?". Aqui a pergunta é a
 * inversa, e ela precisa dar EXATAMENTE a mesma resposta que a direta — senão
 * um usuário apareceria na lista de elegíveis e levaria 403 na ação, ou o
 * contrário: alguém receberia lead que não consegue atender.
 *
 * Precedência replicada:
 *   efetivo = ((grants de perfil − denys de perfil) ∪ grants individuais)
 *             − denys individuais
 */
describe('PermissionService.usersWithPermission (#1002-C3)', () => {
  let service: PermissionService;

  const CODE = 'crm.leads.assignable';
  const COMPANY = 'c1';

  const mockPrisma = {
    role: { findMany: jest.fn() },
    userRoleAssignment: { findMany: jest.fn() },
    userPermission: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };

  /** Perfil que CONCEDE o code. */
  const perfilConcede = (id: string, parentId: string | null = null) => ({
    id,
    parentId,
    rolePermissions: [{ granted: true }],
  });
  /** Perfil que NEGA explicitamente. */
  const perfilNega = (id: string, parentId: string | null = null) => ({
    id,
    parentId,
    rolePermissions: [{ granted: false }],
  });
  /** Perfil neutro: não diz nada sobre o code. */
  const perfilNeutro = (id: string, parentId: string | null = null) => ({
    id,
    parentId,
    rolePermissions: [],
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: PermissionCacheService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(PermissionService);
    jest.clearAllMocks();
    mockPrisma.userPermission.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
  });

  it('perfil oficial que concede: os atribuídos entram', async () => {
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r-vendedor')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual(['u1', 'u2']);
  });

  it('perfil CUSTOMIZADO da empresa concede igual ao oficial', async () => {
    // A query traz perfis globais (companyId null) E os da empresa — não há
    // distinção na resolução: o que vale é a marca da permissão.
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r-custom')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ userId: 'u9' }]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual(['u9']);

    const where = mockPrisma.role.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ companyId: null }, { companyId: COMPANY }]);
    expect(where.isActive).toBe(true);
  });

  it('herança concede: filho neutro herda o grant do pai', async () => {
    mockPrisma.role.findMany.mockResolvedValue([
      perfilConcede('pai'),
      perfilNeutro('filho', 'pai'),
    ]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await service.usersWithPermission(COMPANY, CODE);

    const roleIds = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where.roleId.in;
    expect(roleIds.sort()).toEqual(['filho', 'pai']);
  });

  it('deny de perfil na cadeia anula o grant herdado — mas só para quem passa por ele', async () => {
    // O deny vale para a cadeia de QUEM tem o perfil: `pai` nega, então `pai`
    // e `filho` (que herda dele) não concedem. O `avo` continua concedendo a
    // quem o tem DIRETAMENTE — a cadeia dele não tem deny nenhum. É
    // exatamente o que `resolveFromDatabase` faz para o usuário.
    mockPrisma.role.findMany.mockResolvedValue([
      perfilConcede('avo'),
      perfilNega('pai', 'avo'),
      perfilNeutro('filho', 'pai'),
    ]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ userId: 'u-avo' }]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual(['u-avo']);

    const roleIds = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where.roleId.in;
    expect(roleIds).toEqual(['avo']); // pai e filho ficaram de fora
  });

  it('grant individual torna elegível quem não tem perfil nenhum', async () => {
    mockPrisma.role.findMany.mockResolvedValue([]);
    mockPrisma.userPermission.findMany.mockResolvedValue([{ userId: 'u-solo', granted: true }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u-solo' }]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual(['u-solo']);
  });

  it('deny individual REMOVE mesmo com perfil oficial concedendo', async () => {
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r1')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    mockPrisma.userPermission.findMany.mockResolvedValue([{ userId: 'u2', granted: false }]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual(['u1']);
  });

  it('deny individual vence até um grant individual do mesmo usuário', async () => {
    mockPrisma.role.findMany.mockResolvedValue([]);
    mockPrisma.userPermission.findMany.mockResolvedValue([
      { userId: 'u1', granted: true },
      { userId: 'u1', granted: false },
    ]);

    await expect(service.usersWithPermission(COMPANY, CODE)).resolves.toEqual([]);
  });

  it('perfil INATIVO não concede — o filtro está na query', async () => {
    mockPrisma.role.findMany.mockResolvedValue([]);
    await service.usersWithPermission(COMPANY, CODE);

    expect(mockPrisma.role.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('assignment EXPIRADO não conta e usuário INATIVO não retorna', async () => {
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r1')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);

    await service.usersWithPermission(COMPANY, CODE);

    const where = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
    expect(where.user).toEqual({ isActive: true });
  });

  it('a consulta é sempre recortada pela empresa — nunca where vazio', async () => {
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r1')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await service.usersWithPermission(COMPANY, CODE);

    expect(mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where.companyId).toBe(COMPANY);
    expect(mockPrisma.userPermission.findMany.mock.calls[0][0].where.companyId).toBe(COMPANY);
  });

  it('não usa o fallback legado: o enum não torna ninguém elegível', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs')
      .readFileSync('src/modules/iam/permission.service.ts', 'utf-8')
      .split('async usersWithPermission')[1]
      .split('async hasRole')[0];
    expect(src).not.toMatch(/resolveWithLegacyFallback|ENUM_ROLE_TO_SYSTEM_ROLE|user\.role/);
  });

  it('custo previsível: 3 queries, independentemente do número de usuários', async () => {
    mockPrisma.role.findMany.mockResolvedValue([perfilConcede('r1')]);
    mockPrisma.userRoleAssignment.findMany.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({ userId: `u${i}` })),
    );

    const ids = await service.usersWithPermission(COMPANY, CODE);

    expect(ids).toHaveLength(500);
    // roles + assignments + overrides. Sem N+1: nenhuma query por usuário.
    expect(mockPrisma.role.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userRoleAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.userPermission.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });
});
