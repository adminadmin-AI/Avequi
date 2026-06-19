import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QuotationStatus, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

@Injectable()
export class QuotationService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── S28A.01: Criar orçamento em rascunho ────────────────────────────────

  async create(companyId: string, dto: CreateQuotationDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.create({
        data: {
          companyId,
          customerId: dto.customerId,
          warehouseId: dto.warehouseId,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          notes: dto.notes,
          discount: dto.discount ?? 0,
          createdById: userId,
          status: QuotationStatus.DRAFT,
          items: {
            create: dto.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount ?? 0,
              unit: item.unit ?? 'UN',
            })),
          },
        },
        include: {
          items: { include: { product: { select: { sku: true, name: true } } } },
          customer: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      });
      return quotation;
    });
  }

  // ─── S28A.02: Listar orçamentos ──────────────────────────────────────────

  async list(
    companyId: string,
    opts: { status?: QuotationStatus; customerId?: string } = {},
  ) {
    const quotations = await this.prisma.quotation.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        items: { select: { id: true, unitPrice: true, quantity: true, discount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return quotations.map((q) => {
      const globalDiscount = Number(q.discount);
      const total = q.items.reduce((sum, item) => {
        const itemPrice =
          Number(item.unitPrice) *
          Number(item.quantity) *
          (1 - Number(item.discount) / 100) *
          (1 - globalDiscount / 100);
        return sum + itemPrice;
      }, 0);

      return {
        id: q.id,
        status: q.status,
        customer: q.customer,
        warehouse: q.warehouse,
        discount: q.discount,
        validUntil: q.validUntil,
        itemCount: q.items.length,
        total,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      };
    });
  }

  // ─── S28A.03: Buscar orçamento por ID ────────────────────────────────────

  async getById(id: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
      include: {
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
        customer: { select: { id: true, name: true, document: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    return quotation;
  }

  // ─── S28A.04: Atualizar orçamento (somente DRAFT) ────────────────────────

  async update(id: string, companyId: string, dto: UpdateQuotationDto) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        `Orçamento só pode ser editado em DRAFT. Status atual: ${quotation.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.items !== undefined) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
        await tx.quotationItem.createMany({
          data: dto.items.map((item) => ({
            quotationId: id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount ?? 0,
            unit: item.unit ?? 'UN',
          })),
        });
      }

      return tx.quotation.update({
        where: { id },
        data: {
          ...(dto.validUntil !== undefined
            ? { validUntil: new Date(dto.validUntil) }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.discount !== undefined ? { discount: dto.discount } : {}),
        },
        include: {
          items: { include: { product: { select: { sku: true, name: true } } } },
          customer: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      });
    });
  }

  // ─── S28A.05: Enviar (DRAFT → SENT) ──────────────────────────────────────

  async send(id: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        `Orçamento deve estar em DRAFT para ser enviado. Status atual: ${quotation.status}`,
      );
    }

    return this.prisma.quotation.update({
      where: { id },
      data: { status: QuotationStatus.SENT, sentAt: new Date() },
    });
  }

  // ─── S28A.06: Aprovar (SENT → APPROVED) ──────────────────────────────────

  async approve(id: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (quotation.status !== QuotationStatus.SENT) {
      throw new BadRequestException(
        `Orçamento deve estar em SENT para ser aprovado. Status atual: ${quotation.status}`,
      );
    }

    return this.prisma.quotation.update({
      where: { id },
      data: { status: QuotationStatus.APPROVED, approvedAt: new Date() },
    });
  }

  // ─── S28A.07: Rejeitar (SENT/APPROVED → REJECTED) ────────────────────────

  async reject(id: string, companyId: string, dto: RejectQuotationDto) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (
      quotation.status !== QuotationStatus.SENT &&
      quotation.status !== QuotationStatus.APPROVED
    ) {
      throw new BadRequestException(
        `Orçamento deve estar em SENT ou APPROVED para ser rejeitado. Status atual: ${quotation.status}`,
      );
    }

    return this.prisma.quotation.update({
      where: { id },
      data: {
        status: QuotationStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: dto.rejectionReason,
      },
    });
  }

  // ─── S28A.08: Converter em OV (APPROVED → CONVERTED) ─────────────────────

  async convert(id: string, companyId: string, userId?: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (quotation.status !== QuotationStatus.APPROVED) {
      throw new BadRequestException(
        `Orçamento deve estar APPROVED para conversão. Status atual: ${quotation.status}`,
      );
    }
    if (quotation.salesOrderId) {
      throw new BadRequestException('Orçamento já foi convertido em Ordem de Venda');
    }

    const globalDiscount = Number(quotation.discount);

    return this.prisma.$transaction(async (tx) => {
      const salesOrder = await tx.salesOrder.create({
        data: {
          companyId,
          customerId: quotation.customerId,
          warehouseId: quotation.warehouseId,
          createdById: userId,
          notes: quotation.notes,
          status: SalesOrderStatus.DRAFT,
          items: {
            create: quotation.items.map((item) => {
              const itemDiscount = Number(item.discount);
              const effectivePrice =
                Number(item.unitPrice) *
                (1 - itemDiscount / 100) *
                (1 - globalDiscount / 100);
              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: effectivePrice,
                unit: item.unit,
              };
            }),
          },
        },
        include: {
          items: { include: { product: true } },
          customer: true,
          warehouse: true,
        },
      });

      const updatedQuotation = await tx.quotation.update({
        where: { id },
        data: {
          status: QuotationStatus.CONVERTED,
          salesOrderId: salesOrder.id,
        },
      });

      return { quotation: updatedQuotation, salesOrder };
    });
  }

  // ─── S28A.09: Expirar (SENT/APPROVED → EXPIRED) ──────────────────────────

  async expire(id: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (
      quotation.status !== QuotationStatus.SENT &&
      quotation.status !== QuotationStatus.APPROVED
    ) {
      throw new BadRequestException(
        `Orçamento deve estar em SENT ou APPROVED para expirar. Status atual: ${quotation.status}`,
      );
    }

    return this.prisma.quotation.update({
      where: { id },
      data: { status: QuotationStatus.EXPIRED },
    });
  }

  // ─── S28A.10: Excluir (somente DRAFT) ────────────────────────────────────

  async delete(id: string, companyId: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId },
    });

    if (!quotation) throw new NotFoundException(`Orçamento ${id} não encontrado`);
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        `Apenas orçamentos em DRAFT podem ser excluídos. Status atual: ${quotation.status}`,
      );
    }

    await this.prisma.quotation.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── S28A.11: Estatísticas ────────────────────────────────────────────────

  async getStats(companyId: string) {
    const counts = await this.prisma.quotation.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { id: true },
    });

    const countMap: Record<string, number> = {};
    for (const row of counts) {
      countMap[row.status] = row._count.id;
    }

    const total = Object.values(countMap).reduce((a, b) => a + b, 0);
    const draft = countMap[QuotationStatus.DRAFT] ?? 0;
    const sent = countMap[QuotationStatus.SENT] ?? 0;
    const approved = countMap[QuotationStatus.APPROVED] ?? 0;
    const rejected = countMap[QuotationStatus.REJECTED] ?? 0;
    const expired = countMap[QuotationStatus.EXPIRED] ?? 0;
    const converted = countMap[QuotationStatus.CONVERTED] ?? 0;

    const eligible = approved + rejected + expired + converted;
    const conversionRate = eligible > 0 ? (converted / eligible) * 100 : 0;

    return {
      total,
      draft,
      sent,
      approved,
      rejected,
      expired,
      converted,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }
}
