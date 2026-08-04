import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';
import { OpsActionContext } from './ops.service';

/**
 * ProposalsService — AVECCHI P2 (#963): proposta comercial → assinatura.
 *
 * Modelo de mercado (decisão do Claudio 04/08): o PLANO tem preço de TABELA
 * (Plan.priceCents, editável no portal) e a proposta nasce dele — o valor
 * negociado por conta é o desvio, não a regra. Aceite converte em
 * Subscription + Plan do tenant SEM digitação dupla (compõe
 * BillingService.upsertSubscription + PlansService.assignPlan, com a mesma
 * auditoria e invalidação de cache de entitlements que o portal já usa).
 *
 * Ciclo: DRAFT → SENT → ACCEPTED | DECLINED; proposta vencida (validUntil)
 * não pode ser aceita — vira EXPIRED no toque. Propostas são IMUTÁVEIS após
 * decisão: upgrade/downgrade = proposta NOVA (o histórico da conta é a
 * própria lista de aceitas).
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly billingService: BillingService,
    private readonly plansService: PlansService,
  ) {}

  private async assertRootTenant(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, parentId: true },
    });
    if (!company || company.parentId !== null) {
      throw new NotFoundException('Conta de cliente não encontrada');
    }
  }

  async list(tenantId: string) {
    await this.assertRootTenant(tenantId);
    return this.prisma.subscriptionProposal.findMany({
      where: { companyId: tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { code: true, name: true, priceCents: true } } },
    });
  }

  async create(
    tenantId: string,
    dto: {
      planId: string;
      priceCents?: number;
      billingDay?: number;
      conditions?: string;
      validUntil?: string;
    },
    ctx: OpsActionContext,
  ) {
    await this.assertRootTenant(tenantId);
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.active) {
      throw new BadRequestException('Plano inexistente ou inativo');
    }
    // Tabela por default; negociado é desvio explícito. Plano ainda sem preço
    // de tabela exige o valor na proposta — nunca proposta de R$ 0 implícito.
    const priceCents = dto.priceCents ?? plan.priceCents ?? null;
    if (priceCents === null || priceCents <= 0) {
      throw new BadRequestException(
        'Plano sem preço de tabela: informe o valor negociado da proposta.',
      );
    }
    const proposal = await this.prisma.subscriptionProposal.create({
      data: {
        companyId: tenantId,
        planId: plan.id,
        priceCents,
        billingDay: dto.billingDay ?? 5,
        conditions: dto.conditions?.trim() || null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        createdById: ctx.userId,
      },
    });
    await this.audit(ctx, tenantId, proposal.id, AuditAction.CREATE, null, {
      planCode: plan.code,
      priceCents,
      negociado: dto.priceCents !== undefined && dto.priceCents !== plan.priceCents,
    });
    return proposal;
  }

  /** DRAFT → SENT (registro de que o cliente recebeu a proposta). */
  async send(proposalId: string, ctx: OpsActionContext) {
    const p = await this.getOpen(proposalId);
    if (p.status !== ProposalStatus.DRAFT) {
      throw new BadRequestException('Só proposta em rascunho pode ser enviada.');
    }
    const updated = await this.prisma.subscriptionProposal.update({
      where: { id: proposalId },
      data: { status: ProposalStatus.SENT },
    });
    await this.audit(ctx, p.companyId, proposalId, AuditAction.UPDATE, { status: p.status }, { status: ProposalStatus.SENT });
    return updated;
  }

  /**
   * Aceite = a conversão sem digitação dupla: assinatura (valor + vencimento)
   * + plano/entitlements do tenant, nas MESMAS rotinas auditadas do portal.
   */
  async accept(proposalId: string, decidedNote: string | undefined, ctx: OpsActionContext) {
    const p = await this.getOpen(proposalId);
    const updated = await this.prisma.subscriptionProposal.update({
      where: { id: proposalId },
      data: {
        status: ProposalStatus.ACCEPTED,
        decidedAt: new Date(),
        decidedNote: decidedNote?.trim() || null,
      },
    });
    await this.billingService.upsertSubscription(
      p.companyId,
      { planId: p.planId, priceCents: p.priceCents, billingDay: p.billingDay },
      ctx,
    );
    await this.plansService.assignPlan(p.companyId, p.planId, ctx);
    await this.audit(ctx, p.companyId, proposalId, AuditAction.APPROVE, { status: p.status }, {
      status: ProposalStatus.ACCEPTED,
      priceCents: p.priceCents,
      planId: p.planId,
    });
    return updated;
  }

  async decline(proposalId: string, decidedNote: string, ctx: OpsActionContext) {
    if (!decidedNote?.trim() || decidedNote.trim().length < 5) {
      throw new BadRequestException('Recusa exige um motivo (mín. 5 caracteres)');
    }
    const p = await this.getOpen(proposalId);
    const updated = await this.prisma.subscriptionProposal.update({
      where: { id: proposalId },
      data: {
        status: ProposalStatus.DECLINED,
        decidedAt: new Date(),
        decidedNote: decidedNote.trim(),
      },
    });
    await this.audit(ctx, p.companyId, proposalId, AuditAction.CANCEL, { status: p.status }, {
      status: ProposalStatus.DECLINED,
      motivo: decidedNote.trim(),
    });
    return updated;
  }

  /** Aberta = DRAFT/SENT dentro da validade; vencida vira EXPIRED no toque. */
  private async getOpen(proposalId: string) {
    const p = await this.prisma.subscriptionProposal.findUnique({ where: { id: proposalId } });
    if (!p) throw new NotFoundException('Proposta não encontrada');
    if (p.status === ProposalStatus.ACCEPTED || p.status === ProposalStatus.DECLINED) {
      throw new BadRequestException('Proposta já decidida é imutável — crie uma nova.');
    }
    if (p.status === ProposalStatus.EXPIRED) {
      throw new BadRequestException('Proposta vencida — crie uma nova.');
    }
    if (p.validUntil && p.validUntil < new Date()) {
      await this.prisma.subscriptionProposal.update({
        where: { id: p.id },
        data: { status: ProposalStatus.EXPIRED },
      });
      throw new BadRequestException('Proposta vencida — crie uma nova.');
    }
    return p;
  }

  private audit(
    ctx: OpsActionContext,
    tenantId: string,
    proposalId: string,
    action: AuditAction,
    before: unknown,
    after: unknown,
  ) {
    // Síncrono como todo o módulo ops: mutação de control plane sem trilha
    // não existe (mesmo racional do OpsService/BillingService).
    return this.auditService.persist({
      companyId: tenantId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'SubscriptionProposal',
      entityId: proposalId,
      action,
      module: 'ops',
      oldValue: before,
      newValue: after,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }
}
