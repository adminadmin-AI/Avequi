import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeadActivityType, PipelineStageType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * F2.2 (#515) — conversão lead → cliente. Cria/vincula um Customer a partir
 * do lead (aproveitando telefone/nome) e devolve o customerId pronto pra tela
 * de nova OV pré-preencher. O vínculo Lead↔Customer↔OV é a base do funil ponta
 * a ponta (origem do lead → receita faturada no dashboard F3.1).
 */
@Injectable()
export class LeadConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Converte o lead em cliente. Se já houver customer com o mesmo telefone,
   * vincula ao existente em vez de duplicar. Retorna o customerId e dados
   * p/ a tela de OV pré-preencher (a criação da OV em si acontece na tela de
   * vendas, que já sabe montar itens/preço/estoque da filial).
   */
  async convertToCustomer(companyId: string, leadId: string, actorId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      include: { customer: { select: { id: true, name: true } } },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');

    // já convertido: idempotente
    if (lead.customerId && lead.customer) {
      return { customerId: lead.customerId, customerName: lead.customer.name, created: false };
    }

    // tenta reaproveitar cliente existente pelo telefone
    let customer = lead.phone
      ? await this.prisma.customer.findFirst({
          where: {
            companyId,
            OR: [{ phone: lead.phone }, { phone2: lead.phone }],
          },
          select: { id: true, name: true },
        })
      : null;
    let created = false;

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          companyId,
          name: lead.name?.trim() || lead.phone || 'Cliente do CRM',
          phone: lead.phone,
          email: lead.email,
          // type default (COMPANY) do schema; dados fiscais completados na venda
        },
        select: { id: true, name: true },
      });
      created = true;
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        customerId: customer.id,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.CONVERSION,
            actorId,
            properties: {
              customerId: customer.id,
              customerCreated: created,
            },
          },
        },
      },
    });

    this.eventEmitter.emit('crm.lead.converted', {
      leadId: lead.id,
      companyId,
      customerId: customer.id,
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      created,
      /** dados p/ a tela de OV pré-preencher */
      prefill: {
        customerId: customer.id,
        interest: lead.interest,
        leadId: lead.id,
      },
    };
  }

  /** Vincula uma OV recém-criada ao lead (chamado após criar a venda) */
  async linkSalesOrder(companyId: string, leadId: string, salesOrderId: string) {
    const [lead, order] = await Promise.all([
      this.prisma.lead.findFirst({ where: { id: leadId, companyId } }),
      this.prisma.salesOrder.findFirst({ where: { id: salesOrderId, companyId } }),
    ]);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (!order) throw new BadRequestException('Ordem de venda inválida');

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        salesOrderId,
        customerId: lead.customerId ?? order.customerId,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.CONVERSION,
            properties: { salesOrderId, kind: 'link_order' },
          },
        },
      },
    });
    return { ok: true };
  }

  /**
   * F2.2 (#515) — listener SALE_INVOICED: quando a NF-e da OV vinculada sai,
   * o lead vai automático pro estágio WON (Fechado).
   */
  async closeWonBySalesOrder(companyId: string, salesOrderId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { companyId, salesOrderId },
      select: { id: true, stageId: true },
    });
    if (!lead) return; // OV sem lead vinculado (venda direta) — nada a fazer

    const wonStage = await this.prisma.pipelineStage.findFirst({
      where: { companyId, type: PipelineStageType.WON, isActive: true },
      orderBy: { order: 'asc' },
    });
    if (!wonStage || lead.stageId === wonStage.id) return;

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        stageId: wonStage.id,
        lostReason: null,
        lastInteractionAt: new Date(),
        activities: {
          create: {
            type: LeadActivityType.STAGE_CHANGE,
            properties: {
              from: lead.stageId,
              to: wonStage.id,
              toName: wonStage.name,
              reason: 'NF-e emitida (auto)',
            },
          },
        },
      },
    });

    this.eventEmitter.emit('crm.lead.stage_changed', {
      leadId: lead.id,
      companyId,
      fromStageId: lead.stageId,
      toStageId: wonStage.id,
      stageType: PipelineStageType.WON,
    });
  }
}
