import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeadActivityType, LeadSource, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';

/** Perfis elegíveis pro rodízio de atendimento de lead */
const SELLER_ROLES: UserRole[] = [UserRole.COMMERCIAL, UserRole.STORE];

/** Lead Perdido há menos de N dias volta pro funil quando o cliente chama de novo */
const DEFAULT_REOPEN_LOST_DAYS = 90;
const REOPEN_PARAM_KEY = 'CRM_REOPEN_LOST_DAYS';

export interface IntakeResult {
  lead: { id: string; companyId: string; assignedToId: string | null };
  /** false = telefone/ref já existia; atividade registrada no lead existente */
  created: boolean;
}

/**
 * F1.7 (#513) — porta de entrada ÚNICA de leads. Todos os conectores
 * (WhatsApp #508, Meta #510, ML/OLX #511, site/manual #512) criam lead
 * exclusivamente por aqui: normalização E.164, dedup por constraint,
 * rodízio round-robin por loja e evento crm.lead.created.
 */
@Injectable()
export class LeadIntakeService {
  private readonly logger = new Logger(LeadIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Normaliza telefone BR p/ E.164 sem "+" (ex: 5545999998888).
   * Retorna null quando não dá pra normalizar com segurança (sem DDD etc.) —
   * nesses casos o dedup cai pro externalRef.
   */
  normalizePhone(raw?: string | null): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    // remove zeros de operadora/discagem (041 45..., 0 45...)
    digits = digits.replace(/^0+/, '');
    // já veio com DDI 55: 55 + DDD(2) + fone(8-9)
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      return digits;
    }
    // DDD + fone (10 fixo / 11 celular)
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }
    return null; // sem DDD (8-9 dígitos) ou formato estrangeiro — não arriscar
  }

  /**
   * Entrada de lead. companyId = loja resolvida pelo chamador (JWT no manual,
   * número/anúncio no conector); null/undefined → fila de triagem da matriz.
   */
  async intake(companyId: string | null, dto: IntakeLeadDto): Promise<IntakeResult> {
    const phone = this.normalizePhone(dto.phone);
    if (!phone && !dto.externalRef) {
      throw new BadRequestException(
        'Lead precisa de telefone válido com DDD ou de uma referência externa da origem',
      );
    }

    const targetCompanyId = companyId ?? this.resolveTriageCompanyId();

    // dedup secundário por ref externa (origens sem telefone, ex: pergunta ML)
    if (!phone && dto.externalRef) {
      const byRef = await this.prisma.lead.findFirst({
        where: { companyId: targetCompanyId, externalRef: dto.externalRef, source: dto.source },
        include: { stage: true },
      });
      if (byRef) return this.registerRepeatContact(byRef, dto);
    }

    const [defaultStage, assigneeId] = await Promise.all([
      this.findFirstOpenStage(targetCompanyId),
      // triagem (sem loja identificada) fica sem vendedor — direcionamento manual
      companyId ? this.pickNextSeller(targetCompanyId) : Promise.resolve(null),
    ]);

    try {
      const lead = await this.prisma.lead.create({
        data: {
          companyId: targetCompanyId,
          name: dto.name,
          phone,
          email: dto.email,
          source: dto.source,
          externalRef: dto.externalRef,
          sourceMeta: (dto.sourceMeta as Prisma.InputJsonValue) ?? undefined,
          interest: dto.interest,
          estimatedValue: dto.estimatedValue,
          stageId: defaultStage?.id ?? null,
          assignedToId: assigneeId,
          assignedAt: assigneeId ? new Date() : null,
          lastInteractionAt: new Date(),
          activities: {
            create: assigneeId
              ? [
                  {
                    type: LeadActivityType.ASSIGNMENT,
                    properties: { toUserId: assigneeId, via: 'round-robin' },
                  },
                ]
              : [],
          },
        },
      });

      this.eventEmitter.emit('crm.lead.created', {
        leadId: lead.id,
        companyId: lead.companyId,
        source: lead.source,
        phone: lead.phone,
        assignedToId: lead.assignedToId,
      });

      // #574: mesmo telefone em negociação em OUTRA loja → avisa (não bloqueia;
      // lojas são independentes, mas guerra de preço interna é sinal pro vendedor).
      // Best-effort: falha aqui nunca derruba a captação.
      await this.flagCrossStoreDuplicate(lead.id, targetCompanyId, phone).catch((e) =>
        this.logger.warn(`cross-store dup check falhou p/ lead ${lead.id}: ${e?.message}`),
      );

      return {
        lead: { id: lead.id, companyId: lead.companyId, assignedToId: lead.assignedToId },
        created: true,
      };
    } catch (e) {
      // corrida entre canais: a constraint (companyId, phone) é a fonte da verdade
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.lead.findUnique({
          where: { companyId_phone: { companyId: targetCompanyId, phone: phone! } },
          include: { stage: true },
        });
        if (existing) return this.registerRepeatContact(existing, dto);
      }
      throw e;
    }
  }

  /** Reatribuição manual pelo gerente (com trilha na timeline) */
  async reassign(companyId: string, leadId: string, toUserId: string, actorId: string) {
    const [lead, seller] = await Promise.all([
      this.prisma.lead.findFirst({ where: { id: leadId, companyId } }),
      this.prisma.user.findFirst({
        where: { id: toUserId, companyId, isActive: true },
      }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!seller) throw new BadRequestException('Vendedor inválido para esta loja');

    const updated = await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        assignedToId: toUserId,
        assignedAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.ASSIGNMENT,
            actorId,
            properties: { fromUserId: lead.assignedToId, toUserId, via: 'manual' },
          },
        },
      },
    });
    this.eventEmitter.emit('crm.lead.reassigned', {
      leadId: lead.id,
      companyId,
      fromUserId: lead.assignedToId,
      toUserId,
    });
    return updated;
  }

  /** Relatório simples de distribuição por vendedor no dia (critério de aceite #513) */
  async distributionReport(companyId: string, day?: string) {
    const start = day ? new Date(`${day}T00:00:00`) : this.startOfToday();
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Data inválida');
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const grouped = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { companyId, assignedAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.assignedToId).filter(Boolean) as string[] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return grouped
      .filter((g) => g.assignedToId)
      .map((g) => ({
        userId: g.assignedToId,
        userName: nameById.get(g.assignedToId!) ?? g.assignedToId,
        leadsAssigned: g._count._all,
      }))
      .sort((a, b) => b.leadsAssigned - a.leadsAssigned);
  }

  // ── internos ──────────────────────────────────────────────────────────────

  /**
   * Round-robin: entre vendedores ativos/disponíveis da loja, escolhe quem tem
   * MENOS leads atribuídos hoje; empate → atribuição mais antiga → id.
   */
  /** Próximo vendedor do rodízio. PÚBLICO p/ o escalonamento de SLA (#569)
   *  reusar o mesmo critério, excluindo quem deixou o lead estourar. */
  async pickNextSeller(companyId: string, excludeUserId?: string): Promise<string | null> {
    const sellers = await this.prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        crmAvailable: true,
        role: { in: SELLER_ROLES },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (sellers.length === 0) {
      this.logger.warn(`Nenhum vendedor elegível na company ${companyId} — lead ficará sem atribuição`);
      return null;
    }
    const grouped = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: {
        companyId,
        assignedToId: { in: sellers.map((s) => s.id) },
        assignedAt: { gte: this.startOfToday() },
      },
      _count: { _all: true },
      _max: { assignedAt: true },
    });
    const stats = new Map(grouped.map((g) => [g.assignedToId, g]));
    const ranked = sellers
      .map((s) => ({
        id: s.id,
        count: stats.get(s.id)?._count._all ?? 0,
        lastAt: stats.get(s.id)?._max.assignedAt?.getTime() ?? 0,
      }))
      .sort((a, b) => a.count - b.count || a.lastAt - b.lastAt || a.id.localeCompare(b.id));
    return ranked[0].id;
  }

  private async registerRepeatContact(
    lead: { id: string; companyId: string; assignedToId: string | null; stage?: { type: string } | null; updatedAt?: Date },
    dto: IntakeLeadDto,
  ): Promise<IntakeResult> {
    const shouldReopen = await this.shouldReopen(lead);
    const firstOpenStage = shouldReopen ? await this.findFirstOpenStage(lead.companyId) : null;

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastInteractionAt: new Date(),
        ...(shouldReopen && firstOpenStage
          ? { stageId: firstOpenStage.id, lostReason: null }
          : {}),
        activities: {
          create: [
            {
              type: LeadActivityType.NOTE,
              properties: {
                kind: 'repeat_contact',
                source: dto.source,
                externalRef: dto.externalRef ?? null,
              },
            },
            ...(shouldReopen && firstOpenStage
              ? [
                  {
                    type: LeadActivityType.STAGE_CHANGE,
                    properties: { to: firstOpenStage.id, reason: 'reaberto por novo contato' },
                  },
                ]
              : []),
          ],
        },
      },
    });
    this.eventEmitter.emit('crm.lead.contact_repeated', {
      leadId: lead.id,
      companyId: lead.companyId,
      source: dto.source,
      reopened: shouldReopen,
    });
    return {
      lead: { id: lead.id, companyId: lead.companyId, assignedToId: lead.assignedToId },
      created: false,
    };
  }

  private async shouldReopen(lead: {
    companyId: string;
    stage?: { type: string } | null;
    updatedAt?: Date;
  }): Promise<boolean> {
    if (lead.stage?.type !== 'LOST') return false;
    const param = await this.prisma.systemParameter.findFirst({
      where: { companyId: lead.companyId, key: REOPEN_PARAM_KEY },
    });
    const windowDays = param ? parseInt(param.value, 10) : DEFAULT_REOPEN_LOST_DAYS;
    if (!Number.isFinite(windowDays) || windowDays <= 0) return false;
    const lostAt = lead.updatedAt?.getTime() ?? 0;
    return Date.now() - lostAt < windowDays * 24 * 60 * 60 * 1000;
  }

  /**
   * #574 — o mesmo telefone com lead em aberto em OUTRA loja = cliente
   * negociando em 2 filiais. Registra activity de aviso no lead NOVO.
   * ⚠️ Tenancy: expõe SÓ o nome da(s) loja(s) — nunca dados do outro
   * lead/vendedor/conversa.
   */
  private async flagCrossStoreDuplicate(
    leadId: string,
    companyId: string,
    phone: string | null,
  ) {
    if (!phone) return;
    // #984 — "outra loja" = outra empresa DA MESMA ÁRVORE (matriz+filiais do
    // tenant do lead). Sem esse recorte, telefone repetido em outro TENANT
    // vazava nome de empresa e status de negociação alheios no aviso.
    const me = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, parentId: true },
    });
    if (!me) return;
    const rootId = me.parentId ?? me.id;
    const others = await this.prisma.lead.findMany({
      where: {
        phone,
        companyId: { not: companyId },
        company: { OR: [{ id: rootId }, { parentId: rootId }] },
        anonymizedAt: null,
        // "em negociação" = estágio aberto; sem estágio (triagem) também conta
        OR: [{ stage: { type: 'OPEN' } }, { stageId: null }],
      },
      select: { company: { select: { name: true } } },
      take: 5,
    });
    if (others.length === 0) return;

    const stores = [...new Set(others.map((o) => o.company.name))];
    await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: LeadActivityType.NOTE,
        properties: {
          kind: 'cross_store_duplicate',
          stores,
          preview: `⚠️ Cliente também em negociação: ${stores.join(', ')}`,
        },
      },
    });
  }

  private findFirstOpenStage(companyId: string) {
    return this.prisma.pipelineStage.findFirst({
      where: { companyId, type: 'OPEN', isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Fila de triagem (lead de conector sem loja resolvida) = a MATRIZ do tenant
   * dono dos conectores públicos (env CRM_CONNECTOR_TENANT_ID), NUNCA "a
   * matriz mais antiga do banco" — num banco multi-tenant isso roteava lead
   * de um cliente pro CRM de outro (#984). Fail-closed sem a env.
   */
  private resolveTriageCompanyId(): string {
    const id = process.env.CRM_CONNECTOR_TENANT_ID?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'Fila de triagem indisponível: a env CRM_CONNECTOR_TENANT_ID não está configurada no servidor.',
      );
    }
    return id;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
