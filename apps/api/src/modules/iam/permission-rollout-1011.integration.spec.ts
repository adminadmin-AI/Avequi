import { spawnSync } from 'child_process';
import * as path from 'path';

import {
  executarRollout,
  reverterRollout,
  FASE_C2,
  FASE_C3,
  ROLLOUT_TRANSACTION_TIMEOUT_MS,
  ROLLOUT_TRANSACTION_MAX_WAIT_MS,
  Manifesto,
} from '../../../scripts/iam-permission-rollout';

// O jest.config mapeia '@prisma/client' para um mock global (unit tests nunca
// tocam banco) — e o mapper reescreve até o requireActual. AQUI o banco real é
// o ponto: carrega o client verdadeiro pelo caminho físico do pacote, que o
// padrão `^@prisma/client$` não captura. Mesmo recurso usado pelo spec de
// integração da #937, ao lado.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = jest.requireActual('../../../../../node_modules/@prisma/client');
type PrismaClient = import('@prisma/client').PrismaClient;

/**
 * #1011 — prova do rollout de permissões contra PostgreSQL DE VERDADE.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 * O spec ao lado (`permission-rollout-1011.spec.ts`) prova a LÓGICA do comando
 * com um Prisma falso em memória. Ele é rápido e cobre 39 casos, mas há uma
 * classe inteira de coisa que um objeto falso não consegue provar, porque ele
 * devolve exatamente o que mandamos devolver:
 *
 *   1. a TRANSAÇÃO é real? Se o comando falhar no meio, o Postgres realmente
 *      desfaz as permissões já criadas — ou fica metade aplicada?
 *   2. a segunda execução esbarra em UNIQUE constraint de verdade
 *      (`Permission.code`, `RolePermission(roleId, permissionId)`)?
 *   3. o `upsert` por code encontra a permissão já existente no banco?
 *   4. a herança lida do banco (parentId → parentId) confere com a cadeia que
 *      o catálogo declara?
 *   5. o rollback, com IDs reais de linhas reais, remove SÓ o que criou?
 *   6. o comando, rodado como COMANDO (processo separado, Prisma verdadeiro),
 *      recusa host remoto antes de escrever a primeira linha?
 *
 * Nada disso é hipotético: o rollout é um comando de ESCRITA em perfis de
 * produção. A #1011 é a issue que trava a release 1.41.0 — o custo de um bug
 * aqui é gestor sem enxergar comissão e ninguém conseguindo revogar sessão.
 *
 * ── Onde ele roda ─────────────────────────────────────────────────────────
 * No PostgreSQL DESCARTÁVEL que o job de teste já sobe desde a #937
 * (`postgres:16-alpine` como service do job, schema aplicado com
 * `prisma db push`, morre junto com o job). Nenhum banco novo, nenhum software
 * instalado na máquina de ninguém, ZERO contato com staging, produção ou
 * Supabase.
 *
 * Fora do CI, sem `TEST_DATABASE_URL`, a suíte é PULADA — quem não tem
 * Postgres à mão continua rodando o resto normalmente. Dentro do CI a ausência
 * da variável é ERRO, não motivo para pular: verde por falta de prova é o
 * cenário que a #937 foi aberta para eliminar.
 *
 * COMO RODAR LOCALMENTE (Postgres descartável, NUNCA o banco da empresa):
 *
 *   DATABASE_URL=postgresql://u:p@localhost:5433/itg1011 \
 *     npx prisma db push --schema apps/api/prisma/schema.prisma
 *   TEST_DATABASE_URL=postgresql://u:p@localhost:5433/itg1011 \
 *     npx jest permission-rollout-1011.integration --runInBand
 *
 * ── O que este spec NÃO faz ───────────────────────────────────────────────
 * Não executa a Fase A nem a Fase B em ambiente nenhum que não seja este banco
 * efêmero. A execução real continua dependendo de autorização separada do
 * Rafael. Rodar o script aqui é TESTE, não rollout.
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
  return ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'postgres', 'db'].includes(host);
}

if (url && !urlEhDescartavel(url)) {
  throw new Error(
    '[#1011] TEST_DATABASE_URL aponta para um host REMOTO. Esta suíte CRIA e APAGA ' +
      'perfis e permissões: use um PostgreSQL descartável local (localhost/127.0.0.1/' +
      'serviço de CI). Rollout de verdade não se testa em banco de gente.',
  );
}

if (!url && process.env.CI) {
  throw new Error(
    '[#1011/#937] TEST_DATABASE_URL ausente no CI. A prova do rollout contra banco ' +
      'real é obrigatória em todo PR — o job de teste sobe um PostgreSQL de serviço e ' +
      'exporta esta variável. Se este erro apareceu, o encanamento quebrou (serviço, ' +
      'workflow ou `env` do turbo) e o comando que vai mexer nos perfis deixou de ser ' +
      'verificado contra banco de verdade.',
  );
}

if (!url) {
  // eslint-disable-next-line no-console
  console.warn(
    '[#1011] Testes de rollout em Postgres PULADOS: defina TEST_DATABASE_URL com um ' +
      'PostgreSQL descartável (ver cabeçalho do arquivo).',
  );
}

/**
 * Trava entre os specs de INTEGRAÇÃO do IAM.
 *
 * Os dois specs de integração compartilham UM banco e ambos criam perfis
 * GLOBAIS (`companyId = null`) com os mesmos codes — `ADMIN_GLOBAL` aparece nos
 * dois. O índice parcial que garante unicidade de code global mora numa
 * migration em SQL puro, e o `prisma db push` do CI aplica o SCHEMA, não as
 * migrations: no banco do job, dois `ADMIN_GLOBAL` globais podem coexistir. Se
 * os dois specs rodarem em paralelo (o Jest distribui ARQUIVOS entre workers),
 * o rollout pode enxergar o `ADMIN_GLOBAL` do outro spec, pendurar o vínculo
 * nele e ver esse vínculo sumir quando o outro spec limpa o que criou — teste
 * intermitente, do tipo que se culpa "o CI" e se ignora.
 *
 * A trava é um advisory lock do próprio Postgres: quem chegar depois espera.
 * Ela vive num client dedicado com UMA conexão, porque advisory lock de sessão
 * mora na CONEXÃO — num pool, travar e destravar poderiam cair em conexões
 * diferentes.
 */
const CHAVE_DA_TRAVA = 1011;

function urlComUmaConexao(u: string): string {
  const parsed = new URL(u);
  parsed.searchParams.set('connection_limit', '1');
  return parsed.toString();
}

/**
 * `pg_try_advisory_lock` e não `pg_advisory_lock` por um detalhe do Prisma:
 * a versão bloqueante devolve `void`, e o client não consegue desserializar
 * coluna desse tipo. A versão "try" devolve booleano — e de quebra dá o que a
 * bloqueante não daria: um limite de espera com mensagem explicando o que
 * aconteceu, em vez de um job pendurado até o timeout do GitHub.
 */
async function travarBanco(cliente: PrismaClient): Promise<void> {
  const limite = Date.now() + 240_000;
  for (;;) {
    const [linha] = await cliente.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT pg_try_advisory_lock(${CHAVE_DA_TRAVA}) AS ok`,
    );
    if (linha?.ok) return;
    if (Date.now() > limite) {
      throw new Error(
        `[#1011] esperei 4 minutos pela trava ${CHAVE_DA_TRAVA} dos specs de integração ` +
          `do IAM e ela não foi liberada. Provável spec anterior que morreu sem soltar.`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function destravarBanco(cliente: PrismaClient): Promise<void> {
  await cliente.$queryRawUnsafe(`SELECT pg_advisory_unlock(${CHAVE_DA_TRAVA}) AS ok`);
}

const d = url ? describe : describe.skip;

d('#1011 — rollout de permissões em PostgreSQL real', () => {
  let prisma: PrismaClient;
  let trava: PrismaClient;

  /** Perfis SYSTEM criados por este spec: code → id. */
  const perfis = new Map<string, string>();
  /** Ids de tudo que este spec criou, para a limpeza do final. */
  let empresaComElegivelId: string;
  let empresaSemElegivelId: string;
  let perfilCustomizadoId: string;
  let permissaoAlheiaId: string;
  let vinculoManualEmPerfilSystemId: string;
  let vinculoDoPerfilCustomizadoId: string;
  let revokeAnyId: string;
  let vinculoPreexistenteId: string;

  const CODE_VIEW_ALL = 'sales.commissions.view-all';
  const CODE_REVOKE_ANY = 'iam.sessions.revoke-any';
  const CODE_ASSIGNABLE = 'crm.leads.assignable';
  const CODE_ALHEIA = 'itg1011.alheia.ping';
  /** Nome ANTIGO da permissão que já existe — prova que o upsert atualiza. */
  const NOME_ANTIGO = 'Nome antigo (itg1011)';

  /** Perfis que o rollout precisa encontrar, na união das duas fases. */
  const PERFIS_C2 = FASE_C2[0].roles; // os 11 aprovados para view-all
  const PERFIS_DIRETOS_C3 = FASE_C3[0].roles; // os 5 diretos
  const TODOS_OS_PERFIS = [
    ...new Set([...FASE_C2.flatMap((a) => a.roles), ...PERFIS_DIRETOS_C3, 'LOJA_FATURAMENTO']),
  ];

  const usuarios = {
    vendedorAtivo: 'itg1011-u-vendedor-ativo',
    vendedorIndisponivel: 'itg1011-u-vendedor-indisponivel',
    vendedorExpirado: 'itg1011-u-vendedor-expirado',
    vendedorInativo: 'itg1011-u-vendedor-inativo',
    comDeny: 'itg1011-u-deny',
    comGrant: 'itg1011-u-grant',
  };

  const perfilId = (code: string) => perfis.get(code) as string;

  // ── Fixtures ──────────────────────────────────────────────────────────────

  beforeAll(async () => {
    trava = new PrismaClient({ datasources: { db: { url: urlComUmaConexao(url as string) } } });
    await travarBanco(trava);

    prisma = new PrismaClient({ datasources: { db: { url } } });

    const carimbo = `itg1011-${Date.now()}`;

    const comElegivel = await prisma.company.create({
      data: { name: 'ITG1011 Loja com vendedor', cnpj: `${carimbo}-a` } as any,
    });
    empresaComElegivelId = comElegivel.id;
    const semElegivel = await prisma.company.create({
      data: { name: 'ITG1011 Loja sem vendedor', cnpj: `${carimbo}-b` } as any,
    });
    empresaSemElegivelId = semElegivel.id;

    // Perfis SYSTEM (companyId null) — é neles que o rollout mexe.
    for (const code of TODOS_OS_PERFIS) {
      const r = await prisma.role.create({
        data: { code, name: `${code} (itg1011)`, isSystem: true, isActive: true } as any,
      });
      perfis.set(code, r.id);
    }
    // Cadeia declarada no catálogo: LOJA_OPERACIONAL → LOJA_FATURAMENTO →
    // GERENTE_LOJA. É por ela que LOJA_FATURAMENTO recebe a elegibilidade sem
    // vínculo direto.
    await prisma.role.update({
      where: { id: perfilId('LOJA_FATURAMENTO') },
      data: { parentId: perfilId('LOJA_OPERACIONAL') },
    });
    await prisma.role.update({
      where: { id: perfilId('GERENTE_LOJA') },
      data: { parentId: perfilId('LOJA_FATURAMENTO') },
    });

    // A trava acima garante que o outro spec de integração não está no ar; se
    // ainda assim houver DOIS perfis globais com o mesmo code, é resíduo de uma
    // execução anterior que morreu no meio — melhor falhar aqui, com o nome do
    // perfil, do que ver o rollout pendurar vínculo no perfil errado e o teste
    // "piscar" sem explicação.
    for (const code of TODOS_OS_PERFIS) {
      const quantos = await prisma.role.count({
        where: { code, companyId: null, isSystem: true },
      });
      if (quantos !== 1) {
        throw new Error(
          `[#1011] esperava exatamente 1 perfil global "${code}" no banco de teste, ` +
            `encontrei ${quantos}. Banco sujo de execução anterior — recrie o Postgres ` +
            `descartável antes de rodar a suíte.`,
        );
      }
    }

    // Perfil CUSTOMIZADO de empresa, com o MESMO code de um perfil system.
    // O rollout filtra por companyId null + isSystem: este aqui não pode ser
    // tocado em hipótese nenhuma.
    const custom = await prisma.role.create({
      data: {
        code: 'GERENTE_LOJA',
        name: 'Gerente de loja (perfil da empresa, itg1011)',
        isSystem: false,
        isActive: true,
        companyId: empresaComElegivelId,
      } as any,
    });
    perfilCustomizadoId = custom.id;

    // Permissão sem relação nenhuma com o rollout, vinculada a um perfil
    // SYSTEM (o caso da #889: concessão feita à mão no banco) e ao perfil
    // customizado. O seed completo apagaria as duas; o rollout não pode.
    const alheia = await prisma.permission.create({
      data: {
        code: CODE_ALHEIA,
        name: 'Permissão alheia (itg1011)',
        description: 'Existe só para provar que o rollout não reconcilia catálogo',
        module: 'itg1011',
        resource: 'alheia',
        action: 'ping',
      } as any,
    });
    permissaoAlheiaId = alheia.id;
    vinculoManualEmPerfilSystemId = (
      await prisma.rolePermission.create({
        data: { roleId: perfilId('ADMIN_EMPRESA'), permissionId: alheia.id, granted: true } as any,
      })
    ).id;
    vinculoDoPerfilCustomizadoId = (
      await prisma.rolePermission.create({
        data: { roleId: perfilCustomizadoId, permissionId: alheia.id, granted: true } as any,
      })
    ).id;

    // Usuários e vínculos de perfil.
    const criarUsuario = async (id: string, companyId: string, extra: Record<string, unknown>) =>
      prisma.user.create({
        data: {
          id,
          email: `${id}@itg1011.test`,
          name: id,
          passwordHash: 'x',
          role: 'READER',
          companyId,
          isActive: true,
          ...extra,
        } as any,
      });

    await criarUsuario(usuarios.vendedorAtivo, empresaComElegivelId, { crmAvailable: true });
    await criarUsuario(usuarios.vendedorIndisponivel, empresaComElegivelId, {
      crmAvailable: false,
    });
    await criarUsuario(usuarios.vendedorExpirado, empresaComElegivelId, { crmAvailable: true });
    await criarUsuario(usuarios.vendedorInativo, empresaSemElegivelId, {
      crmAvailable: true,
      isActive: false,
    });
    await criarUsuario(usuarios.comDeny, empresaComElegivelId, {});
    await criarUsuario(usuarios.comGrant, empresaComElegivelId, {});

    const atribuir = async (
      userId: string,
      code: string,
      companyId: string,
      expiresAt: Date | null = null,
    ) =>
      prisma.userRoleAssignment.create({
        data: {
          userId,
          roleId: perfilId(code),
          companyId,
          grantedBy: 'itg1011',
          expiresAt,
        } as any,
      });

    await atribuir(usuarios.vendedorAtivo, 'VENDEDOR', empresaComElegivelId);
    await atribuir(usuarios.vendedorIndisponivel, 'VENDEDOR', empresaComElegivelId);
    // Vínculo VENCIDO: existe, mas já expirou.
    await atribuir(
      usuarios.vendedorExpirado,
      'LOJA_OPERACIONAL',
      empresaComElegivelId,
      new Date(Date.now() - 86_400_000),
    );
    // A empresa B tem UM vendedor, e ele está INATIVO — é ela que aparece no
    // relatório como empresa que ficaria sem ninguém para receber lead.
    await atribuir(usuarios.vendedorInativo, 'VENDEDOR', empresaSemElegivelId);
    await atribuir(usuarios.comDeny, 'AUDITOR', empresaComElegivelId);
    await atribuir(usuarios.comGrant, 'FINANCEIRO', empresaComElegivelId);

    await garantirBaseline();
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      const codes = [CODE_VIEW_ALL, CODE_REVOKE_ANY, CODE_ASSIGNABLE, CODE_ALHEIA];
      const permissoes = await prisma.permission.findMany({
        where: { code: { in: codes } },
        select: { id: true },
      });
      const permIds = permissoes.map((p) => p.id);
      const roleIds = [...perfis.values(), perfilCustomizadoId].filter(Boolean);

      await prisma.userPermission.deleteMany({ where: { permissionId: { in: permIds } } });
      await prisma.rolePermission.deleteMany({ where: { permissionId: { in: permIds } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
      await prisma.permission.deleteMany({ where: { id: { in: permIds } } });
      await prisma.userRoleAssignment.deleteMany({
        where: { userId: { in: Object.values(usuarios) } },
      });
      await prisma.user.deleteMany({ where: { id: { in: Object.values(usuarios) } } });
      // parentId primeiro: a hierarquia é FK sem cascade e travaria o delete.
      await prisma.role.updateMany({ where: { id: { in: roleIds } }, data: { parentId: null } });
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
      for (const id of [empresaComElegivelId, empresaSemElegivelId]) {
        if (id) await prisma.company.delete({ where: { id } }).catch(() => undefined);
      }
      await prisma.$disconnect();
    }
    if (trava) {
      await destravarBanco(trava);
      await trava.$disconnect();
    }
  }, 180_000);

  // ── Utilitários do spec ───────────────────────────────────────────────────

  /**
   * Repõe o estado ANTERIOR ao rollout:
   *  - as duas permissões que o comando CRIA não existem;
   *  - `iam.sessions.revoke-any` JÁ existe, com o nome antigo, e tem UM vínculo
   *    preexistente (ADMIN_GLOBAL) — cenário realista, porque a permissão pode
   *    ter sido criada à mão antes;
   *  - os overrides individuais (um deny e um grant) estão de pé.
   */
  async function garantirBaseline() {
    for (const code of [CODE_VIEW_ALL, CODE_ASSIGNABLE]) {
      const p = await prisma.permission.findUnique({ where: { code } });
      if (!p) continue;
      await prisma.userPermission.deleteMany({ where: { permissionId: p.id } });
      await prisma.rolePermission.deleteMany({ where: { permissionId: p.id } });
      await prisma.permission.delete({ where: { id: p.id } });
    }

    let rev = await prisma.permission.findUnique({ where: { code: CODE_REVOKE_ANY } });
    if (!rev) {
      rev = await prisma.permission.create({
        data: {
          code: CODE_REVOKE_ANY,
          name: NOME_ANTIGO,
          description: 'Descrição antiga (itg1011)',
          module: 'iam',
          resource: 'sessions',
          action: 'revoke-any',
        } as any,
      });
    } else {
      await prisma.permission.update({
        where: { id: rev.id },
        data: { name: NOME_ANTIGO, description: 'Descrição antiga (itg1011)' },
      });
    }
    revokeAnyId = rev.id;

    await prisma.rolePermission.deleteMany({
      where: { permissionId: rev.id, roleId: { not: perfilId('ADMIN_GLOBAL') } },
    });
    const link = await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: perfilId('ADMIN_GLOBAL'), permissionId: rev.id },
      },
      create: { roleId: perfilId('ADMIN_GLOBAL'), permissionId: rev.id, granted: true } as any,
      update: {},
    });
    vinculoPreexistenteId = link.id;

    for (const [userId, granted] of [
      [usuarios.comDeny, false],
      [usuarios.comGrant, true],
    ] as Array<[string, boolean]>) {
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId_companyId: {
            userId,
            permissionId: rev.id,
            companyId: empresaComElegivelId,
          },
        },
        create: {
          userId,
          permissionId: rev.id,
          companyId: empresaComElegivelId,
          granted,
          grantedBy: 'itg1011',
        } as any,
        update: { granted },
      });
    }
  }

  /** Retrato do que NÃO pode mudar, para comparar antes × depois. */
  async function retrato() {
    const [permissoes, vinculos, overrides, atribuicoes] = await Promise.all([
      prisma.permission.count(),
      prisma.rolePermission.count(),
      prisma.userPermission.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, permissionId: true, granted: true },
      }),
      prisma.userRoleAssignment.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, roleId: true, expiresAt: true },
      }),
    ]);
    return { permissoes, vinculos, overrides, atribuicoes };
  }

  /** Perfis (codes) que têm vínculo direto com a permissão. */
  async function perfisComVinculo(code: string): Promise<string[]> {
    const p = await prisma.permission.findUnique({ where: { code } });
    if (!p) return [];
    const vinculos = await prisma.rolePermission.findMany({
      where: { permissionId: p.id },
      select: { roleId: true },
    });
    const codes = await prisma.role.findMany({
      where: { id: { in: vinculos.map((v) => v.roleId) } },
      select: { code: true, companyId: true, isSystem: true },
    });
    return codes.map((r) => `${r.code}${r.companyId ? '@empresa' : ''}`).sort();
  }

  /** Sobe a hierarquia a partir de um perfil e diz se a permissão chega nele. */
  async function herdaPermissao(codePerfil: string, codePermissao: string): Promise<boolean> {
    const permissao = await prisma.permission.findUnique({ where: { code: codePermissao } });
    if (!permissao) return false;
    let atual: { id: string; parentId: string | null } | null = await prisma.role.findFirst({
      where: { code: codePerfil, companyId: null, isSystem: true },
      select: { id: true, parentId: true },
    });
    while (atual) {
      const tem = await prisma.rolePermission.count({
        where: { roleId: atual.id, permissionId: permissao.id, granted: true },
      });
      if (tem > 0) return true;
      atual = atual.parentId
        ? await prisma.role.findUnique({
            where: { id: atual.parentId },
            select: { id: true, parentId: true },
          })
        : null;
    }
    return false;
  }

  /**
   * Client que estoura DENTRO da transação, depois de N vínculos criados.
   *
   * É o único jeito honesto de provar que a transação é real: nenhuma asserção
   * sobre "o código chama $transaction" prova que o Postgres desfaz o que já
   * tinha sido escrito. Aqui a falha acontece com permissões já criadas e o
   * teste confere que elas SUMIRAM.
   */
  function clienteQueFalhaNoVinculo(base: PrismaClient, apos: number): PrismaClient {
    const embrulhar = (alvo: any, sobrescrever: Record<string, unknown>) =>
      new Proxy(alvo, {
        get(t, p) {
          if (p in sobrescrever) return (sobrescrever as any)[p];
          const v = Reflect.get(t, p);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });

    return new Proxy(base as any, {
      get(alvo, prop) {
        if (prop === '$transaction') {
          return (fn: any) =>
            (alvo as any).$transaction(async (tx: any) => {
              let criados = 0;
              const txEmbrulhada = new Proxy(tx, {
                get(t, p) {
                  if (p === 'rolePermission') {
                    const delegate = Reflect.get(t, p);
                    return embrulhar(delegate, {
                      create: async (args: any) => {
                        if (++criados > apos) {
                          throw new Error('falha induzida no vínculo (teste #1011)');
                        }
                        return delegate.create(args);
                      },
                    });
                  }
                  const v = Reflect.get(t, p);
                  return typeof v === 'function' ? v.bind(t) : v;
                },
              });
              return fn(txEmbrulhada);
            });
        }
        const v = Reflect.get(alvo, prop);
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    }) as PrismaClient;
  }

  // ── Fase A (C2) ───────────────────────────────────────────────────────────

  describe('Fase A (c2) — o que destrava a release 1.41.0', () => {
    let manifesto: Manifesto;

    beforeAll(async () => {
      await garantirBaseline();
    }, 120_000);

    it('DRY-RUN não escreve nada e relata exatamente o que faria', async () => {
      const antes = await retrato();

      const rel = await executarRollout(prisma, 'c2', { dryRun: true });

      const depois = await retrato();
      expect(depois).toEqual(antes); // ZERO escrita — nem uma linha

      expect(rel.permissoesAusentes).toEqual([CODE_VIEW_ALL]);
      expect(rel.permissoesExistentes).toEqual([CODE_REVOKE_ANY]);
      expect(rel.perfisObrigatoriosAusentes).toEqual([]);
      for (const code of PERFIS_C2) expect(rel.perfisEncontrados).toContain(code);

      // As associações previstas são EXATAMENTE as aprovadas — nada além.
      const previstas = [...rel.vinculosACriar, ...rel.vinculosExistentes]
        .map((v) => `${v.roleCode}:${v.permissionCode}`)
        .sort();
      const aprovadas = FASE_C2.flatMap((a) => a.roles.map((r) => `${r}:${a.code}`)).sort();
      expect(previstas).toEqual(aprovadas);

      // O vínculo que JÁ existia aparece como existente, não como a criar.
      expect(rel.vinculosExistentes).toEqual([
        { roleCode: 'ADMIN_GLOBAL', permissionCode: CODE_REVOKE_ANY },
      ]);
      expect(rel.vinculosACriar).toHaveLength(12); // 11 + 1

      // Nada não relacionado entra na conversa — nem para criar, nem para tirar.
      const mencionadas = JSON.stringify(rel);
      expect(mencionadas).not.toContain(CODE_ALHEIA);
      expect(mencionadas).not.toContain(perfilCustomizadoId);

      // Overrides individuais são CONTADOS, nunca alterados nem identificados.
      expect(rel.usuariosComDenyIndividual).toBe(1);
      expect(rel.usuariosComGrantIndividual).toBe(1);
      expect(mencionadas).not.toContain('@itg1011.test');
    }, 120_000);

    it('APLICA: 11 vínculos de view-all, 2 de revoke-any, e nada mais muda', async () => {
      const antes = await retrato();

      const rel = await executarRollout(prisma, 'c2', { execucaoId: 'itg1011-fase-a' });
      manifesto = rel.manifesto as Manifesto;
      expect(manifesto).toBeDefined();

      // As duas permissões existem, com o texto novo (upsert atualizou a antiga)
      const viewAll = await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } });
      const revoke = await prisma.permission.findUnique({ where: { code: CODE_REVOKE_ANY } });
      expect(viewAll).toBeTruthy();
      expect(revoke?.id).toBe(revokeAnyId); // a MESMA linha, não uma recriação
      expect(revoke?.name).not.toBe(NOME_ANTIGO);
      expect(viewAll?.module).toBe('sales');

      // Contagem exata de vínculos
      expect(await perfisComVinculo(CODE_VIEW_ALL)).toEqual([...PERFIS_C2].sort());
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(
        ['ADMIN_GLOBAL', 'ADMIN_EMPRESA'].sort(),
      );

      // ADMIN_FILIAL vê comissão, mas NÃO revoga sessão de terceiro
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).not.toContain('ADMIN_FILIAL');
      expect(await perfisComVinculo(CODE_VIEW_ALL)).toContain('ADMIN_FILIAL');

      // Perfil CUSTOMIZADO da empresa intocado — mesmo tendo o mesmo code
      const doCustom = await prisma.rolePermission.findMany({
        where: { roleId: perfilCustomizadoId },
        select: { id: true, permissionId: true },
      });
      expect(doCustom).toEqual([
        { id: vinculoDoPerfilCustomizadoId, permissionId: permissaoAlheiaId },
      ]);

      // Vínculo manual em perfil SYSTEM (o caso da #889) continua lá
      expect(
        await prisma.rolePermission.count({ where: { id: vinculoManualEmPerfilSystemId } }),
      ).toBe(1);

      // Overrides individuais e atribuições de usuário: idênticos
      const depois = await retrato();
      expect(depois.overrides).toEqual(antes.overrides);
      expect(depois.atribuicoes).toEqual(antes.atribuicoes);
      // Só UMA permissão nova (a outra já existia) e 12 vínculos novos
      expect(depois.permissoes).toBe(antes.permissoes + 1);
      expect(depois.vinculos).toBe(antes.vinculos + 12);

      // O manifesto guarda o que dá para desfazer, e só identificadores técnicos
      expect(manifesto.permissoesCriadas).toEqual([CODE_VIEW_ALL]);
      expect(manifesto.vinculosCriados).toHaveLength(12);
      expect(JSON.stringify(manifesto)).not.toContain('@itg1011.test');
    }, 120_000);

    it('SEGUNDA execução: zero permissões, zero vínculos, nenhum erro de UNIQUE', async () => {
      const antes = await retrato();

      const rel = await executarRollout(prisma, 'c2', { execucaoId: 'itg1011-fase-a-2' });

      expect(rel.vinculosACriar).toEqual([]);
      expect(rel.vinculosExistentes).toHaveLength(13);
      expect(rel.permissoesAusentes).toEqual([]);
      expect(rel.manifesto?.permissoesCriadas).toEqual([]);
      expect(rel.manifesto?.vinculosCriados).toEqual([]);

      expect(await retrato()).toEqual(antes); // nada observável mudou
    }, 120_000);

    it('ROLLBACK: desfaz só o que criou — e não apaga permissão que ganhou uso novo', async () => {
      // Alguém associa a permissão recém-criada a OUTRO perfil (aqui, o perfil
      // customizado da empresa) DEPOIS do rollout. O rollback tem de remover os
      // vínculos dele e deixar a permissão de pé: ela já é usada por terceiros.
      const viewAll = await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } });
      const usoExterno = await prisma.rolePermission.create({
        data: {
          roleId: perfilCustomizadoId,
          permissionId: (viewAll as any).id,
          granted: true,
        } as any,
      });

      const r = await reverterRollout(prisma, manifesto);
      expect(r.vinculosRemovidos).toBe(12);
      expect(r.permissoesRemovidas).toEqual([]); // sobreviveu: tem uso externo

      // O vínculo PREEXISTENTE (ADMIN_GLOBAL → revoke-any) continua de pé
      expect(await prisma.rolePermission.count({ where: { id: vinculoPreexistenteId } })).toBe(1);
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(['ADMIN_GLOBAL']);
      expect(await perfisComVinculo(CODE_VIEW_ALL)).toEqual(['GERENTE_LOJA@empresa']);

      // Overrides, atribuições e o vínculo manual seguem intactos
      expect(await prisma.userPermission.count({ where: { permissionId: revokeAnyId } })).toBe(2);
      expect(
        await prisma.userRoleAssignment.count({ where: { userId: { in: Object.values(usuarios) } } }),
      ).toBe(6);
      expect(
        await prisma.rolePermission.count({ where: { id: vinculoManualEmPerfilSystemId } }),
      ).toBe(1);

      // Repetir o rollback é seguro: não há mais nada dele para tirar.
      const r2 = await reverterRollout(prisma, manifesto);
      expect(r2.vinculosRemovidos).toBe(0);
      expect(r2.permissoesRemovidas).toEqual([]);

      // Retirado o uso externo, um novo rollback finalmente apaga a permissão
      // órfã — e só ela.
      await prisma.rolePermission.delete({ where: { id: usoExterno.id } });
      const r3 = await reverterRollout(prisma, manifesto);
      expect(r3.permissoesRemovidas).toEqual([CODE_VIEW_ALL]);
      expect(await prisma.permission.findUnique({ where: { code: CODE_REVOKE_ANY } })).toBeTruthy();
      expect(await prisma.permission.findUnique({ where: { code: CODE_ALHEIA } })).toBeTruthy();
    }, 120_000);
  });

  // ── Falha no meio do caminho ──────────────────────────────────────────────

  describe('falha transacional — metade aplicada é pior que nada', () => {
    beforeAll(async () => {
      await garantirBaseline();
    }, 120_000);

    it('estouro DENTRO da transação: o Postgres desfaz as permissões já criadas', async () => {
      const antes = await retrato();

      await expect(
        executarRollout(clienteQueFalhaNoVinculo(prisma, 5), 'c2'),
      ).rejects.toThrow(/falha induzida/);

      // A permissão nova chegou a ser criada dentro da transação e VOLTOU
      expect(await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } })).toBeNull();
      // E o upsert da permissão que já existia também foi desfeito: o texto
      // voltou a ser o antigo.
      const revoke = await prisma.permission.findUnique({ where: { code: CODE_REVOKE_ANY } });
      expect(revoke?.name).toBe(NOME_ANTIGO);
      expect(await retrato()).toEqual(antes);
    }, 120_000);

    it('perfil obrigatório ausente: aborta ANTES de escrever qualquer coisa', async () => {
      const antes = await retrato();
      const diretorId = perfilId('DIRETOR');
      await prisma.role.delete({ where: { id: diretorId } });

      try {
        await expect(executarRollout(prisma, 'c2')).rejects.toThrow(/perfis obrigatórios ausentes/);
        expect(await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } })).toBeNull();
        expect(await retrato()).toEqual(antes);
      } finally {
        const novo = await prisma.role.create({
          data: { code: 'DIRETOR', name: 'DIRETOR (itg1011)', isSystem: true, isActive: true } as any,
        });
        perfis.set('DIRETOR', novo.id);
      }
    }, 120_000);
  });

  // ── Fase B (C3) ───────────────────────────────────────────────────────────

  describe('Fase B (c3) — elegibilidade de vendedor', () => {
    let manifesto: Manifesto;

    beforeAll(async () => {
      await garantirBaseline();
    }, 120_000);

    it('DRY-RUN: cadeia de herança conferida, empresa sem elegível denunciada, zero escrita', async () => {
      const antes = await retrato();

      const rel = await executarRollout(prisma, 'c3', { dryRun: true });

      expect(await retrato()).toEqual(antes);
      expect(rel.permissoesAusentes).toEqual([CODE_ASSIGNABLE]);
      expect(rel.perfisObrigatoriosAusentes).toEqual([]);
      expect(rel.vinculosACriar.map((v) => v.roleCode).sort()).toEqual([...PERFIS_DIRETOS_C3].sort());
      expect(rel.heranca).toEqual([
        { role: 'LOJA_FATURAMENTO', via: 'LOJA_OPERACIONAL', cadeiaOk: true },
      ]);

      // A empresa cujo único vendedor está INATIVO ficaria sem ninguém para
      // receber lead — é exatamente o que a Fase B existe para não deixar passar.
      expect(rel.empresasSemElegivel).toContain(empresaSemElegivelId);
      expect(rel.empresasSemElegivel).not.toContain(empresaComElegivelId);
    }, 120_000);

    it('APLICA: cinco vínculos diretos, LOJA_FATURAMENTO só por herança, admin nenhum', async () => {
      const antes = await retrato();

      const rel = await executarRollout(prisma, 'c3', { execucaoId: 'itg1011-fase-b' });
      manifesto = rel.manifesto as Manifesto;

      expect(await perfisComVinculo(CODE_ASSIGNABLE)).toEqual([...PERFIS_DIRETOS_C3].sort());
      expect(await perfisComVinculo(CODE_ASSIGNABLE)).not.toContain('LOJA_FATURAMENTO');

      // Mas a permissão CHEGA nele pela cadeia — herança efetiva, sem resíduo
      expect(await herdaPermissao('LOJA_FATURAMENTO', CODE_ASSIGNABLE)).toBe(true);
      expect(await herdaPermissao('ADMIN_GLOBAL', CODE_ASSIGNABLE)).toBe(false);
      expect(await herdaPermissao('ADMIN_EMPRESA', CODE_ASSIGNABLE)).toBe(false);

      const depois = await retrato();
      expect(depois.overrides).toEqual(antes.overrides);
      expect(depois.atribuicoes).toEqual(antes.atribuicoes);
      expect(depois.vinculos).toBe(antes.vinculos + 5);
      expect(manifesto.vinculosCriados).toHaveLength(5);
    }, 120_000);

    it('SEGUNDA execução não muda nada', async () => {
      const antes = await retrato();
      const rel = await executarRollout(prisma, 'c3', { execucaoId: 'itg1011-fase-b-2' });
      expect(rel.vinculosACriar).toEqual([]);
      expect(rel.manifesto?.vinculosCriados).toEqual([]);
      expect(await retrato()).toEqual(antes);
    }, 120_000);

    it('ROLLBACK devolve o banco ao estado anterior, sem tocar em mais nada', async () => {
      const r = await reverterRollout(prisma, manifesto);
      expect(r.vinculosRemovidos).toBe(5);
      expect(r.permissoesRemovidas).toEqual([CODE_ASSIGNABLE]);

      expect(await prisma.permission.findUnique({ where: { code: CODE_ASSIGNABLE } })).toBeNull();
      expect(await prisma.rolePermission.count({ where: { id: vinculoPreexistenteId } })).toBe(1);
      expect(await prisma.userPermission.count({ where: { permissionId: revokeAnyId } })).toBe(2);
      expect(
        await prisma.userRoleAssignment.count({ where: { userId: { in: Object.values(usuarios) } } }),
      ).toBe(6);
    }, 120_000);

    it('cadeia de herança divergente ABORTA e não deixa nada pela metade', async () => {
      const antes = await retrato();
      await prisma.role.update({
        where: { id: perfilId('LOJA_FATURAMENTO') },
        data: { parentId: null },
      });

      try {
        await expect(executarRollout(prisma, 'c3')).rejects.toThrow(/herança divergente/);
        expect(await prisma.permission.findUnique({ where: { code: CODE_ASSIGNABLE } })).toBeNull();
        expect(await retrato()).toEqual(antes);
      } finally {
        await prisma.role.update({
          where: { id: perfilId('LOJA_FATURAMENTO') },
          data: { parentId: perfilId('LOJA_OPERACIONAL') },
        });
      }
    }, 120_000);
  });

  // ── phase=all ─────────────────────────────────────────────────────────────

  describe('--phase=all — as duas fases ou nenhuma', () => {
    beforeAll(async () => {
      await garantirBaseline();
    }, 120_000);

    it('C2 inteira válida + C3 sem perfil obrigatório: NADA das duas é persistido', async () => {
      const antes = await retrato();
      const vendedorId = perfilId('VENDEDOR');
      await prisma.userRoleAssignment.deleteMany({ where: { roleId: vendedorId } });
      await prisma.role.delete({ where: { id: vendedorId } });

      try {
        await expect(executarRollout(prisma, 'all')).rejects.toThrow(/perfis obrigatórios ausentes/);
        expect(await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } })).toBeNull();
        expect(await prisma.permission.findUnique({ where: { code: CODE_ASSIGNABLE } })).toBeNull();
        expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(['ADMIN_GLOBAL']);
      } finally {
        const novo = await prisma.role.create({
          data: {
            code: 'VENDEDOR',
            name: 'VENDEDOR (itg1011)',
            isSystem: true,
            isActive: true,
          } as any,
        });
        perfis.set('VENDEDOR', novo.id);
        await prisma.userRoleAssignment.create({
          data: {
            userId: usuarios.vendedorAtivo,
            roleId: novo.id,
            companyId: empresaComElegivelId,
            grantedBy: 'itg1011',
          } as any,
        });
        await prisma.userRoleAssignment.create({
          data: {
            userId: usuarios.vendedorIndisponivel,
            roleId: novo.id,
            companyId: empresaComElegivelId,
            grantedBy: 'itg1011',
          } as any,
        });
        await prisma.userRoleAssignment.create({
          data: {
            userId: usuarios.vendedorInativo,
            roleId: novo.id,
            companyId: empresaSemElegivelId,
            grantedBy: 'itg1011',
          } as any,
        });
      }
      // o retrato de atribuições volta ao tamanho original
      expect((await retrato()).atribuicoes).toHaveLength(antes.atribuicoes.length);
    }, 120_000);

    it('com tudo no lugar, as duas fases entram juntas — e o rollback tira as duas', async () => {
      const rel = await executarRollout(prisma, 'all', { execucaoId: 'itg1011-all' });

      expect(await perfisComVinculo(CODE_VIEW_ALL)).toEqual([...PERFIS_C2].sort());
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(['ADMIN_GLOBAL', 'ADMIN_EMPRESA'].sort());
      expect(await perfisComVinculo(CODE_ASSIGNABLE)).toEqual([...PERFIS_DIRETOS_C3].sort());
      expect(rel.manifesto?.permissoesCriadas.sort()).toEqual([CODE_ASSIGNABLE, CODE_VIEW_ALL]);
      expect(rel.manifesto?.vinculosCriados).toHaveLength(17); // 11 + 1 + 5

      const r = await reverterRollout(prisma, rel.manifesto as Manifesto);
      expect(r.vinculosRemovidos).toBe(17);
      expect(r.permissoesRemovidas.sort()).toEqual([CODE_ASSIGNABLE, CODE_VIEW_ALL]);
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(['ADMIN_GLOBAL']);
    }, 120_000);
  });


  // ── Limites da transação (#1014) ──────────────────────────────────────────

  describe('transação longa — o que derrubou a Fase A no pooler', () => {
    /**
     * Reprodução do incidente de 05/08/2026, sem depender da internet.
     *
     * No banco real, cada ida-e-volta até o pooler custava ~1,05 s e as 15
     * escritas sequenciais da Fase A levavam ~15,8 s — contra o timeout PADRÃO
     * de 5 s da transação interativa do Prisma. A transação era encerrada no
     * meio e o comando morria com "Transaction not found".
     *
     * Aqui o atraso é injetado pelo teste, entre as escritas: mesma duração de
     * transação, zero dependência de latência externa. O que muda entre os dois
     * cenários abaixo é SÓ o limite — a carga é idêntica. É a prova de que o
     * problema era o limite, e de que o valor novo resolve.
     */
    const ATRASO_POR_ESCRITA_MS = 500; // 13 vínculos ≈ 6,5 s: passa dos 5 s, longe dos 120 s

    /** Client que segura a transação, medindo o que ela realmente durou. */
    function clienteLento(base: PrismaClient) {
      const visto: { opcoes?: { timeout?: number; maxWait?: number }; duracaoMs?: number } = {};

      const cliente = new Proxy(base as any, {
        get(alvo, prop) {
          if (prop === '$transaction') {
            return (fn: any, opcoes?: any) => {
              visto.opcoes = opcoes;
              const inicio = Date.now();
              return (alvo as any)
                .$transaction(async (tx: any) => {
                  const txLenta = new Proxy(tx, {
                    get(t, p) {
                      if (p === 'rolePermission') {
                        const delegate = Reflect.get(t, p);
                        return new Proxy(delegate, {
                          get(d, dp) {
                            if (dp === 'create') {
                              return async (args: any) => {
                                await new Promise((r) => setTimeout(r, ATRASO_POR_ESCRITA_MS));
                                return d.create(args);
                              };
                            }
                            const v = Reflect.get(d, dp);
                            return typeof v === 'function' ? v.bind(d) : v;
                          },
                        });
                      }
                      const v = Reflect.get(t, p);
                      return typeof v === 'function' ? v.bind(t) : v;
                    },
                  });
                  return fn(txLenta);
                }, opcoes)
                .finally(() => {
                  visto.duracaoMs = Date.now() - inicio;
                });
            };
          }
          const v = Reflect.get(alvo, prop);
          return typeof v === 'function' ? v.bind(alvo) : v;
        },
      }) as PrismaClient;

      return { cliente, visto };
    }

    beforeAll(async () => {
      await garantirBaseline();
    }, 120_000);

    it('com o limite NOVO: a transação passa dos 5 s, conclui e persiste os vínculos', async () => {
      const antes = await retrato();
      const { cliente, visto } = clienteLento(prisma);

      const rel = await executarRollout(cliente, 'c2', { execucaoId: 'itg1014-ok' });

      // O comando passou os limites explícitos — não o padrão do Prisma
      expect(visto.opcoes).toEqual({
        timeout: ROLLOUT_TRANSACTION_TIMEOUT_MS,
        maxWait: ROLLOUT_TRANSACTION_MAX_WAIT_MS,
      });
      // …e a transação de fato durou mais do que o antigo limite de 5 s
      expect(visto.duracaoMs).toBeGreaterThan(5_000);
      expect(visto.duracaoMs).toBeLessThan(30_000); // longe dos 120 s

      // Concluiu de verdade: os vínculos estão no banco
      expect(await perfisComVinculo(CODE_VIEW_ALL)).toEqual([...PERFIS_C2].sort());
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(
        ['ADMIN_GLOBAL', 'ADMIN_EMPRESA'].sort(),
      );
      const depois = await retrato();
      expect(depois.vinculos).toBe(antes.vinculos + 12);
      expect(depois.overrides).toEqual(antes.overrides);
      expect(depois.atribuicoes).toEqual(antes.atribuicoes);
      // O manifesto só existe porque a transação COMITOU
      expect(rel.manifesto?.vinculosCriados).toHaveLength(12);

      await reverterRollout(prisma, rel.manifesto as Manifesto);
      await garantirBaseline();
    }, 180_000);

    it('com o limite ANTIGO (5 s): a mesma carga falha e NADA fica pela metade', async () => {
      const antes = await retrato();
      const { cliente, visto } = clienteLento(prisma);

      // 5 s é exatamente o padrão do Prisma — o valor que derrubou a Fase A.
      await expect(
        executarRollout(cliente, 'c2', {
          execucaoId: 'itg1014-curto',
          transacao: { timeout: 5_000, maxWait: 20_000 },
        }),
      ).rejects.toThrow();

      expect(visto.opcoes).toEqual({ timeout: 5_000, maxWait: 20_000 });

      // Rollback integral, como no incidente real: nada persistiu
      expect(await prisma.permission.findUnique({ where: { code: CODE_VIEW_ALL } })).toBeNull();
      expect(await perfisComVinculo(CODE_REVOKE_ANY)).toEqual(['ADMIN_GLOBAL']);
      expect(await retrato()).toEqual(antes);
    }, 180_000);

    it('SEM RETRY: a falha por tempo sobe para quem chamou, sem segunda tentativa', async () => {
      const antes = await retrato();
      let transacoesAbertas = 0;

      const contador = new Proxy(prisma as any, {
        get(alvo, prop) {
          if (prop === '$transaction') {
            return (fn: any, opcoes?: any) => {
              transacoesAbertas++;
              return (alvo as any).$transaction(async (tx: any) => {
                await new Promise((r) => setTimeout(r, 100));
                return fn(tx);
              }, opcoes);
            };
          }
          const v = Reflect.get(alvo, prop);
          return typeof v === 'function' ? v.bind(alvo) : v;
        },
      }) as PrismaClient;

      await expect(
        executarRollout(contador, 'c2', { transacao: { timeout: 5, maxWait: 20_000 } }),
      ).rejects.toThrow();

      expect(transacoesAbertas).toBe(1); // uma só — nada de repetir por conta própria
      expect(await retrato()).toEqual(antes);
    }, 180_000);
  });

  // ── O comando como COMANDO ────────────────────────────────────────────────

  describe('guarda de host — o comando rodando de verdade, em processo separado', () => {
    const apiDir = path.resolve(__dirname, '../../..');

    function rodarCli(argumentos: string[], databaseUrl?: string) {
      return spawnSync(
        process.execPath,
        ['-r', 'ts-node/register/transpile-only', 'scripts/iam-permission-rollout.ts', ...argumentos],
        {
          cwd: apiDir,
          encoding: 'utf-8',
          timeout: 180_000,
          env: {
            ...process.env,
            TS_NODE_PROJECT: path.join(apiDir, 'tsconfig.json'),
            ...(databaseUrl === undefined
              ? { DATABASE_URL: '' }
              : { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }),
          },
        },
      );
    }

    it('banco LOCAL: o dry-run roda de ponta a ponta e imprime relatório sem dado pessoal', async () => {
      const antes = await retrato();
      const r = rodarCli(['--phase=c2', '--dry-run'], url);

      expect(r.status).toBe(0);
      // O stdout tem de ser JSON PURO: quem canaliza a saída para arquivo lê
      // isso do outro lado. O diagnóstico dos limites da transação (#1014) vai
      // para o stderr justamente para não sujar o relatório.
      const relatorio = JSON.parse(r.stdout);
      expect(relatorio.dryRun).toBe(true);
      expect(r.stderr).toMatch(/Limites da transação: timeout=\d+ms maxWait=\d+ms/);
      expect(relatorio.perfisEncontrados).toContain('ADMIN_GLOBAL');

      // Nenhum e-mail, CPF, CNPJ, senha ou token na saída do comando
      const saida = `${r.stdout}${r.stderr}`;
      expect(saida).not.toMatch(/@[\w.-]+\.(test|com|br)/);
      expect(saida).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/); // CPF
      expect(saida).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/); // CNPJ
      expect(saida.toLowerCase()).not.toContain('password');

      expect(await retrato()).toEqual(antes); // dry-run não escreveu nada
    }, 180_000);

    it('host REMOTO sem --i-know: aborta, e a mensagem não vaza a senha nem a URL', () => {
      const r = rodarCli(
        ['--phase=c2'],
        'postgresql://usuario:SenhaSuperSecreta@db.exemplo-remoto.com:5432/erp',
      );

      expect(r.status).toBe(1);
      const saida = `${r.stdout}${r.stderr}`;
      expect(saida).toContain('ABORTADO');
      expect(saida).not.toContain('SenhaSuperSecreta');
      expect(saida).not.toContain('db.exemplo-remoto.com');
    }, 180_000);

    it('a guarda vale TAMBÉM para dry-run — ela vem antes de conectar', () => {
      const r = rodarCli(
        ['--phase=c2', '--dry-run'],
        'postgresql://usuario:SenhaSuperSecreta@db.exemplo-remoto.com:5432/erp',
      );

      expect(r.status).toBe(1);
      expect(`${r.stdout}${r.stderr}`).toContain('ABORTADO');
      expect(`${r.stdout}${r.stderr}`).not.toContain('SenhaSuperSecreta');
    }, 180_000);

    it('URL malformada e URL ausente falham fechado, com mensagem clara', () => {
      const malformada = rodarCli(['--phase=c2'], 'isto-nao-e-uma-url');
      expect(malformada.status).toBe(1);
      expect(`${malformada.stdout}${malformada.stderr}`).toContain('ABORTADO');

      const ausente = rodarCli(['--phase=c2'], undefined);
      expect(ausente.status).toBe(1);
      expect(`${ausente.stdout}${ausente.stderr}`).toMatch(/ABORTADO.*não é local/s);
    }, 180_000);
  });
});
