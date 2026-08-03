import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, SessionRevokedReason, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionService } from '../iam/session.service';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

/**
 * OpsService — OPS WP1 (#908): administração de TENANTS pela operadora.
 *
 * ⚠️ FRONTEIRA CROSS-TENANT: este módulo é o ÚNICO do backend autorizado a
 * consultar Company/User sem filtro de companyId do JWT. Toda rota que chega
 * aqui passou por @RequirePermission('ops.tenants.*') + OpsMfaGuard. Nenhum
 * outro módulo pode importar este service — a suíte de isolamento (WP7 #914)
 * vai travar isso no CI.
 *
 * Tenant = empresa RAIZ (parentId null). Filial não tem lifecycle próprio:
 * mudar status de filial é rejeitado aqui e o enforcement de login resolve
 * sempre pela raiz (TenantStatusService).
 */

/** Ator e contexto de request para a trilha de auditoria. */
export interface OpsActionContext {
  userId: string;
  /** Company do OPERADOR — usada como companyId de auditoria em eventos de
   *  objetos globais (ex.: Plan, WP4 #911), onde não há tenant alvo. */
  actorCompanyId: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const TENANT_LIST_SELECT = {
  id: true,
  name: true,
  razaoSocial: true,
  cnpj: true,
  tenantStatus: true,
  isSandbox: true,
  trialEndsAt: true,
  suspendedAt: true,
  suspendReason: true,
  onboardedAt: true,
  createdAt: true,
  _count: { select: { users: true, branches: true } },
} as const;

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
  ) {}

  /** Lista as contas de cliente (empresas raiz), com contadores básicos. */
  async listTenants() {
    return this.prisma.company.findMany({
      where: { parentId: null },
      select: TENANT_LIST_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Detalhe de um tenant (raiz) com as filiais. */
  async getTenant(id: string) {
    const tenant = await this.prisma.company.findUnique({
      where: { id },
      select: {
        ...TENANT_LIST_SELECT,
        parentId: true,
        branches: {
          select: { id: true, name: true, cnpj: true, type: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!tenant || tenant.parentId !== null) {
      // Filial não é tenant: mesmo 404 de id inexistente (não revela estrutura)
      throw new NotFoundException('Tenant não encontrado');
    }
    const { parentId: _p, ...result } = tenant;
    return result;
  }

  /**
   * Muda o status do tenant. Regras:
   * - só na empresa RAIZ;
   * - transição para o MESMO status é rejeitada (no-op não gera trilha falsa);
   * - SUSPENDED/CHURNED exigem `reason`;
   * - SUSPENDED/CHURNED revogam TODAS as sessões ativas dos usuários do
   *   tenant (matriz + filiais) — ADMIN_REVOKE entra na denylist (#823/#835),
   *   o access token morre na próxima request, não em até 15 min;
   * - auditoria SÍNCRONA (AuditService.persist): mudança de lifecycle de um
   *   cliente pagante não pode se perder numa fila (mesmo racional da
   *   Decisão 5 para PermissionChangeLog).
   */
  async updateTenantStatus(
    id: string,
    dto: UpdateTenantStatusDto,
    ctx: OpsActionContext,
  ) {
    const tenant = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        parentId: true,
        tenantStatus: true,
        suspendedAt: true,
        suspendReason: true,
        isSandbox: true,
      },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
    if (tenant.tenantStatus === dto.status) {
      throw new BadRequestException(`O tenant já está com status ${dto.status}`);
    }

    const needsReason =
      dto.status === TenantStatus.SUSPENDED || dto.status === TenantStatus.CHURNED;
    if (needsReason && !dto.reason?.trim()) {
      throw new BadRequestException(
        `Mudança para ${dto.status} exige um motivo (reason)`,
      );
    }

    const suspending = dto.status === TenantStatus.SUSPENDED;
    const blocking = suspending || dto.status === TenantStatus.CHURNED;

    const updated = await this.prisma.company.update({
      where: { id: tenant.id },
      data: {
        tenantStatus: dto.status,
        isSandbox: dto.status === TenantStatus.SANDBOX,
        suspendedAt: suspending ? new Date() : null,
        suspendReason: needsReason ? dto.reason!.trim() : null,
      },
      select: TENANT_LIST_SELECT,
    });

    // Trilha SÍNCRONA antes dos efeitos colaterais: se a revogação de sessões
    // falhar no meio, a mudança de status já está registrada.
    await this.auditService.persist({
      companyId: tenant.id,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Company',
      entityId: tenant.id,
      action: AuditAction.UPDATE,
      module: 'ops',
      oldValue: {
        tenantStatus: tenant.tenantStatus,
        suspendReason: tenant.suspendReason,
      },
      newValue: {
        tenantStatus: dto.status,
        suspendReason: needsReason ? dto.reason!.trim() : null,
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    if (blocking) {
      const revoked = await this.revokeTenantSessions(tenant.id);
      this.logger.log(
        JSON.stringify({
          event: 'ops_tenant_blocked',
          tenantId: tenant.id,
          status: dto.status,
          sessionsRevoked: revoked,
          by: ctx.userId,
        }),
      );
    }

    return updated;
  }

  /**
   * Revoga todas as sessões ativas dos usuários do tenant (matriz + filiais).
   * Best-effort por usuário: falha em um não impede os demais — o bloqueio
   * duro de login/refresh (AuthService + TenantStatusService) é o backstop.
   */
  private async revokeTenantSessions(rootCompanyId: string): Promise<number> {
    const companies = await this.prisma.company.findMany({
      where: { OR: [{ id: rootCompanyId }, { parentId: rootCompanyId }] },
      select: { id: true },
    });
    const users = await this.prisma.user.findMany({
      where: { companyId: { in: companies.map((c) => c.id) } },
      select: { id: true },
    });

    let revoked = 0;
    for (const user of users) {
      try {
        revoked += await this.sessionService.revokeAllSessions(
          user.id,
          SessionRevokedReason.ADMIN_REVOKE,
        );
      } catch (err) {
        this.logger.warn(
          `Falha ao revogar sessões do usuário ${user.id} na suspensão do tenant ` +
            `${rootCompanyId} (best-effort): ${(err as Error).message}`,
        );
      }
    }
    return revoked;
  }
}
