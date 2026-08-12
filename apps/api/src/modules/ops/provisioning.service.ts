import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { OpsActionContext } from './ops.service';
import { TenantInviteService } from './tenant-invite.service';
import { buildInitialTaxRules } from '../tax/tax-rule-seed';

/**
 * ProvisioningService — OPS WP2 (#909): onboarding de tenant como máquina de
 * estados idempotente. Passos:
 *
 *   1. create      → Company RAIZ nasce TRIAL + TenantProvisioning
 *   2. admin       → convite de primeiro acesso (TenantInviteService)
 *   3. fiscal      → valida FOCUS_NFE_TOKEN__<companyId> (env ESCOPADA —
 *                    fallback no token global emitiria nota como a MATRIZ GDR,
 *                    então para tenant novo é ERRO, não warning; decisão #695)
 *   4. activate    → gate MANUAL do operador: exige convite aceito + fiscal ok
 *                    → tenantStatus=ACTIVE + onboardedAt + auditoria síncrona
 *
 * Reexecutar qualquer passo atualiza o registro sem duplicar efeito.
 * Todos os passos gravam o resultado em TenantProvisioning.steps (JSON).
 */

// Exportadas porque aparecem em tipos de retorno públicos do controller —
// o `nest build` (declaration emit) exige nome nomeável (TS4053).
export interface AdminStep {
  userId: string;
  email: string;
  invitedAt: string;
  emailSent: boolean;
}

export interface FiscalStep {
  ok: boolean;
  tokenSource: 'scoped' | 'missing';
  checkedAt: string;
}

export interface ProvisioningSteps {
  admin?: AdminStep;
  fiscal?: FiscalStep;
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inviteService: TenantInviteService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Passo 1 — cria o tenant (Company raiz TRIAL) + registro de provisionamento.
   * Idempotente por CNPJ: se o CNPJ já existe COM provisionamento aberto,
   * devolve o estado atual (retomada); CNPJ de tenant já ativo → 409.
   */
  async createTenant(dto: CreateTenantDto, ctx: OpsActionContext) {
    const existing = await this.prisma.company.findUnique({
      where: { cnpj: dto.cnpj },
      select: { id: true, parentId: true, provisioning: { select: { id: true, completedAt: true } } },
    });
    if (existing) {
      if (existing.parentId === null && existing.provisioning && !existing.provisioning.completedAt) {
        // Retomada do fluxo — o wizard continua de onde parou
        return this.getProvisioning(existing.id);
      }
      throw new ConflictException('Já existe uma conta com este CNPJ');
    }

    const company = await this.prisma.company.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj,
        razaoSocial: dto.razaoSocial,
        ie: dto.ie,
        crt: dto.crt,
        taxRegime: dto.taxRegime,
        state: dto.state,
        city: dto.city,
        email: dto.email,
        tenantStatus: TenantStatus.TRIAL,
        provisioning: { create: { createdById: ctx.userId } },
      },
      select: { id: true, name: true, cnpj: true, tenantStatus: true },
    });

    // Regras fiscais iniciais do Simples (#1071) — INATIVAS: o contador revisa e
    // ativa. Sem isso o tenant nasce sem nenhuma regra e só descobre na primeira
    // emissão; com elas ATIVAS, emitiria com tributação que ninguém revisou.
    const initialRules = buildInitialTaxRules(company.id, dto.crt);
    if (initialRules.length > 0) {
      await this.prisma.taxRule.createMany({ data: initialRules });
      this.logger.log(
        JSON.stringify({
          event: 'ops_tenant_tax_rules_seeded',
          tenantId: company.id,
          count: initialRules.length,
          active: false,
        }),
      );
    }

    await this.auditService.persist({
      companyId: company.id,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Company',
      entityId: company.id,
      action: AuditAction.CREATE,
      module: 'ops',
      newValue: { name: dto.name, cnpj: dto.cnpj, tenantStatus: TenantStatus.TRIAL },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    this.logger.log(
      JSON.stringify({ event: 'ops_tenant_provisioning_started', tenantId: company.id, by: ctx.userId }),
    );
    return this.getProvisioning(company.id);
  }

  /** Estado consolidado do checklist — o que o wizard renderiza. */
  async getProvisioning(companyId: string) {
    const provisioning = await this.prisma.tenantProvisioning.findUnique({
      where: { companyId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            cnpj: true,
            razaoSocial: true,
            tenantStatus: true,
            onboardedAt: true,
          },
        },
      },
    });
    if (!provisioning) {
      throw new NotFoundException('Provisionamento não encontrado para este tenant');
    }

    const steps = (provisioning.steps ?? {}) as ProvisioningSteps;
    const invite = steps.admin
      ? await this.prisma.tenantInvite.findFirst({
          where: { userId: steps.admin.userId, revokedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { usedAt: true, expiresAt: true },
        })
      : null;

    const checklist = {
      company: { done: true },
      admin: steps.admin
        ? {
            done: Boolean(invite?.usedAt),
            invited: true,
            email: steps.admin.email,
            emailSent: steps.admin.emailSent,
            accepted: Boolean(invite?.usedAt),
            inviteExpiresAt: invite?.expiresAt ?? null,
          }
        : { done: false, invited: false },
      fiscal: steps.fiscal
        ? { done: steps.fiscal.ok, ...steps.fiscal }
        : { done: false },
      activation: {
        done: Boolean(provisioning.completedAt),
        completedAt: provisioning.completedAt,
      },
    };

    return { ...provisioning, checklist };
  }

  /** Passo 2 — convida (ou reconvida) o admin do tenant. */
  async inviteAdmin(companyId: string, dto: InviteAdminDto, ctx: OpsActionContext) {
    await this.assertOpenProvisioning(companyId);
    const result = await this.inviteService.inviteAdmin(companyId, dto, ctx.userId);

    await this.patchSteps(companyId, {
      admin: {
        userId: result.userId,
        email: result.email,
        invitedAt: new Date().toISOString(),
        emailSent: result.emailSent,
      },
    });
    await this.auditService.persist({
      companyId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'TenantInvite',
      entityId: result.inviteId,
      action: AuditAction.CREATE,
      module: 'ops',
      newValue: { email: result.email, emailSent: result.emailSent },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return result;
  }

  /**
   * Passo 3 — checagem fiscal: exige FOCUS_NFE_TOKEN__<companyId> na env.
   * O fallback global pertence à matriz GDR (#695) — usar para outro tenant
   * emitiria NF-e como GDR, então aqui só token ESCOPADO conta como ok.
   */
  async runFiscalCheck(companyId: string, ctx: OpsActionContext) {
    await this.assertOpenProvisioning(companyId);
    const scoped = this.config.get<string>(`FOCUS_NFE_TOKEN__${companyId}`, '');
    const fiscal: FiscalStep = {
      ok: Boolean(scoped),
      tokenSource: scoped ? 'scoped' : 'missing',
      checkedAt: new Date().toISOString(),
    };
    await this.patchSteps(companyId, { fiscal });

    if (!fiscal.ok) {
      this.logger.warn(
        JSON.stringify({
          event: 'ops_fiscal_check_missing_token',
          tenantId: companyId,
          hint: `Definir FOCUS_NFE_TOKEN__${companyId} no Railway e redeployar (decisão #695)`,
        }),
      );
    }
    return fiscal;
  }

  /**
   * Passo 4 — go-live: gate manual. Exige convite ACEITO + fiscal ok.
   * TRIAL→ACTIVE + onboardedAt + completedAt, tudo auditado síncrono.
   */
  async activate(companyId: string, ctx: OpsActionContext) {
    const provisioning = await this.assertOpenProvisioning(companyId);
    const state = await this.getProvisioning(companyId);

    const pendencias: string[] = [];
    if (!state.checklist.admin.done) {
      pendencias.push('admin do tenant ainda não aceitou o convite');
    }
    if (!state.checklist.fiscal.done) {
      pendencias.push('checagem fiscal pendente ou sem token Focus escopado');
    }
    if (pendencias.length > 0) {
      throw new BadRequestException(
        `Go-live bloqueado: ${pendencias.join('; ')}`,
      );
    }

    const now = new Date();
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { tenantStatus: TenantStatus.ACTIVE, onboardedAt: now },
      select: { id: true, name: true, tenantStatus: true, onboardedAt: true },
    });
    await this.prisma.tenantProvisioning.update({
      where: { id: provisioning.id },
      data: { completedAt: now },
    });

    await this.auditService.persist({
      companyId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Company',
      entityId: companyId,
      action: AuditAction.APPROVE,
      module: 'ops',
      oldValue: { tenantStatus: TenantStatus.TRIAL },
      newValue: { tenantStatus: TenantStatus.ACTIVE, onboardedAt: now.toISOString() },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    this.logger.log(
      JSON.stringify({ event: 'ops_tenant_activated', tenantId: companyId, by: ctx.userId }),
    );
    return company;
  }

  private async assertOpenProvisioning(companyId: string) {
    const provisioning = await this.prisma.tenantProvisioning.findUnique({
      where: { companyId },
      select: { id: true, completedAt: true },
    });
    if (!provisioning) {
      throw new NotFoundException('Provisionamento não encontrado para este tenant');
    }
    if (provisioning.completedAt) {
      throw new BadRequestException('Provisionamento já concluído para este tenant');
    }
    return provisioning;
  }

  /** Merge raso e idempotente no JSON de passos. */
  private async patchSteps(companyId: string, patch: ProvisioningSteps) {
    const current = await this.prisma.tenantProvisioning.findUnique({
      where: { companyId },
      select: { steps: true },
    });
    const steps = {
      ...((current?.steps ?? {}) as ProvisioningSteps),
      ...patch,
    };
    await this.prisma.tenantProvisioning.update({
      where: { companyId },
      data: { steps: steps as Prisma.InputJsonValue },
    });
  }
}
