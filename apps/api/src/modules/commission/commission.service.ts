import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SALE_INVOICED_EVENT, SaleInvoicedEvent } from '../sales/events/sale-invoiced.event';

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Auto-calculate on invoice ──────────────────────────────────────────

  @OnEvent(SALE_INVOICED_EVENT)
  async onSaleInvoiced(event: SaleInvoicedEvent) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: event.salesOrderId },
      select: { createdById: true, companyId: true },
    });

    if (!order?.createdById) return;

    const rule = await this.prisma.commissionRule.findFirst({
      where: {
        companyId: order.companyId,
        userId: order.createdById,
        isActive: true,
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
    });

    if (!rule) return;

    const orderTotal = event.items.reduce(
      (sum, i) => sum + i.quantity * i.unitPrice,
      0,
    );

    const amount = rule.fixedAmount
      ? Number(rule.fixedAmount)
      : orderTotal * (Number(rule.percentRate) / 100);

    const commission = await this.prisma.commission.create({
      data: {
        companyId: order.companyId,
        userId: order.createdById,
        salesOrderId: event.salesOrderId,
        amount,
      },
    });

    this.logger.log(
      `Comissão ${commission.id} criada: R$${amount.toFixed(2)} para ${order.createdById} (OV ${event.salesOrderId})`,
    );
  }

  // ─── List commissions ──────────────────────────────────────────────────

  async findAll(
    companyId: string,
    filters: { userId?: string; status?: string; from?: string; to?: string } = {},
  ) {
    return this.prisma.commission.findMany({
      where: {
        companyId,
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.from || filters.to
          ? {
              calculatedAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        salesOrder: { select: { id: true, createdAt: true } },
      },
      orderBy: { calculatedAt: 'desc' },
    });
  }

  // ─── Approve batch → generate payables ─────────────────────────────────

  async approveBatch(companyId: string, commissionIds: string[], userId: string) {
    const commissions = await this.prisma.commission.findMany({
      where: { id: { in: commissionIds }, companyId, status: 'PENDING' },
    });

    if (commissions.length === 0) {
      throw new NotFoundException('Nenhuma comissão pendente encontrada');
    }

    const results = [];
    for (const c of commissions) {
      const payable = await this.prisma.payable.create({
        data: {
          companyId,
          description: `Comissão OV ${c.salesOrderId}`,
          amount: c.amount,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          origin: `COMMISSION:${c.id}`,
        },
      });

      await this.prisma.commission.update({
        where: { id: c.id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          payableId: payable.id,
        },
      });

      results.push({ commissionId: c.id, payableId: payable.id, amount: Number(c.amount) });
    }

    this.logger.log(`${results.length} comissões aprovadas, payables gerados`);
    return { approved: results.length, payables: results };
  }

  // ─── CRUD for CommissionRule ────────────────────────────────────────────

  async createRule(data: {
    companyId: string;
    userId: string;
    percentRate: number;
    fixedAmount?: number;
    validFrom: string;
    validTo?: string;
  }) {
    return this.prisma.commissionRule.create({
      data: {
        companyId: data.companyId,
        userId: data.userId,
        percentRate: data.percentRate,
        fixedAmount: data.fixedAmount,
        validFrom: new Date(data.validFrom),
        validTo: data.validTo ? new Date(data.validTo) : undefined,
      },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async findRules(companyId: string) {
    return this.prisma.commissionRule.findMany({
      where: { companyId, isActive: true },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
