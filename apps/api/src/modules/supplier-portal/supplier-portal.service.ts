import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierTokenDto } from './dto/create-supplier-token.dto';
import { PurchaseOrderStatus } from '@prisma/client';

@Injectable()
export class SupplierPortalService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Admin methods ────────────────────────────────────────────────────────────

  async createToken(companyId: string, dto: CreateSupplierTokenDto) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId },
    });
    if (!supplier) {
      throw new NotFoundException('Fornecedor não encontrado');
    }

    return this.prisma.supplierToken.create({
      data: {
        supplierId: dto.supplierId,
        description: dto.description,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async listTokens(companyId: string, supplierId?: string) {
    return this.prisma.supplierToken.findMany({
      where: {
        supplier: { companyId },
        ...(supplierId ? { supplierId } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeToken(tokenId: string, companyId: string) {
    const tokenRecord = await this.prisma.supplierToken.findFirst({
      where: { id: tokenId, supplier: { companyId } },
    });
    if (!tokenRecord) {
      throw new NotFoundException('Token não encontrado');
    }

    return this.prisma.supplierToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  // ── Portal methods ───────────────────────────────────────────────────────────

  async getProfile(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        cnpj: true,
        email: true,
        leadTimeDays: true,
      },
    });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado');
    return supplier;
  }

  async listPurchaseOrders(
    supplierId: string,
    opts: { status?: PurchaseOrderStatus },
  ) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        supplierId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: {
        items: {
          include: {
            product: { select: { sku: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPurchaseOrder(supplierId: string, poId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: poId, supplierId },
      include: {
        items: {
          include: {
            product: { select: { sku: true, name: true } },
          },
        },
        receipts: {
          include: {
            items: {
              include: {
                product: { select: { sku: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundException('Pedido de compra não encontrado');
    return po;
  }

  async listReceipts(supplierId: string) {
    return this.prisma.goodsReceipt.findMany({
      where: {
        purchaseOrder: { supplierId },
      },
      include: {
        purchaseOrder: { select: { id: true, status: true } },
        items: {
          include: {
            product: { select: { sku: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPayments(supplierId: string) {
    return this.prisma.financialEntry.findMany({
      where: {
        type: 'PAYABLE',
        purchaseOrder: { supplierId },
      },
      select: {
        id: true,
        amount: true,
        dueDate: true,
        status: true,
        paidAt: true,
        description: true,
        purchaseOrderId: true,
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async listNcrs(supplierId: string) {
    return this.prisma.nonConformance.findMany({
      where: { supplierId },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPortalSummary(supplierId: string) {
    const [pendingOrders, openNcrs, pendingPayments, overduePayments] =
      await Promise.all([
        this.prisma.purchaseOrder.count({
          where: { supplierId, status: 'APPROVED' },
        }),
        this.prisma.nonConformance.count({
          where: {
            supplierId,
            status: { in: ['OPEN', 'UNDER_ANALYSIS'] },
          },
        }),
        this.prisma.financialEntry.count({
          where: {
            type: 'PAYABLE',
            purchaseOrder: { supplierId },
            status: { in: ['OPEN', 'OVERDUE'] },
          },
        }),
        this.prisma.financialEntry.count({
          where: {
            type: 'PAYABLE',
            purchaseOrder: { supplierId },
            status: 'OVERDUE',
          },
        }),
      ]);

    return {
      pendingOrders,
      openNcrs,
      pendingPayments,
      overduePayments,
    };
  }
}
