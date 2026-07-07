import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeadActivityType, PipelineStageType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ConversationFilters {
  /** 'mine' = só leads atribuídos ao usuário; 'all' = loja inteira */
  scope?: 'mine' | 'all';
  /** busca por nome ou telefone do lead */
  search?: string;
  userId: string;
}

/**
 * F1.3 (#509) — consultas e ações do inbox: lista de conversas da loja,
 * detalhe do lead c/ timeline e troca rápida de estágio.
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Conversas da loja, mais recentes primeiro (inbox) */
  async listConversations(companyId: string, filters: ConversationFilters) {
    const leadWhere: Prisma.LeadWhereInput = {
      companyId,
      ...(filters.scope === 'mine' ? { assignedToId: filters.userId } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: 'insensitive' } },
              { phone: { contains: filters.search.replace(/\D/g, '') || filters.search } },
            ],
          }
        : {}),
    };

    const conversations = await this.prisma.whatsappConversation.findMany({
      where: { companyId, lead: leadWhere },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            source: true,
            interest: true,
            sdrStatus: true, // badge IA no inbox (F4.4 #524)
            stage: { select: { id: true, name: true, color: true, type: true } },
            assignedTo: { select: { id: true, name: true } },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const now = Date.now();
    return conversations.map((c) => ({
      id: c.id,
      leadId: c.leadId,
      lead: c.lead,
      unreadCount: c.unreadCount,
      lastMessageAt: c.lastMessageAt,
      windowExpiresAt: c.windowExpiresAt,
      windowOpen: !!c.windowExpiresAt && c.windowExpiresAt.getTime() > now,
      lastMessage: c.messages[0]
        ? {
            direction: c.messages[0].direction,
            type: c.messages[0].type,
            preview: (c.messages[0].text ?? '[mídia]').slice(0, 80),
            status: c.messages[0].status,
            createdAt: c.messages[0].createdAt,
          }
        : null,
    }));
  }

  /** Detalhe do lead p/ o painel lateral (dados + timeline) */
  async getLead(companyId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      include: {
        stage: { select: { id: true, name: true, color: true, type: true } },
        assignedTo: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        activities: { orderBy: { happensAt: 'desc' }, take: 50 },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    return lead;
  }

  /** Estágios do funil da loja (select de troca rápida / kanban F2.1) */
  listStages(companyId: string) {
    return this.prisma.pipelineStage.findMany({
      where: { companyId, isActive: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, color: true, type: true, order: true },
    });
  }

  /** Troca rápida de estágio (painel do inbox). Perdido exige motivo. */
  async changeStage(
    companyId: string,
    leadId: string,
    stageId: string,
    actorId: string,
    lostReason?: string,
  ) {
    const [lead, stage] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { id: leadId, companyId },
        select: { id: true, stageId: true },
      }),
      this.prisma.pipelineStage.findFirst({
        where: { id: stageId, companyId, isActive: true },
      }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!stage) throw new BadRequestException('Estágio inválido para esta loja');
    if (stage.type === PipelineStageType.LOST && !lostReason?.trim()) {
      throw new BadRequestException('Mover para Perdido exige o motivo da perda');
    }

    const updated = await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        stageId: stage.id,
        lostReason: stage.type === PipelineStageType.LOST ? lostReason!.trim() : null,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.STAGE_CHANGE,
            actorId,
            properties: {
              from: lead.stageId,
              to: stage.id,
              toName: stage.name,
              ...(stage.type === PipelineStageType.LOST ? { lostReason: lostReason!.trim() } : {}),
            },
          },
        },
      },
      include: { stage: { select: { id: true, name: true, color: true, type: true } } },
    });

    this.eventEmitter.emit('crm.lead.stage_changed', {
      leadId: lead.id,
      companyId,
      fromStageId: lead.stageId,
      toStageId: stage.id,
      stageType: stage.type,
    });
    return updated;
  }
}
