import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SessionRevokedReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';
import { ENUM_ROLE_TO_SYSTEM_ROLE } from './roles.catalog';

/**
 * Espelho do papel legado — #946 (filha da #780).
 *
 * DECISÃO DE PRODUTO (Rafael, 03/08/2026): o **RBAC v2 é a fonte de verdade**.
 * O enum `User.role` continua existindo apenas como ESPELHO DE COMPATIBILIDADE
 * para os consumidores ainda não migrados, e passa a ser DERIVADO dos perfis
 * v2 — nunca mais editado direto pela tela comum de usuários.
 *
 * A derivação é **conservadora por princípio**: só acontece quando existe uma
 * correspondência inequívoca. Não existe "perfil mais poderoso", não se força
 * `READER`, não se inventa precedência. Quando o v2 não cabe no enum, o enum
 * CONGELA no último valor válido, o motivo é auditado e a interface avisa que
 * o papel legado não representa o acesso real.
 *
 * ⚠️ Enquanto os poderes críticos (desconto, override de faturamento
 * bloqueado, escopo cross-company) dependerem do enum, congelar significa
 * manter esses poderes. Por isso o #947 (PR B) tira esses três poderes do
 * enum e DEVE ir ao ar no mesmo ciclo operacional deste trabalho — não pedir
 * release entre um e outro.
 */

/** Por que a derivação não aconteceu (auditado; nunca silencioso). */
export type MotivoCongelamento =
  | 'NO_ACTIVE_ROLE'
  | 'AMBIGUOUS_MULTIPLE_ROLES'
  | 'CUSTOM_ROLE'
  | 'NO_ENUM_EQUIVALENT';

export interface ResultadoEspelho {
  status: 'DERIVED' | 'FROZEN';
  motivo?: MotivoCongelamento;
  /** Enum antes da operação. */
  enumAnterior: string | null;
  /** Enum resultante (igual ao anterior quando FROZEN). */
  enumResultante: string | null;
  /** Codes dos perfis considerados (já filtrados e deduplicados). */
  perfis: string[];
  /** Sessões revogadas — só > 0 quando o enum mudou de valor. */
  sessoesRevogadas: number;
}

/** Assignment no formato mínimo que a derivação precisa (função pura). */
export interface AssignmentParaDerivacao {
  roleId: string;
  expiresAt: Date | null;
  role: { code: string; isActive: boolean; companyId: string | null };
}

/** Mapa reverso perfil oficial → enum, derivado da única fonte (o catálogo). */
const SYSTEM_ROLE_TO_ENUM: Record<string, string> = Object.fromEntries(
  Object.entries(ENUM_ROLE_TO_SYSTEM_ROLE).map(([enumRole, code]) => [code, enumRole]),
);

/**
 * REGRA DE DERIVAÇÃO (pura, sem banco — por isso testável sozinha).
 *
 * Considera apenas assignments ATIVOS (role ativa) e NÃO EXPIRADOS, e
 * **deduplica por roleId**: com o escopo por filial (#347-B), o mesmo perfil
 * em duas filiais são dois assignments do MESMO papel — sem o dedup, todo
 * gerente multi-loja cairia em "ambíguo" indevidamente.
 *
 * Deriva SOMENTE quando sobra exatamente UMA role distinta, que seja oficial
 * de plataforma (`companyId === null`) e tenha equivalente 1:1 no catálogo.
 */
export function derivarEnumLegado(
  assignments: AssignmentParaDerivacao[],
  agora: Date = new Date(),
): { enum: string | null; motivo?: MotivoCongelamento; perfis: string[] } {
  const ativos = assignments.filter(
    (a) => a.role.isActive && (a.expiresAt === null || a.expiresAt > agora),
  );

  const porRoleId = new Map<string, AssignmentParaDerivacao>();
  for (const a of ativos) porRoleId.set(a.roleId, a);
  const distintos = [...porRoleId.values()];
  const perfis = distintos.map((a) => a.role.code).sort();

  if (distintos.length === 0) return { enum: null, motivo: 'NO_ACTIVE_ROLE', perfis };
  if (distintos.length > 1) {
    return { enum: null, motivo: 'AMBIGUOUS_MULTIPLE_ROLES', perfis };
  }

  const unico = distintos[0].role;
  // Perfil de tenant (custom, ou homônimo criado na empresa) não representa
  // papel legado: o enum é um vocabulário fechado de 10 valores de plataforma.
  if (unico.companyId !== null) return { enum: null, motivo: 'CUSTOM_ROLE', perfis };

  const enumRole = SYSTEM_ROLE_TO_ENUM[unico.code];
  if (!enumRole) return { enum: null, motivo: 'NO_ENUM_EQUIVALENT', perfis };

  return { enum: enumRole, perfis };
}

@Injectable()
export class LegacyRoleMirrorService {
  private readonly logger = new Logger(LegacyRoleMirrorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Recalcula o espelho DENTRO da transação que alterou os assignments.
   * Devolve o resultado estruturado para o caller auditar e responder à UI.
   *
   * Chamar SOMENTE nas operações de perfil (atribuir/remover). Grants e denies
   * individuais NÃO recalculam: exceção não é papel, e derivar enum a partir
   * de um deny inverteria a semântica.
   */
  async sincronizarNaTransacao(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<ResultadoEspelho> {
    // tenant-lint: ok (escopo por userId: usuário e atribuições do próprio alvo)
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const enumAnterior = (user?.role as string | undefined) ?? null;

    // tenant-lint: ok (escopo por userId: atribuições do próprio usuário)
    const assignments = await tx.userRoleAssignment.findMany({
      where: { userId },
      select: {
        roleId: true,
        expiresAt: true,
        role: { select: { code: true, isActive: true, companyId: true } },
      },
    });

    const { enum: derivado, motivo, perfis } = derivarEnumLegado(assignments);

    if (!derivado || derivado === enumAnterior) {
      return {
        status: derivado ? 'DERIVED' : 'FROZEN',
        ...(motivo ? { motivo } : {}),
        enumAnterior,
        enumResultante: enumAnterior,
        perfis,
        sessoesRevogadas: 0,
      };
    }

    // tenant-lint: ok (escopo por userId: o próprio usuário alvo da operação)
    await tx.user.update({ where: { id: userId }, data: { role: derivado as never } });

    return {
      status: 'DERIVED',
      enumAnterior,
      enumResultante: derivado,
      perfis,
      sessoesRevogadas: 0,
    };
  }

  /**
   * Efeito colateral pós-commit: o enum viaja no JWT e nunca é revalidado
   * contra o banco — sem revogar, um usuário rebaixado manteria os poderes do
   * enum antigo até o access token expirar. Revoga SOMENTE quando o enum
   * mudou de valor (congelamento não derruba ninguém).
   *
   * Best-effort, no mesmo padrão do user.service (#744): falha não desfaz a
   * mudança de perfil e nunca é silenciosa. Risco residual máximo em caso de
   * falha = vida do access token (15 min).
   */
  async revogarSessoesSeMudou(resultado: ResultadoEspelho, userId: string): Promise<number> {
    if (resultado.status !== 'DERIVED' || resultado.enumResultante === resultado.enumAnterior) {
      return 0;
    }
    try {
      const n = await this.sessions.revokeAllSessions(
        userId,
        SessionRevokedReason.ADMIN_REVOKE,
      );
      return n;
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'legacy_role_mirror_session_revoke_failed',
          userId,
          enumAnterior: resultado.enumAnterior,
          enumResultante: resultado.enumResultante,
          message: (err as Error).message,
        }),
      );
      return 0;
    }
  }
}
