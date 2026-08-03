import { LastAdminInvariantService } from './last-admin-invariant.service';

// O jest.config mapeia '@prisma/client' para um mock global (unit tests nunca
// tocam banco) — e o mapper reescreve até o requireActual. AQUI o banco real
// é o ponto: carrega o client verdadeiro pelo caminho físico do pacote, que
// o padrão `^@prisma/client$` não captura.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = jest.requireActual(
  '../../../../../node_modules/@prisma/client',
);
type PrismaClient = import('@prisma/client').PrismaClient;

/**
 * Prova REAL de lock e serialização da invariante #752 — roda contra um
 * PostgreSQL de verdade (descartável), apontado por TEST_DATABASE_URL.
 * Sem a env, a suíte é pulada (o CI atual não tem Postgres de teste; a
 * lógica/ordenação é coberta pelo unit spec ao lado).
 *
 * Pré-requisito: schema aplicado no banco de teste (npx prisma db push).
 *
 * O que só ESTE spec consegue provar:
 *  - duas transações concorrentes serializam no FOR UPDATE da empresa-raiz;
 *  - exatamente UMA conclui quando a segunda deixaria o grupo sem admin;
 *  - o ESTADO FINAL do banco respeita a invariante (não só as exceções);
 *  - rollback integral da operação bloqueada.
 */

/**
 * COMO RODAR (Postgres descartável, NUNCA o banco da empresa):
 *
 *   # 1. suba um Postgres vazio e aplique o schema
 *   DATABASE_URL=postgresql://u:p@localhost:5433/itg752 \
 *     npx prisma db push --schema apps/api/prisma/schema.prisma
 *   # 2. rode a suíte apontando para ele
 *   TEST_DATABASE_URL=postgresql://u:p@localhost:5433/itg752 \
 *     npx jest last-admin-invariant.integration --runInBand
 *
 * Sem TEST_DATABASE_URL a suíte é PULADA (o CI atual não tem Postgres de
 * serviço — ver issue de infra). O spec ESCREVE e APAGA dados: por isso
 * recusa qualquer URL que não seja de banco descartável/local.
 */

const url = process.env.TEST_DATABASE_URL;

/**
 * Guarda anti-produção: a URL precisa ser local/descartável. Qualquer host
 * remoto (supabase, railway, rds…) aborta a suíte em vez de escrever.
 */
function urlEhDescartavel(u: string): boolean {
  const host = (() => {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const localhost = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'postgres', 'db'];
  return localhost.includes(host);
}

if (url && !urlEhDescartavel(url)) {
  throw new Error(
    'TEST_DATABASE_URL aponta para um host REMOTO. Esta suíte escreve e apaga dados: ' +
      'use um PostgreSQL descartável local (localhost/127.0.0.1/serviço de CI).',
  );
}

if (!url) {
  // Fica visível no output por que a prova de serialização não rodou.
  // eslint-disable-next-line no-console
  console.warn(
    '[#752] Testes de concorrência PULADOS: defina TEST_DATABASE_URL com um ' +
      'PostgreSQL descartável para provar o lock (ver cabeçalho do arquivo).',
  );
}

const d = url ? describe : describe.skip;

d('LastAdminInvariantService — integração Postgres real (#752)', () => {
  let prisma: PrismaClient;
  let service: LastAdminInvariantService;
  let rootId: string;
  let filhaId: string;
  let netaId: string;
  let roleId: string;

  const ids = {
    adminA: 'itg752-admin-a',
    adminB: 'itg752-admin-b',
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    // O service só usa company.findUnique, userRoleAssignment.count e
    // $transaction — o client puro cumpre o contrato do PrismaService aqui.
    service = new LastAdminInvariantService(prisma as any);

    // Árvore de TRÊS níveis: raiz → filha → neta. Os admins moram na NETA,
    // o nível mais fundo — se a resolução de raiz fosse de um salto só
    // (parentId ?? id), o grupo seria resolvido errado e a invariante ficaria
    // cega. Aqui isso é provado end-to-end.
    const root = await prisma.company.create({
      data: { name: 'ITG752 Grupo', cnpj: `itg752-${Date.now()}` } as any,
    });
    rootId = root.id;
    const filha = await prisma.company.create({
      data: { name: 'ITG752 Filha', cnpj: `itg752f-${Date.now()}`, parentId: root.id } as any,
    });
    const neta = await prisma.company.create({
      data: { name: 'ITG752 Neta', cnpj: `itg752n-${Date.now()}`, parentId: filha.id } as any,
    });
    netaId = neta.id;
    filhaId = filha.id;
    const role = await prisma.role.create({
      data: { code: 'ADMIN_GLOBAL', name: 'Admin Global ITG', isSystem: true, isActive: true } as any,
    });
    roleId = role.id;

    for (const [key, id] of Object.entries(ids)) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@itg752.test`,
          name: key,
          passwordHash: 'x',
          role: 'SUPER_ADMIN',
          companyId: netaId, // nível mais fundo da árvore
          isActive: true,
        } as any,
      });
      await prisma.userRoleAssignment.create({
        data: { userId: id, roleId, companyId: netaId, grantedBy: 'itg752' } as any,
      });
    }
  }, 60_000);

  afterAll(async () => {
    // Limpeza do que o próprio spec criou (banco é descartável de qualquer forma)
    await prisma.userRoleAssignment.deleteMany({ where: { companyId: netaId } });
    await prisma.user.deleteMany({ where: { companyId: netaId } });
    await prisma.role.delete({ where: { id: roleId } }).catch(() => undefined);
    for (const id of [netaId, filhaId, rootId]) {
      await prisma.company.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }, 60_000);

  const reativarTodos = async () => {
    await prisma.user.updateMany({
      where: { id: { in: Object.values(ids) } },
      data: { isActive: true },
    });
  };

  it('CONCORRÊNCIA (árvore de 3 níveis): duas inativações simultâneas — exatamente UMA conclui e o banco termina com 1 admin ativo', async () => {
    await reativarTodos();

    const inativar = (userId: string) =>
      service.executarProtegido(netaId, async (tx) => {
        // Meio da transação: janela real de corrida
        await tx.user.update({ where: { id: userId }, data: { isActive: false } });
        await new Promise((r) => setTimeout(r, 150));
        return userId;
      });

    const resultados = await Promise.allSettled([inativar(ids.adminA), inativar(ids.adminB)]);

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const falhou = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(falhou).toHaveLength(1);
    expect((falhou[0] as PromiseRejectedResult).reason.message).toMatch(/administrador global/);

    // O que importa: o ESTADO FINAL do banco respeita a invariante.
    const ativos = await prisma.user.count({
      where: { companyId: netaId, isActive: true, roleAssignments: { some: { roleId } } },
    });
    expect(ativos).toBe(1);
  }, 60_000);

  it('CONCORRÊNCIA: inativação × remoção de assignment simultâneas — no máximo uma tira um admin de cena', async () => {
    await reativarTodos();

    const inativarA = service.executarProtegido(netaId, async (tx) => {
      await tx.user.update({ where: { id: ids.adminA }, data: { isActive: false } });
      await new Promise((r) => setTimeout(r, 150));
    });
    const removerVinculoB = service.executarProtegido(netaId, async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { userId: ids.adminB, roleId } });
      await new Promise((r) => setTimeout(r, 150));
    });

    const resultados = await Promise.allSettled([inativarA, removerVinculoB]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const admins = await prisma.user.count({
      where: {
        companyId: netaId,
        isActive: true,
        roleAssignments: { some: { roleId, expiresAt: null } },
      },
    });
    expect(admins).toBe(1);

    // Restaura o vínculo de B se a remoção venceu a corrida
    const vinculoB = await prisma.userRoleAssignment.count({ where: { userId: ids.adminB, roleId } });
    if (vinculoB === 0) {
      await prisma.userRoleAssignment.create({
        data: { userId: ids.adminB, roleId, companyId: netaId, grantedBy: 'itg752' } as any,
      });
    }
  }, 60_000);

  it('ÚNICO admin: inativação bloqueada com rollback integral (o update é desfeito)', async () => {
    await reativarTodos();
    // Deixa só A como admin: remove o vínculo de B (permitido: sobra A)
    await service.executarProtegido(netaId, async (tx) => {
      await tx.userRoleAssignment.deleteMany({ where: { userId: ids.adminB, roleId } });
    });

    await expect(
      service.executarProtegido(netaId, async (tx) => {
        await tx.user.update({ where: { id: ids.adminA }, data: { isActive: false } });
      }),
    ).rejects.toThrow(/administrador global/);

    // Rollback integral: A continua ATIVO no banco
    const a = await prisma.user.findUnique({ where: { id: ids.adminA }, select: { isActive: true } });
    expect(a?.isActive).toBe(true);

    await prisma.userRoleAssignment.create({
      data: { userId: ids.adminB, roleId, companyId: netaId, grantedBy: 'itg752' } as any,
    });
  }, 60_000);

  it('assignment EXPIRÁVEL não conta: remover o perpétuo restante é bloqueado', async () => {
    await reativarTodos();
    // B vira admin "com prazo": não conta na invariante
    await prisma.userRoleAssignment.updateMany({
      where: { userId: ids.adminB, roleId },
      data: { expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await expect(
      service.executarProtegido(netaId, async (tx) => {
        await tx.userRoleAssignment.deleteMany({ where: { userId: ids.adminA, roleId } });
      }),
    ).rejects.toThrow(/administrador global/);

    await prisma.userRoleAssignment.updateMany({
      where: { userId: ids.adminB, roleId },
      data: { expiresAt: null },
    });
  }, 60_000);
});
