import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionDenylistService } from '../iam/session-denylist.service';
import {
  IMPERSONATION_SCOPE,
  IMPERSONATION_TTL,
  IMPERSONATION_TTL_SECONDS,
} from './impersonation.constants';
import { OpsActionContext } from './ops.service';

/**
 * ImpersonationService — OPS WP6 (#913): "ver como o cliente", auditado.
 *
 * PRINCÍPIO: impersonation é empréstimo de VISÃO, não de identidade.
 * - Token DEDICADO (30 min, sem refresh): claims do usuário ALVO + quem é o
 *   operador (impersonatorId) + iid revogável + readOnly. NUNCA reusa o
 *   refresh token do alvo — nenhuma sessão do cliente é tocada.
 * - F1 é SOMENTE-LEITURA, sempre: o ImpersonationReadonlyGuard global rejeita
 *   toda mutação na API (não é esconder botão). "Modo escrita com re-MFA"
 *   ficou DEFERIDO de propósito (anotado no épico #915) — com isso, "fiscal
 *   nunca via impersonation" vale por construção.
 * - Transparência dos DOIS lados: início e fim auditados (AuditLogV2, module
 *   ops, entity Impersonation) — aparecem na timeline do portal E no
 *   GET /support-access do admin do tenant.
 * - Encerramento: expira sozinho; o operador pode matar antes (denylist do
 *   iid — Redis fora = fail-open, janela máxima de 30 min, mesmo trade-off
 *   documentado da #823).
 */

export interface ImpersonationResult {
  impersonationToken: string;
  expiresAt: Date;
  iid: string;
  target: { id: string; name: string; email: string; role: string };
}

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly denylist: SessionDenylistService,
  ) {}

  /** Inicia uma visita read-only ao app como o usuário alvo do tenant. */
  async start(
    tenantId: string,
    targetUserId: string,
    reason: string,
    ctx: OpsActionContext,
  ): Promise<ImpersonationResult> {
    if (!reason?.trim() || reason.trim().length < 5) {
      throw new BadRequestException(
        'Impersonation exige um motivo (mín. 5 caracteres) — vai pra trilha de auditoria',
      );
    }
    const tenant = await this.prisma.company.findUnique({
      where: { id: tenantId },
      select: { id: true, parentId: true },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
    const target = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        isActive: true,
        company: { OR: [{ id: tenantId }, { parentId: tenantId }] },
      },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    if (!target) {
      throw new NotFoundException('Usuário não encontrado neste tenant (ou inativo)');
    }

    const iid = randomBytes(16).toString('hex');
    const impersonationToken = this.jwtService.sign(
      {
        sub: target.id,
        email: target.email,
        role: target.role,
        companyId: target.companyId,
        scope: IMPERSONATION_SCOPE,
        iid,
        impersonatorId: ctx.userId,
        readOnly: true,
      },
      { expiresIn: IMPERSONATION_TTL },
    );
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000);

    await this.auditService.persist({
      companyId: tenantId,
      userId: ctx.userId, // o OPERADOR — transparência: o tenant vê QUEM olhou
      sessionId: ctx.sessionId ?? null,
      entity: 'Impersonation',
      entityId: iid,
      action: AuditAction.EXECUTE,
      module: 'ops',
      newValue: {
        targetUserId: target.id,
        targetEmail: target.email,
        reason: reason.trim(),
        readOnly: true,
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    this.logger.log(
      JSON.stringify({
        event: 'ops_impersonation_started',
        iid,
        tenantId,
        targetUserId: target.id,
        by: ctx.userId,
      }),
    );
    return {
      impersonationToken,
      expiresAt,
      iid,
      target: { id: target.id, name: target.name, email: target.email, role: target.role },
    };
  }

  /**
   * Encerra a visita antes da expiração (denylist do iid). Precisa do
   * tenantId para a trilha — o iid sozinho não identifica a conta.
   */
  async end(tenantId: string, iid: string, ctx: OpsActionContext) {
    const tenant = await this.prisma.company.findUnique({
      where: { id: tenantId },
      select: { parentId: true },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
    await this.denylist.deny(iid, IMPERSONATION_TTL_SECONDS + 300);
    await this.auditService.persist({
      companyId: tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Impersonation',
      entityId: iid,
      action: AuditAction.CANCEL,
      module: 'ops',
      newValue: { endedEarly: true },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return { ok: true };
  }

  /**
   * "Acessos do suporte" — visível ao ADMIN DO TENANT (transparência vende
   * confiança). Sempre a conta do PRÓPRIO usuário (companyId do JWT).
   */
  async listSupportAccess(companyId: string, take = 50) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    const rootId = company.parentId ?? company.id;
    return this.prisma.auditLogV2.findMany({
      where: { companyId: rootId, module: 'ops', entity: 'Impersonation' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      select: {
        id: true,
        entityId: true, // iid — correlaciona início/fim
        action: true, // EXECUTE = início · CANCEL = encerrado antes
        newValue: true,
        createdAt: true,
        user: { select: { name: true } }, // o operador da Avecchi
      },
    });
  }
}
