import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: {
    companyId: string;
    title: string;
    deadline?: string;
    notes?: string;
    items: { productId: string; quantity: number; specs?: string }[];
  }, userId?: string) {
    return this.prisma.requestForQuotation.create({
      data: {
        companyId: dto.companyId,
        title: dto.title,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        notes: dto.notes,
        createdById: userId,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            specs: i.specs,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.requestForQuotation.findMany({
      where: { companyId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        quotes: { include: { supplier: { select: { id: true, name: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id, companyId },
      include: {
        items: { include: { product: true, quoteItems: true } },
        quotes: {
          include: {
            supplier: true,
            items: { include: { rfqItem: { include: { product: true } } } },
          },
        },
      },
    });
    if (!rfq) throw new NotFoundException(`RFQ ${id} não encontrada`);
    return rfq;
  }

  // Submit quote from supplier
  async submitQuote(rfqId: string, dto: {
    supplierId: string;
    deliveryDays?: number;
    paymentTerms?: string;
    validUntil?: string;
    items: { rfqItemId: string; unitPrice: number; quantity: number }[];
  }) {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id: rfqId },
    });
    if (!rfq) throw new NotFoundException(`RFQ ${rfqId} não encontrada`);

    const totalAmount = dto.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    const quote = await this.prisma.rfqQuote.create({
      data: {
        rfqId,
        supplierId: dto.supplierId,
        totalAmount,
        deliveryDays: dto.deliveryDays,
        paymentTerms: dto.paymentTerms,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        items: {
          create: dto.items.map((i) => ({
            rfqItemId: i.rfqItemId,
            unitPrice: i.unitPrice,
            quantity: i.quantity,
          })),
        },
      },
      include: { supplier: true, items: true },
    });

    // Update RFQ status to QUOTED if first quote
    if (rfq.status === 'DRAFT' || rfq.status === 'SENT') {
      await this.prisma.requestForQuotation.update({
        where: { id: rfqId },
        data: { status: 'QUOTED' },
      });
    }

    return quote;
  }

  // Compare quotes side-by-side
  async compareQuotes(rfqId: string, companyId: string) {
    const rfq = await this.prisma.requestForQuotation.findFirst({
      where: { id: rfqId, companyId },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        quotes: {
          include: {
            supplier: { select: { id: true, name: true } },
            items: { include: { rfqItem: true } },
          },
        },
      },
    });
    if (!rfq) throw new NotFoundException(`RFQ ${rfqId} não encontrada`);

    const comparison = rfq.items.map((item) => {
      const quotesBySupplier = rfq.quotes.map((q) => {
        const qi = q.items.find((i) => i.rfqItemId === item.id);
        return {
          supplierId: q.supplierId,
          supplierName: (q.supplier as any).name,
          unitPrice: qi ? Number(qi.unitPrice) : null,
          deliveryDays: q.deliveryDays,
          totalForItem: qi ? Number(qi.unitPrice) * Number(qi.quantity) : null,
        };
      });
      return {
        rfqItemId: item.id,
        product: item.product,
        requestedQty: Number(item.quantity),
        quotes: quotesBySupplier,
        bestPrice: quotesBySupplier
          .filter((q) => q.unitPrice != null)
          .sort((a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0))[0] ?? null,
      };
    });

    return { rfqId, title: rfq.title, comparison };
  }

  // Award quote → create PO
  async awardQuote(quoteId: string, companyId: string, userId?: string) {
    const quote = await this.prisma.rfqQuote.findFirst({
      where: { id: quoteId },
      include: {
        rfq: true,
        items: { include: { rfqItem: true } },
      },
    });
    if (!quote) throw new NotFoundException(`Cotação ${quoteId} não encontrada`);
    if (quote.rfq.companyId !== companyId) {
      throw new BadRequestException('Cotação não pertence a esta empresa');
    }

    // Create PO from quote
    const po = await this.prisma.purchaseOrder.create({
      data: {
        companyId,
        supplierId: quote.supplierId,
        createdById: userId,
        status: 'DRAFT',
        notes: `Gerado via RFQ "${quote.rfq.title}" (cotação ${quoteId})`,
        items: {
          create: quote.items.map((qi) => ({
            productId: qi.rfqItem.productId,
            quantity: Number(qi.quantity),
            unitCost: Number(qi.unitPrice),
          })),
        },
      },
      include: { items: true, supplier: true },
    });

    // Mark quote as awarded
    await this.prisma.rfqQuote.update({
      where: { id: quoteId },
      data: { isAwarded: true, purchaseOrderId: po.id },
    });

    // Update RFQ status
    await this.prisma.requestForQuotation.update({
      where: { id: quote.rfqId },
      data: { status: 'AWARDED' },
    });

    this.logger.log(`RFQ ${quote.rfqId}: cotação ${quoteId} adjudicada → PO ${po.id}`);
    return { quote: quoteId, purchaseOrderId: po.id, po };
  }
}
