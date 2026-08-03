import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import {
  ENTITLEMENTS_CATALOG,
  validateEntitlements,
} from '../entitlement/entitlements.catalog';
import { OpsActionContext } from './ops.service';

/**
 * PlansService — OPS WP4 (#911): gestão de planos e entitlements pelo portal.
 * Toda escrita valida contra o catálogo em código, audita SÍNCRONO e invalida
 * o cache do EntitlementService — "muda sem redeploy" com efeito ≤60s em
 * qualquer instância.
 *
 * Auditoria: eventos de TENANT (troca de plano, override) auditam na company
 * do tenant; eventos de PLANO (objeto global, sem tenant) auditam na company
 * do OPERADOR (ctx.actorCompanyId) — AuditLogV2.companyId é FK obrigatória.
 */

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly entitlementService: EntitlementService,
  ) {}

  /** Catálogo de keys + planos cadastrados (o portal monta o form daqui). */
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { companies: true } } },
    });
    return { catalog: ENTITLEMENTS_CATALOG, plans };
  }

  async createPlan(
    dto: { code: string; name: string; description?: string; entitlements: Record<string, unknown>; priceCents?: number },
    ctx: OpsActionContext,
  ) {
    this.assertValidEntitlements(dto.entitlements);
    const plan = await this.prisma.plan.create({
      data: {
        code: dto.code.toUpperCase(),
        name: dto.name,
        description: dto.description,
        entitlements: dto.entitlements as Prisma.InputJsonValue,
        priceCents: dto.priceCents,
      },
    });
    await this.audit(ctx, ctx.actorCompanyId, 'Plan', plan.id, AuditAction.CREATE, null, {
      code: plan.code,
      entitlements: dto.entitlements,
    });
    return plan;
  }

  async updatePlan(
    id: string,
    dto: { name?: string; description?: string; entitlements?: Record<string, unknown>; priceCents?: number; active?: boolean },
    ctx: OpsActionContext,
  ) {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plano não encontrado');
    if (dto.entitlements) this.assertValidEntitlements(dto.entitlements);

    const plan = await this.prisma.plan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        entitlements: dto.entitlements as Prisma.InputJsonValue | undefined,
        priceCents: dto.priceCents,
        active: dto.active,
      },
    });
    await this.audit(ctx, ctx.actorCompanyId, 'Plan', id, AuditAction.UPDATE, {
      entitlements: existing.entitlements,
      active: existing.active,
    }, {
      entitlements: plan.entitlements,
      active: plan.active,
    });

    // Plano editado afeta TODOS os tenants nele — invalida um a um
    const companies = await this.prisma.company.findMany({
      where: { planId: id },
      select: { id: true },
    });
    for (const c of companies) this.entitlementService.invalidate(c.id);
    return plan;
  }

  /** Troca (ou remove) o plano de um tenant RAIZ. planId null = volta ao legado. */
  async assignPlan(tenantId: string, planId: string | null, ctx: OpsActionContext) {
    const tenant = await this.prisma.company.findUnique({
      where: { id: tenantId },
      select: { id: true, parentId: true, planId: true, plan: { select: { code: true } } },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
    let newCode: string | null = null;
    if (planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
      if (!plan || !plan.active) {
        throw new BadRequestException('Plano inexistente ou inativo');
      }
      newCode = plan.code;
    }

    const updated = await this.prisma.company.update({
      where: { id: tenantId },
      data: { planId },
      select: { id: true, planId: true, plan: { select: { code: true, name: true } } },
    });
    await this.audit(ctx, tenantId, 'Company', tenantId, AuditAction.UPDATE, {
      plan: tenant.plan?.code ?? null,
    }, { plan: newCode });
    this.entitlementService.invalidate(tenantId);
    return updated;
  }

  /** Cria/atualiza uma exceção de entitlement do tenant (reason obrigatório). */
  async setOverride(
    tenantId: string,
    key: string,
    value: unknown,
    reason: string,
    ctx: OpsActionContext,
  ) {
    await this.assertRootTenant(tenantId);
    this.assertValidEntitlements({ [key]: value });
    if (!reason?.trim() || reason.trim().length < 5) {
      throw new BadRequestException('Exceção exige um motivo (reason, mín. 5 caracteres)');
    }

    const override = await this.prisma.tenantEntitlementOverride.upsert({
      where: { companyId_key: { companyId: tenantId, key } },
      update: { value: value as Prisma.InputJsonValue, reason: reason.trim() },
      create: {
        companyId: tenantId,
        key,
        value: value as Prisma.InputJsonValue,
        reason: reason.trim(),
        createdById: ctx.userId,
      },
    });
    await this.audit(ctx, tenantId, 'TenantEntitlementOverride', `${tenantId}:${key}`, AuditAction.UPDATE, null, {
      key,
      value,
      reason: reason.trim(),
    });
    this.entitlementService.invalidate(tenantId);
    return override;
  }

  /** Remove uma exceção — o tenant volta ao valor do plano. */
  async removeOverride(tenantId: string, key: string, ctx: OpsActionContext) {
    await this.assertRootTenant(tenantId);
    const existing = await this.prisma.tenantEntitlementOverride.findUnique({
      where: { companyId_key: { companyId: tenantId, key } },
    });
    if (!existing) throw new NotFoundException('Exceção não encontrada');

    await this.prisma.tenantEntitlementOverride.delete({
      where: { companyId_key: { companyId: tenantId, key } },
    });
    await this.audit(ctx, tenantId, 'TenantEntitlementOverride', `${tenantId}:${key}`, AuditAction.DELETE, {
      key,
      value: existing.value,
      reason: existing.reason,
    }, null);
    this.entitlementService.invalidate(tenantId);
    return { ok: true };
  }

  /** Plano + exceções + mapa resolvido de um tenant (aba "Plano & Módulos"). */
  async tenantEntitlements(tenantId: string) {
    await this.assertRootTenant(tenantId);
    const [company, overrides, resolved] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: tenantId },
        select: { planId: true, plan: { select: { id: true, code: true, name: true, entitlements: true } } },
      }),
      this.prisma.tenantEntitlementOverride.findMany({
        where: { companyId: tenantId },
        orderBy: { key: 'asc' },
      }),
      this.entitlementService.resolve(tenantId),
    ]);
    return { catalog: ENTITLEMENTS_CATALOG, plan: company?.plan ?? null, overrides, resolved };
  }

  private assertValidEntitlements(map: Record<string, unknown>) {
    const errors = validateEntitlements(map);
    if (errors.length > 0) {
      throw new BadRequestException(`Entitlements inválidos: ${errors.join('; ')}`);
    }
  }

  private async assertRootTenant(id: string) {
    const tenant = await this.prisma.company.findUnique({
      where: { id },
      select: { parentId: true },
    });
    if (!tenant || tenant.parentId !== null) {
      throw new NotFoundException('Tenant não encontrado');
    }
  }

  private async audit(
    ctx: OpsActionContext,
    auditCompanyId: string,
    entity: string,
    entityId: string,
    action: AuditAction,
    oldValue: unknown,
    newValue: unknown,
  ) {
    await this.auditService.persist({
      companyId: auditCompanyId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity,
      entityId,
      action,
      module: 'ops',
      oldValue,
      newValue,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }
}
