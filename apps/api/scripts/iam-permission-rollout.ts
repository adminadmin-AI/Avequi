/**
 * #1011 — rollout ESTREITO de permissões nos perfis já persistidos.
 *
 * ── Por que não o seed ─────────────────────────────────────────────────────
 * `npm run db:seed:iam` resolveria isso, mas faz muito mais do que se precisa:
 *
 *   1. executa o ESPELHAMENTO do enum — cria `UserRoleAssignment` para todo
 *      usuário a partir de `User.role`. É o backfill que ainda não foi
 *      autorizado;
 *   2. RECONCILIA todos os perfis system contra o catálogo — vínculo que não
 *      está no catálogo é APAGADO. Há precedente de permissão concedida
 *      manualmente no banco (#889): se estiver num perfil system, some;
 *   3. mexe em todas as permissões e todos os perfis para resolver três
 *      associações.
 *
 * Este comando faz só o que a issue pede, e nada além. Decisão do Rafael.
 *
 * ── Por que a lista é declarada AQUI, e não importada do catálogo ──────────
 * Um rollout tem de ser auditável: quem lê o manifesto precisa ver exatamente
 * o que foi aplicado, sem depender do estado do catálogo no momento da
 * execução. Importar de `roles.catalog` faria o resultado mudar sozinho se o
 * catálogo mudasse entre a revisão e a execução — o oposto de operação
 * previsível. Há teste que confere esta lista CONTRA o catálogo, para que a
 * duplicação não vire divergência.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *   ts-node scripts/iam-permission-rollout.ts --phase=c2 --dry-run
 *   ts-node scripts/iam-permission-rollout.ts --phase=c2
 *   ts-node scripts/iam-permission-rollout.ts --rollback=manifesto.json
 *
 * NUNCA aponta para produção sem autorização explícita do Rafael. A guarda
 * `--i-know` é exigida para qualquer host que não seja local.
 */
/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';

// ─── O que cada fase aplica ──────────────────────────────────────────────────

export interface PermissionRollout {
  code: string;
  name: string;
  description: string;
  module: string;
  resource: string;
  action: string;
  /** Perfis system que recebem a associação DIRETA. */
  roles: string[];
  /** Perfis que recebem por HERANÇA — o rollout NÃO cria vínculo para eles. */
  porHeranca?: Array<{ role: string; via: string }>;
}

/** Fase A (#1001-C2) — obrigatória antes da release 1.41.0. */
export const FASE_C2: PermissionRollout[] = [
  {
    code: 'sales.commissions.view-all',
    name: 'Ver comissões e percentuais de todos',
    description:
      'Sem ela, GET /commissions e /commissions/rules devolvem só o do próprio usuário (#1001-C2)',
    module: 'sales',
    resource: 'commissions',
    action: 'view-all',
    roles: [
      'ADMIN_GLOBAL',
      'ADMIN_EMPRESA',
      'ADMIN_FILIAL',
      'DIRETOR',
      'GERENTE_GERAL',
      'GERENTE_COMERCIAL',
      'COORDENADOR_COMERCIAL',
      'GERENTE_LOJA',
      'GERENTE_FINANCEIRO',
      'FINANCEIRO',
      'AUDITOR',
    ],
  },
  {
    code: 'iam.sessions.revoke-any',
    name: 'Revogar sessão de outro usuário',
    description:
      'DELETE /auth/sessions/:id de terceiro — mata o refresh e põe o access na denylist (#1001-C2)',
    module: 'iam',
    resource: 'sessions',
    action: 'revoke-any',
    roles: ['ADMIN_GLOBAL', 'ADMIN_EMPRESA'],
  },
];

/** Fase B (#1002-C3) — obrigatória antes da primeira release com a C3. */
export const FASE_C3: PermissionRollout[] = [
  {
    code: 'crm.leads.assignable',
    name: 'Pode receber leads (elegível ao rodízio)',
    description:
      'Marca a CLASSE de quem pode ser vendedor; quem participa do rodízio agora é User.crmAvailable (#1002-C3)',
    module: 'crm',
    resource: 'leads',
    action: 'assignable',
    roles: [
      'VENDEDOR',
      'LOJA_OPERACIONAL',
      'GERENTE_LOJA',
      'GERENTE_COMERCIAL',
      'COORDENADOR_COMERCIAL',
    ],
    // LOJA_FATURAMENTO recebe pela cadeia LOJA_OPERACIONAL → LOJA_FATURAMENTO
    // → GERENTE_LOJA. Criar vínculo direto contradiria o catálogo e deixaria
    // um resíduo que o seed removeria depois.
    porHeranca: [{ role: 'LOJA_FATURAMENTO', via: 'LOJA_OPERACIONAL' }],
  },
];

export const FASES: Record<string, PermissionRollout[]> = {
  c2: FASE_C2,
  c3: FASE_C3,
  all: [...FASE_C2, ...FASE_C3],
};

// ─── Manifesto ───────────────────────────────────────────────────────────────

export interface Manifesto {
  fase: string;
  timestamp: string;
  execucaoId: string;
  /** Codes de Permission CRIADAS por esta execução (não as que já existiam). */
  permissoesCriadas: string[];
  /** Vínculos RolePermission CRIADOS por esta execução. */
  vinculosCriados: Array<{ id: string; roleCode: string; permissionCode: string }>;
}

export interface Relatorio {
  fase: string;
  dryRun: boolean;
  permissoesAusentes: string[];
  permissoesExistentes: string[];
  perfisEncontrados: string[];
  perfisObrigatoriosAusentes: string[];
  vinculosACriar: Array<{ roleCode: string; permissionCode: string }>;
  vinculosExistentes: Array<{ roleCode: string; permissionCode: string }>;
  heranca: Array<{ role: string; via: string; cadeiaOk: boolean; detalhe?: string }>;
  usuariosAfetados: number;
  usuariosComDenyIndividual: number;
  usuariosComGrantIndividual: number;
  /** Só na fase c3: empresas que ficariam sem nenhum elegível. */
  empresasSemElegivel?: string[];
  manifesto?: Manifesto;
}

// ─── Execução ────────────────────────────────────────────────────────────────

/**
 * Levanta o estado e, quando `dryRun` é false, aplica dentro de UMA transação.
 *
 * Falha completa se qualquer perfil obrigatório estiver ausente: metade
 * aplicada seria pior que nada — ninguém saberia onde parou.
 */
export async function executarRollout(
  prisma: PrismaClient,
  fase: string,
  opcoes: { dryRun?: boolean; execucaoId?: string } = {},
): Promise<Relatorio> {
  const alvos = FASES[fase];
  if (!alvos) throw new Error(`Fase desconhecida: ${fase}. Use c2, c3 ou all.`);
  const dryRun = opcoes.dryRun ?? false;

  const rel: Relatorio = {
    fase,
    dryRun,
    permissoesAusentes: [],
    permissoesExistentes: [],
    perfisEncontrados: [],
    perfisObrigatoriosAusentes: [],
    vinculosACriar: [],
    vinculosExistentes: [],
    heranca: [],
    usuariosAfetados: 0,
    usuariosComDenyIndividual: 0,
    usuariosComGrantIndividual: 0,
  };

  const codes = alvos.map((a) => a.code);
  const rolesNecessarias = [...new Set(alvos.flatMap((a) => a.roles))];

  // ── Levantamento (sempre, dry-run ou não) ─────────────────────────────────
  const permissoes = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  const permIdByCode = new Map(permissoes.map((p) => [p.code, p.id]));
  rel.permissoesExistentes = permissoes.map((p) => p.code).sort();
  rel.permissoesAusentes = codes.filter((c) => !permIdByCode.has(c)).sort();

  // Só perfis SYSTEM (companyId null). Roles customizadas de empresa nunca
  // entram — nem para leitura de alvo, nem para escrita.
  const perfis = await prisma.role.findMany({
    where: { code: { in: rolesNecessarias }, companyId: null, isSystem: true },
    select: { id: true, code: true, parentId: true },
  });
  const roleIdByCode = new Map(perfis.map((r) => [r.code, r.id]));
  rel.perfisEncontrados = perfis.map((r) => r.code).sort();
  rel.perfisObrigatoriosAusentes = rolesNecessarias.filter((c) => !roleIdByCode.has(c)).sort();

  // Herança: confere a cadeia sem alterá-la.
  for (const alvo of alvos) {
    for (const h of alvo.porHeranca ?? []) {
      const filho = await prisma.role.findFirst({
        where: { code: h.role, companyId: null, isSystem: true },
        select: { id: true, parentId: true },
      });
      if (!filho) {
        rel.heranca.push({ ...h, cadeiaOk: false, detalhe: 'perfil ausente' });
        continue;
      }
      const pai = filho.parentId
        ? await prisma.role.findUnique({
            where: { id: filho.parentId },
            select: { code: true },
          })
        : null;
      const cadeiaOk = pai?.code === h.via;
      rel.heranca.push({
        ...h,
        cadeiaOk,
        ...(cadeiaOk ? {} : { detalhe: `parent atual: ${pai?.code ?? 'nenhum'}` }),
      });
    }
  }

  // Vínculos existentes × a criar
  const permIds = [...permIdByCode.values()];
  const vinculos = permIds.length
    ? await prisma.rolePermission.findMany({
        where: { permissionId: { in: permIds }, roleId: { in: [...roleIdByCode.values()] } },
        select: { roleId: true, permissionId: true },
      })
    : [];
  const jaTem = new Set(vinculos.map((v) => `${v.roleId}:${v.permissionId}`));

  for (const alvo of alvos) {
    for (const roleCode of alvo.roles) {
      const roleId = roleIdByCode.get(roleCode);
      const permId = permIdByCode.get(alvo.code);
      if (!roleId) continue; // já registrado em perfisObrigatoriosAusentes
      if (permId && jaTem.has(`${roleId}:${permId}`)) {
        rel.vinculosExistentes.push({ roleCode, permissionCode: alvo.code });
      } else {
        rel.vinculosACriar.push({ roleCode, permissionCode: alvo.code });
      }
    }
  }

  // Overrides individuais — contagens, sem expor identidade
  if (permIds.length) {
    rel.usuariosComDenyIndividual = await prisma.userPermission.count({
      where: { permissionId: { in: permIds }, granted: false },
    });
    rel.usuariosComGrantIndividual = await prisma.userPermission.count({
      where: { permissionId: { in: permIds }, granted: true },
    });
  }

  // Quantos usuários seriam alcançados pelos perfis-alvo
  const roleIdsAlvo = alvos.flatMap((a) => a.roles.map((r) => roleIdByCode.get(r))).filter(Boolean);
  if (roleIdsAlvo.length) {
    const atribuicoes = await prisma.userRoleAssignment.findMany({
      where: { roleId: { in: roleIdsAlvo as string[] } },
      select: { userId: true },
    });
    rel.usuariosAfetados = new Set(atribuicoes.map((a) => a.userId)).size;
  }

  // Fase c3: empresas que ficariam sem ninguém elegível — o caso que produz
  // lead sem responsável em silêncio.
  if (fase === 'c3' || fase === 'all') {
    const empresas = await prisma.company.findMany({ select: { id: true } });
    const semElegivel: string[] = [];
    for (const empresa of empresas) {
      const n = await prisma.userRoleAssignment.count({
        where: {
          companyId: empresa.id,
          roleId: { in: roleIdsAlvo as string[] },
          user: { isActive: true },
        },
      });
      if (n === 0) semElegivel.push(empresa.id);
    }
    rel.empresasSemElegivel = semElegivel;
  }

  if (dryRun) return rel;

  // ── Aplicação ─────────────────────────────────────────────────────────────
  if (rel.perfisObrigatoriosAusentes.length > 0) {
    throw new Error(
      `Rollout ABORTADO: perfis obrigatórios ausentes no banco: ` +
        `${rel.perfisObrigatoriosAusentes.join(', ')}. ` +
        `Aplicar parcialmente deixaria o sistema num estado que ninguém sabe descrever.`,
    );
  }
  const herancaQuebrada = rel.heranca.filter((h) => !h.cadeiaOk);
  if (herancaQuebrada.length > 0) {
    throw new Error(
      `Rollout ABORTADO: cadeia de herança divergente — ` +
        herancaQuebrada.map((h) => `${h.role} (${h.detalhe})`).join('; ') +
        `. O rollout não altera hierarquia: corrija e reavalie.`,
    );
  }

  const execucaoId = opcoes.execucaoId ?? `rollout-${fase}`;
  const manifesto: Manifesto = {
    fase,
    timestamp: new Date().toISOString(),
    execucaoId,
    permissoesCriadas: [],
    vinculosCriados: [],
  };

  await prisma.$transaction(async (tx) => {
    // 1. Permissões: upsert por code. Só as três — nenhuma outra é tocada.
    for (const alvo of alvos) {
      const existente = permIdByCode.get(alvo.code);
      if (existente) {
        await tx.permission.update({
          where: { id: existente },
          data: { name: alvo.name, description: alvo.description },
        });
        continue;
      }
      const criada = await tx.permission.create({
        data: {
          code: alvo.code,
          name: alvo.name,
          description: alvo.description,
          module: alvo.module,
          resource: alvo.resource,
          action: alvo.action,
        },
        select: { id: true },
      });
      permIdByCode.set(alvo.code, criada.id);
      manifesto.permissoesCriadas.push(alvo.code);
    }

    // 2. Vínculos: cria só o que falta. Nenhum deleteMany, nenhuma
    //    reconciliação — o que já existe fica onde está.
    for (const alvo of alvos) {
      const permId = permIdByCode.get(alvo.code)!;
      for (const roleCode of alvo.roles) {
        const roleId = roleIdByCode.get(roleCode)!;
        if (jaTem.has(`${roleId}:${permId}`)) continue;
        const criado = await tx.rolePermission.create({
          data: { roleId, permissionId: permId, granted: true },
          select: { id: true },
        });
        manifesto.vinculosCriados.push({
          id: criado.id,
          roleCode,
          permissionCode: alvo.code,
        });
      }
    }
  });

  rel.manifesto = manifesto;
  return rel;
}

/**
 * Desfaz SOMENTE o que aquela execução criou.
 *
 * Nunca remove vínculo preexistente, grant ou deny individual, role
 * customizada ou outra permissão. A permissão só é apagada se tiver ficado
 * sem nenhum outro vínculo — se alguém a associou a outro perfil no meio do
 * caminho, ela fica.
 */
export async function reverterRollout(
  prisma: PrismaClient,
  manifesto: Manifesto,
): Promise<{ vinculosRemovidos: number; permissoesRemovidas: string[] }> {
  const permissoesRemovidas: string[] = [];
  let vinculosRemovidos = 0;

  await prisma.$transaction(async (tx) => {
    // Confere que cada vínculo ainda é O MESMO que o rollout criou antes de
    // apagar. Se alguém recriou aquele par role×permission por outro caminho
    // (id diferente), ou reconfigurou o perfil no meio do tempo, a linha atual
    // não é nossa — e desfazer configuração alheia seria pior que não desfazer
    // nada.
    const idsDoManifesto = manifesto.vinculosCriados.map((v) => v.id);
    if (idsDoManifesto.length) {
      const atuais = await tx.rolePermission.findMany({
        where: { id: { in: idsDoManifesto } },
        select: { id: true, roleId: true, permissionId: true },
      });
      const roles = await tx.role.findMany({
        where: { id: { in: atuais.map((a) => a.roleId) } },
        select: { id: true, code: true },
      });
      const perms = await tx.permission.findMany({
        where: { id: { in: atuais.map((a) => a.permissionId) } },
        select: { id: true, code: true },
      });
      const roleCodeById = new Map(roles.map((r) => [r.id, r.code]));
      const permCodeById = new Map(perms.map((p) => [p.id, p.code]));
      const esperadoPorId = new Map(
        manifesto.vinculosCriados.map((v) => [v.id, `${v.roleCode}:${v.permissionCode}`]),
      );

      const seguros = atuais
        .filter(
          (a) =>
            esperadoPorId.get(a.id) ===
            `${roleCodeById.get(a.roleId)}:${permCodeById.get(a.permissionId)}`,
        )
        .map((a) => a.id);

      if (seguros.length) {
        const r = await tx.rolePermission.deleteMany({ where: { id: { in: seguros } } });
        vinculosRemovidos = r.count;
      }
    }

    for (const code of manifesto.permissoesCriadas) {
      const perm = await tx.permission.findFirst({ where: { code }, select: { id: true } });
      if (!perm) continue;
      const [vinculosRestantes, overrides] = await Promise.all([
        tx.rolePermission.count({ where: { permissionId: perm.id } }),
        tx.userPermission.count({ where: { permissionId: perm.id } }),
      ]);
      if (vinculosRestantes === 0 && overrides === 0) {
        await tx.permission.delete({ where: { id: perm.id } });
        permissoesRemovidas.push(code);
      }
    }
  });

  return { vinculosRemovidos, permissoesRemovidas };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/**
 * O destino é um banco local descartável?
 *
 * Fail-closed: URL ausente, malformada ou desconhecida → `false`. Este comando
 * ESCREVE em perfis; na dúvida, ele não roda.
 *
 * Só LOOPBACK conta. Endereço de rede privada (10.x, 192.168.x, 172.16–31.x)
 * é recusado de propósito: um banco "da rede" é um banco de alguém, e o erro
 * de apontar para o servidor da empresa achando que era o da própria máquina é
 * exatamente o tipo de acidente que esta guarda existe para impedir.
 */
export function ehLocal(url: string): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  // Nomes de serviço usados em compose/CI, que resolvem dentro do próprio host
  const nomesLocais = ['localhost', 'postgres', 'db', 'host.docker.internal'];
  if (nomesLocais.includes(host)) return true;
  // Loopback IPv4 (127.0.0.0/8) e IPv6
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const fase = args.find((a) => a.startsWith('--phase='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');
  const rollbackPath = args.find((a) => a.startsWith('--rollback='))?.split('=')[1];
  const url = process.env.DATABASE_URL ?? '';

  // Guarda: qualquer host remoto exige confirmação explícita. Este comando
  // ESCREVE em perfis — não é para rodar por engano contra produção.
  if (!ehLocal(url) && !args.includes('--i-know')) {
    console.error(
      'ABORTADO: DATABASE_URL não é local. Execução contra ambiente remoto exige ' +
        'autorização explícita do Rafael e a flag --i-know.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (rollbackPath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const manifesto: Manifesto = JSON.parse(require('fs').readFileSync(rollbackPath, 'utf-8'));
      const r = await reverterRollout(prisma, manifesto);
      console.log(JSON.stringify({ rollback: manifesto.execucaoId, ...r }, null, 2));
      return;
    }

    if (!fase) {
      console.error('Uso: --phase=c2|c3|all [--dry-run] | --rollback=<manifesto.json>');
      process.exit(1);
    }

    const rel = await executarRollout(prisma, fase, { dryRun });
    console.log(JSON.stringify(rel, null, 2));

    if (rel.manifesto) {
      const arquivo = `rollout-${fase}-${rel.manifesto.timestamp.replace(/[:.]/g, '-')}.json`;
      writeFileSync(arquivo, JSON.stringify(rel.manifesto, null, 2));
      console.log(`\nManifesto: ${arquivo} (guarde — é o que permite o rollback)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
