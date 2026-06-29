import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Use string literals to avoid Prisma client cache issues with new enums
const ThreeWayMatchResult = {
  FULL_MATCH: 'FULL_MATCH' as const,
  PARTIAL_MATCH: 'PARTIAL_MATCH' as const,
  MISMATCH: 'MISMATCH' as const,
};
type ThreeWayMatchResult = (typeof ThreeWayMatchResult)[keyof typeof ThreeWayMatchResult];

export interface MatchItemDetail {
  productId: string;
  productName?: string;
  poQty: number;
  poUnitCost: number;
  grQty: number;
  nfeQty: number | null;
  nfeUnitPrice: number | null;
  qtyMatch: 'OK' | 'TOLERANCE' | 'MISMATCH';
  priceMatch: 'OK' | 'TOLERANCE' | 'MISMATCH' | 'N/A';
  qtyVariancePct: number;
  priceVariancePct: number | null;
}

export interface MatchResult {
  result: ThreeWayMatchResult;
  details: MatchItemDetail[];
  summary: {
    totalPoValue: number;
    totalGrValue: number;
    totalNfeValue: number | null;
    itemCount: number;
    fullMatchCount: number;
    toleranceCount: number;
    mismatchCount: number;
  };
}

@Injectable()
export class ThreeWayMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async executeMatch(
    purchaseOrderId: string,
    companyId: string,
    options?: { qtyTolerancePct?: number; priceTolerancePct?: number },
  ): Promise<MatchResult> {
    const qtyTolerance = options?.qtyTolerancePct ?? 0;
    const priceTolerance = options?.priceTolerancePct ?? 2;

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      include: {
        items: { include: { product: { select: { id: true, name: true, ncm: true } } } },
        receipts: { include: { items: true } },
        inboundNfes: { where: { status: { in: ['MATCHED', 'IMPORTED'] } } },
      },
    });

    if (!po) throw new NotFoundException(`PO ${purchaseOrderId} não encontrada`);

    // Aggregate GR items per product
    const grByProduct = new Map<string, number>();
    for (const receipt of po.receipts) {
      for (const item of receipt.items) {
        const current = grByProduct.get(item.productId) ?? 0;
        grByProduct.set(item.productId, current + Number(item.qtyReceived));
      }
    }

    // Get NF-e items (from parsedItems JSON)
    const latestNfe = po.inboundNfes[0] ?? null;
    const nfeItems: Array<{ ncm: string; quantity: number; unitPrice: number; totalPrice: number }> =
      latestNfe ? (latestNfe.parsedItems as any[]) : [];

    const details: MatchItemDetail[] = [];
    let totalPoValue = 0;
    let totalGrValue = 0;
    let totalNfeValue = 0;
    let fullMatchCount = 0;
    let toleranceCount = 0;
    let mismatchCount = 0;

    for (const poItem of po.items) {
      const poQty = Number(poItem.quantity);
      const poUnitCost = Number(poItem.unitCost);
      const grQty = grByProduct.get(poItem.productId) ?? 0;

      // Match NF-e item by NCM or positional fallback
      const nfeItem = nfeItems.find((n) => n.ncm === poItem.product.ncm) ?? null;
      const nfeQty = nfeItem?.quantity ?? null;
      const nfeUnitPrice = nfeItem?.unitPrice ?? null;

      // Qty variance: compare GR vs PO
      const qtyVariancePct = poQty > 0 ? Math.abs((grQty - poQty) / poQty) * 100 : (grQty > 0 ? 100 : 0);

      let qtyMatch: 'OK' | 'TOLERANCE' | 'MISMATCH';
      if (grQty === poQty && (nfeQty === null || nfeQty === poQty)) {
        qtyMatch = 'OK';
      } else if (qtyVariancePct <= qtyTolerance) {
        qtyMatch = 'TOLERANCE';
      } else {
        qtyMatch = 'MISMATCH';
      }

      // Price variance: compare NF-e unit price vs PO unit cost
      let priceMatch: 'OK' | 'TOLERANCE' | 'MISMATCH' | 'N/A' = 'N/A';
      let priceVariancePct: number | null = null;
      if (nfeUnitPrice !== null && poUnitCost > 0) {
        priceVariancePct = Math.abs((nfeUnitPrice - poUnitCost) / poUnitCost) * 100;
        if (nfeUnitPrice === poUnitCost) {
          priceMatch = 'OK';
        } else if (priceVariancePct <= priceTolerance) {
          priceMatch = 'TOLERANCE';
        } else {
          priceMatch = 'MISMATCH';
        }
      }

      // Tallies
      totalPoValue += poQty * poUnitCost;
      totalGrValue += grQty * poUnitCost;
      if (nfeItem) totalNfeValue += nfeItem.totalPrice;

      if (qtyMatch === 'OK' && (priceMatch === 'OK' || priceMatch === 'N/A')) {
        fullMatchCount++;
      } else if (qtyMatch === 'MISMATCH' || priceMatch === 'MISMATCH') {
        mismatchCount++;
      } else {
        toleranceCount++;
      }

      details.push({
        productId: poItem.productId,
        productName: poItem.product.name,
        poQty,
        poUnitCost,
        grQty,
        nfeQty,
        nfeUnitPrice,
        qtyMatch,
        priceMatch,
        qtyVariancePct: Math.round(qtyVariancePct * 100) / 100,
        priceVariancePct: priceVariancePct !== null ? Math.round(priceVariancePct * 100) / 100 : null,
      });
    }

    // Determine overall result
    let result: ThreeWayMatchResult;
    if (mismatchCount > 0) {
      result = ThreeWayMatchResult.MISMATCH;
    } else if (toleranceCount > 0) {
      result = ThreeWayMatchResult.PARTIAL_MATCH;
    } else {
      result = ThreeWayMatchResult.FULL_MATCH;
    }

    return {
      result,
      details,
      summary: {
        totalPoValue,
        totalGrValue,
        totalNfeValue: latestNfe ? totalNfeValue : null,
        itemCount: po.items.length,
        fullMatchCount,
        toleranceCount,
        mismatchCount,
      },
    };
  }

  async getMatchStatus(purchaseOrderId: string, companyId: string) {
    // Check for existing saved match
    const existing = await this.prisma.threeWayMatch.findFirst({
      where: { purchaseOrderId, companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        resolvedBy: { select: { id: true, name: true } },
      },
    });

    // Run live match
    const live = await this.executeMatch(purchaseOrderId, companyId);

    return {
      ...live,
      savedMatch: existing
        ? {
            id: existing.id,
            result: existing.result,
            resolvedBy: existing.resolvedBy,
            resolvedAt: existing.resolvedAt,
            createdAt: existing.createdAt,
          }
        : null,
    };
  }

  async saveMatch(
    purchaseOrderId: string,
    companyId: string,
    options?: { qtyTolerancePct?: number; priceTolerancePct?: number },
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId },
      include: {
        receipts: { take: 1, orderBy: { createdAt: 'desc' } },
        inboundNfes: { where: { status: { in: ['MATCHED', 'IMPORTED'] } }, take: 1 },
      },
    });

    if (!po) throw new NotFoundException(`PO ${purchaseOrderId} não encontrada`);
    if (po.receipts.length === 0) {
      throw new BadRequestException('PO não tem recebimento (GoodsReceipt) para executar match');
    }

    const matchResult = await this.executeMatch(purchaseOrderId, companyId, options);

    return this.prisma.threeWayMatch.create({
      data: {
        companyId,
        purchaseOrderId,
        goodsReceiptId: po.receipts[0].id,
        inboundNfeId: po.inboundNfes[0]?.id ?? null,
        result: matchResult.result,
        qtyTolerance: options?.qtyTolerancePct ?? 0,
        priceTolerance: options?.priceTolerancePct ?? 2,
        details: matchResult.details as any,
      },
    });
  }

  async resolveMatch(matchId: string, companyId: string, userId: string) {
    const match = await this.prisma.threeWayMatch.findFirst({
      where: { id: matchId, companyId },
    });

    if (!match) throw new NotFoundException(`Match ${matchId} não encontrado`);
    if (match.resolvedAt) {
      throw new BadRequestException('Match já foi resolvido');
    }

    return this.prisma.threeWayMatch.update({
      where: { id: matchId },
      data: { resolvedById: userId, resolvedAt: new Date() },
    });
  }
}
