import { NotFoundException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { UserAccessService } from './user-access.service';
import { MfaService } from './mfa.service';

/**
 * #1107 — escopo de GRUPO nas operações administrativas sobre usuários.
 *
 * O findAll já enxergava a árvore desde a #947; findOne/update e todo o IAM
 * de acesso continuavam presos a uma única empresa. Resultado: a lista
 * mostrava o usuário da filial e abrir esse mesmo usuário dava 404.
 *
 * Duas famílias de teste vivem aqui:
 *
 *  1. ESCOPO — quem enxerga o quê, e o que continua invisível.
 * ⚙️ Os serviços são instanciados DIRETAMENTE (`new`), sem o DI do Nest: são
 * classes com dependências por construtor e nada aqui precisa do container.
 * Compilar 20 TestingModules custa CPU real e, rodando em paralelo com a
 * suíte inteira, empurrava testes de bcrypt de outros arquivos para além do
 * timeout de 5s. Instanciar direto é mais rápido e igualmente fiel.
 *
 *  2. ACTOR × TARGET — quando a matriz administra um usuário da filial, todo
 *     vínculo/registro/cache precisa usar a empresa DO ALVO. Errar isso é
 *     pior que o 404 original, porque falha em silêncio: o vínculo nasce na
 *     empresa errada e o cache de permissões guarda a permissão antiga.
 */

const MATRIZ = 'co-matriz';
const FILIAL = 'co-filial';
const OUTRO_TENANT = 'co-de-outro-cliente';

const ATOR = { id: 'admin-matriz', companyId: MATRIZ };

/** Escopo AMPLIADO: o ator tem `iam.tenant-scope.cross-company`. */
const escopoAmpliado = {
  resolverEscopo: jest.fn(async () => ({
    companyIds: [MATRIZ, FILIAL],
    ampliado: true,
  })),
};

/** Escopo PADRÃO: sem a capability — só a própria empresa. */
const escopoRestrito = {
  resolverEscopo: jest.fn(async (_u: string, companyId: string) => ({
    companyIds: [companyId],
    ampliado: false,
  })),
};

const SAFE = {
  id: 'user-filial',
  name: 'Operador da Filial',
  email: 'op@gdr.com',
  role: 'COMMERCIAL',
  isActive: true,
  companyId: FILIAL,
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Prisma falso que respeita o filtro `companyId: { in: [...] }`.
 *
 * É o detalhe que dá valor a esta suíte: um mock que devolve o usuário
 * sempre passaria mesmo se a correção esquecesse o filtro. Aqui, esquecer o
 * escopo faz o teste de isolamento falhar de verdade.
 */
function prismaFake(usuarios: any[]) {
  const casa = (where: any, u: any) => {
    if (where.id && where.id !== u.id) return false;
    const c = where.companyId;
    if (c === undefined) return true;
    if (typeof c === 'string') return c === u.companyId;
    if (c?.in) return c.in.includes(u.companyId);
    return false;
  };
  return {
    user: {
      findFirst: jest.fn(async ({ where }: any) => usuarios.find((u) => casa(where, u)) ?? null),
      findMany: jest.fn(async ({ where }: any) => usuarios.filter((u) => casa(where, u))),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => SAFE),
    },
    role: { findFirst: jest.fn(async () => ({ id: 'role-1', code: 'COMERCIAL', name: 'Comercial' })) },
    branch: { findFirst: jest.fn(async () => ({ id: 'branch-1' })) },
    userRoleAssignment: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'ura-1', ...data })),
      delete: jest.fn(async () => ({})),
    },
    userPermission: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }: any) => ({ id: 'up-1', ...create })),
      delete: jest.fn(async () => ({})),
    },
    permission: { findUnique: jest.fn(async () => ({ id: 'perm-1', code: 'sales.orders.view', name: 'Ver pedidos' })) },
    permissionChangeLog: { create: jest.fn(async () => ({})) },
    userMFA: { findUnique: jest.fn(async () => ({ userId: 'user-filial', enabled: true })), delete: jest.fn(async () => ({})) },
    securityEvent: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaTx) : Promise.all(arg),
    ),
  } as any;
}
let prismaTx: any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#1107 — UserService: escopo de árvore', () => {
  let service: UserService;
  let prisma: any;

  const montar = async (escopo: any, lastAdmin?: any) => {
    prisma = prismaFake([SAFE, { ...SAFE, id: 'user-outro-tenant', companyId: OUTRO_TENANT }]);
    service = new UserService(
      prisma,
      { validateComplexity: jest.fn(), assertNotReused: jest.fn() } as any,
      { revokeAllSessions: jest.fn() } as any,
      lastAdmin ?? ({ temVinculoAdminPerpetuo: jest.fn(async () => false), executarProtegido: jest.fn() } as any),
      { limit: jest.fn(async () => null) } as any,
      escopo as any,
    );
  };

  beforeEach(() => jest.clearAllMocks());

  it('1) ator COM cross-company + alvo na filial da mesma árvore → encontra', async () => {
    await montar(escopoAmpliado);
    const achado = await service.findOne('user-filial', ATOR);
    expect(achado.id).toBe('user-filial');
    expect(achado.companyId).toBe(FILIAL);
  });

  it('2) ator SEM cross-company + alvo na filial → 404 (comportamento de antes, preservado)', async () => {
    await montar(escopoRestrito);
    await expect(service.findOne('user-filial', ATOR)).rejects.toThrow(NotFoundException);
  });

  it('3) ator COM cross-company + alvo de OUTRO tenant → 404 (isolamento entre árvores)', async () => {
    await montar(escopoAmpliado);
    await expect(service.findOne('user-outro-tenant', ATOR)).rejects.toThrow(NotFoundException);
  });

  it('4) alvo inexistente e alvo fora do escopo dão a MESMA resposta (anti-enumeração)', async () => {
    await montar(escopoAmpliado);
    const fora = await service.findOne('user-outro-tenant', ATOR).catch((e) => e);
    const inexistente = await service.findOne('nao-existe', ATOR).catch((e) => e);
    expect(fora).toBeInstanceOf(NotFoundException);
    expect(inexistente).toBeInstanceOf(NotFoundException);
    expect(fora.getStatus()).toBe(inexistente.getStatus()); // 404 nos dois
  });

  it('5) resolverEscopo falhando NUNCA amplia: o erro sobe, ninguém é encontrado a mais', async () => {
    await montar({ resolverEscopo: jest.fn(async () => { throw new Error('banco fora'); }) });
    await expect(service.findOne('user-filial', ATOR)).rejects.toThrow('banco fora');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('6) deny individual na capability (escopo restrito) → filial inacessível', async () => {
    await montar(escopoRestrito); // é o que o TenantScope devolve com deny
    await expect(service.findOne('user-filial', ATOR)).rejects.toThrow(NotFoundException);
  });

  it('7) ADMIN_EMPRESA (sem a capability) continua restrito à própria empresa', async () => {
    await montar(escopoRestrito);
    const proprio = { ...SAFE, id: 'user-proprio', companyId: MATRIZ };
    prisma.user.findFirst.mockImplementation(async ({ where }: any) =>
      where.companyId?.in?.includes(MATRIZ) && where.id === 'user-proprio' ? proprio : null,
    );
    await expect(service.findOne('user-proprio', ATOR)).resolves.toMatchObject({ companyId: MATRIZ });
    await expect(service.findOne('user-filial', ATOR)).rejects.toThrow(NotFoundException);
  });

  it('8) a consulta NUNCA perde o escopo de empresa (trava contra where sem filtro)', async () => {
    await montar(escopoAmpliado);
    await service.findOne('user-filial', ATOR);
    const where = prisma.user.findFirst.mock.calls[0][0].where;
    expect(where.companyId).toBeDefined();
    expect(where.companyId.in).toEqual([MATRIZ, FILIAL]);
    expect(where.companyId.in).not.toContain(OUTRO_TENANT);
  });

  it('update também respeita a árvore e usa o companyId do ALVO no lock da invariante', async () => {
    await montar(escopoAmpliado);
    const lastAdmin = {
      temVinculoAdminPerpetuo: jest.fn(async () => true),
      executarProtegido: jest.fn(async (_c: string, fn: any) => fn({ user: { update: jest.fn(async () => SAFE) } })),
    };
    await montar(escopoAmpliado, lastAdmin);
    await service.update('user-filial', { isActive: false } as any, ATOR);
    // A empresa passada ao lock é a do ALVO (filial), não a do ator (matriz).
    expect(lastAdmin.executarProtegido).toHaveBeenCalledWith(FILIAL, expect.any(Function));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#1107 — UserAccessService: actor × target', () => {
  let service: UserAccessService;
  let prisma: any;
  let permissionService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = prismaFake([SAFE, { ...SAFE, id: 'user-outro-tenant', companyId: OUTRO_TENANT }]);
    prismaTx = prisma;
    permissionService = { invalidateUser: jest.fn() };
    service = new UserAccessService(
      prisma,
      permissionService as any,
      { logWithDiff: jest.fn() } as any,
      { executarProtegido: jest.fn(async (_c: string, fn: any) => fn(prisma, { adminsPerpetuosAntes: 1 })) } as any,
      { sincronizarNaTransacao: jest.fn(async () => ({ mudou: false })), revogarSessoesSeMudou: jest.fn(async () => 0) } as any,
      escopoAmpliado as any,
    );
  });

  it('assignRole grava o vínculo na empresa do ALVO, não na do ator', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    const criado = prisma.userRoleAssignment.create.mock.calls[0][0].data;
    expect(criado.companyId).toBe(FILIAL);
    expect(criado.companyId).not.toBe(MATRIZ);
  });

  it('a busca do PERFIL usa a empresa do alvo (perfil da matriz não vaza para a filial)', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    const where = prisma.role.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ isSystem: true }, { companyId: FILIAL }]);
  });

  it('a validação da BRANCH usa a empresa do alvo', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1', branchId: 'branch-1' } as any);
    expect(prisma.branch.findFirst.mock.calls[0][0].where).toMatchObject({ companyId: FILIAL });
  });

  it('a DEDUPLICAÇÃO procura na empresa do alvo', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    const chave = prisma.userRoleAssignment.findUnique.mock.calls[0][0].where.userId_roleId_companyId;
    expect(chave.companyId).toBe(FILIAL);
  });

  it('PermissionChangeLog fica na empresa do alvo', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    expect(prisma.permissionChangeLog.create.mock.calls[0][0].data.companyId).toBe(FILIAL);
  });

  it('⚠️ invalidateUser usa a empresa do ALVO — sem isso a permissão antiga sobrevive no cache', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    // A chave do cache é `iam:perms:{companyId}:{userId}`. Com a empresa do
    // ator, apagaríamos uma chave inexistente e a real seguiria viva por até
    // 5 minutos (TTL) — revogação sem efeito, em silêncio.
    expect(permissionService.invalidateUser).toHaveBeenCalledWith('user-filial', FILIAL);
    expect(permissionService.invalidateUser).not.toHaveBeenCalledWith('user-filial', MATRIZ);
  });

  it('grantPermission grava a exceção na empresa do alvo e invalida o cache dele', async () => {
    await service.grantPermission(ATOR, 'user-filial', { permissionCode: 'sales.orders.view' } as any);
    expect(prisma.userPermission.upsert.mock.calls[0][0].create.companyId).toBe(FILIAL);
    expect(permissionService.invalidateUser).toHaveBeenCalledWith('user-filial', FILIAL);
  });

  it('alvo de outro tenant → 404 em todas as operações (isolamento)', async () => {
    await expect(
      service.assignRole(ATOR, 'user-outro-tenant', { roleId: 'role-1' } as any),
    ).rejects.toThrow(NotFoundException);
    await expect(service.listUserRoles(ATOR, 'user-outro-tenant')).rejects.toThrow(NotFoundException);
    expect(prisma.userRoleAssignment.create).not.toHaveBeenCalled();
  });

  it('a busca do alvo NUNCA perde o escopo de empresa', async () => {
    await service.assignRole(ATOR, 'user-filial', { roleId: 'role-1' } as any);
    const where = prisma.user.findFirst.mock.calls[0][0].where;
    expect(where.companyId).toBeDefined();
    expect(where.companyId.in).toEqual([MATRIZ, FILIAL]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#1107 — MfaService.adminReset: escopo de árvore', () => {
  const montar = async (escopo: any, prisma: any) =>
    new MfaService(prisma, { isConfigured: () => true } as any, escopo as any);

  it('reset de MFA alcança a filial e grava o SecurityEvent na empresa do ALVO', async () => {
    const prisma = prismaFake([SAFE]);
    prisma.user.findUnique = jest.fn(async () => ({
      // bcrypt de 'SenhaDoAdmin1!' não importa: o compare é mockado abaixo
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
    }));
    const bcrypt = require('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const service = await montar(escopoAmpliado, prisma);
    await service.adminReset({ id: ATOR.id, companyId: MATRIZ }, 'user-filial', 'qualquer');

    const evento = prisma.securityEvent.create.mock.calls[0][0].data;
    expect(evento.companyId).toBe(FILIAL);
    expect(evento.companyId).not.toBe(MATRIZ);
    (bcrypt.compare as jest.Mock).mockRestore();
  });

  it('sem a capability, a filial continua inacessível (404)', async () => {
    const prisma = prismaFake([SAFE]);
    prisma.user.findUnique = jest.fn(async () => ({ passwordHash: 'x' }));
    const bcrypt = require('bcryptjs');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const service = await montar(escopoRestrito, prisma);
    await expect(
      service.adminReset({ id: ATOR.id, companyId: MATRIZ }, 'user-filial', 'qualquer'),
    ).rejects.toThrow(NotFoundException);
    (bcrypt.compare as jest.Mock).mockRestore();
  });
});
