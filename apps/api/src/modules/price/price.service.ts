import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePriceTableDto } from './dto/create-price-table.dto';

@Injectable()
export class PriceService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePriceTableDto) {
    return this.prisma.priceTable.create({
      data: {
        companyId: dto.companyId,
        name: dto.name,
        type: (dto.type as any) ?? 'STANDARD',
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
        isDefault: dto.isDefault ?? false,
        customerId: dto.customerId,
        items: dto.items
          ? {
              create: dto.items.map((item) => ({
                productId: item.productId,
                unitPrice: item.unitPrice,
                minQuantity: item.minQuantity,
                discountPercent: item.discountPercent,
              })),
            }
          : undefined,
      },
      include: { items: { include: { product: true } }, customer: true },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.priceTable.findMany({
      where: { companyId, isActive: true },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const table = await this.prisma.priceTable.findFirst({
      where: { id, companyId },
      include: {
        items: { include: { product: true } },
        customer: true,
      },
    });
    if (!table) throw new NotFoundException(`Tabela de preços ${id} não encontrada`);
    return table;
  }

  // ─── Price Lookup (#189) ────────────────────────────────────────────────

  async lookup(
    companyId: string,
    productId: string,
    customerId?: string,
    quantity?: number,
    warehouseId?: string,
  ) {
    const now = new Date();

    // 1. Customer-specific table
    if (customerId) {
      const customerTable = await this.prisma.priceTable.findFirst({
        where: {
          companyId,
          customerId,
          isActive: true,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        include: {
          items: {
            where: { productId },
            orderBy: { minQuantity: 'desc' },
          },
        },
      });

      if (customerTable && customerTable.items.length > 0) {
        const item = this.findBestItem(customerTable.items, quantity);
        if (item) {
          return {
            source: 'CUSTOMER_SPECIFIC',
            priceTableId: customerTable.id,
            priceTableName: customerTable.name,
            unitPrice: Number(item.unitPrice),
            discountPercent: item.discountPercent ? Number(item.discountPercent) : null,
            effectivePrice: this.calcEffectivePrice(item),
          };
        }
      }
    }

    // 2. Warehouse-specific table (#224)
    if (warehouseId) {
      const warehouseTable = await this.prisma.priceTable.findFirst({
        where: {
          companyId,
          warehouseId,
          customerId: null,
          isActive: true,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        include: {
          items: {
            where: { productId },
            orderBy: { minQuantity: 'desc' },
          },
        },
        orderBy: { validFrom: 'desc' },
      });

      if (warehouseTable && warehouseTable.items.length > 0) {
        const item = this.findBestItem(warehouseTable.items, quantity);
        if (item) {
          return {
            source: 'WAREHOUSE_SPECIFIC',
            priceTableId: warehouseTable.id,
            priceTableName: warehouseTable.name,
            unitPrice: Number(item.unitPrice),
            discountPercent: item.discountPercent ? Number(item.discountPercent) : null,
            effectivePrice: this.calcEffectivePrice(item),
          };
        }
      }
    }

    // 3. Active non-default table (promotional etc)
    const activeTable = await this.prisma.priceTable.findFirst({
      where: {
        companyId,
        customerId: null,
        isDefault: false,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      include: {
        items: {
          where: { productId },
          orderBy: { minQuantity: 'desc' },
        },
      },
      orderBy: { validFrom: 'desc' },
    });

    if (activeTable && activeTable.items.length > 0) {
      const item = this.findBestItem(activeTable.items, quantity);
      if (item) {
        return {
          source: 'PROMOTIONAL',
          priceTableId: activeTable.id,
          priceTableName: activeTable.name,
          unitPrice: Number(item.unitPrice),
          discountPercent: item.discountPercent ? Number(item.discountPercent) : null,
          effectivePrice: this.calcEffectivePrice(item),
        };
      }
    }

    // 3. Default table
    const defaultTable = await this.prisma.priceTable.findFirst({
      where: {
        companyId,
        isDefault: true,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      include: {
        items: {
          where: { productId },
          orderBy: { minQuantity: 'desc' },
        },
      },
    });

    if (defaultTable && defaultTable.items.length > 0) {
      const item = this.findBestItem(defaultTable.items, quantity);
      if (item) {
        return {
          source: 'DEFAULT',
          priceTableId: defaultTable.id,
          priceTableName: defaultTable.name,
          unitPrice: Number(item.unitPrice),
          discountPercent: item.discountPercent ? Number(item.discountPercent) : null,
          effectivePrice: this.calcEffectivePrice(item),
        };
      }
    }

    // 4. Fallback: product salePrice
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { salePrice: true },
    });

    return {
      source: 'PRODUCT_DEFAULT',
      priceTableId: null,
      priceTableName: null,
      unitPrice: product?.salePrice ? Number(product.salePrice) : 0,
      discountPercent: null,
      effectivePrice: product?.salePrice ? Number(product.salePrice) : 0,
    };
  }

  private findBestItem(
    items: { minQuantity: any; unitPrice: any; discountPercent: any }[],
    quantity?: number,
  ) {
    if (!quantity) return items[items.length - 1]; // lowest minQuantity
    // Items sorted desc by minQuantity — find first where qty >= minQuantity
    for (const item of items) {
      const minQty = item.minQuantity ? Number(item.minQuantity) : 0;
      if (quantity >= minQty) return item;
    }
    return items[items.length - 1];
  }

  private calcEffectivePrice(item: { unitPrice: any; discountPercent: any }) {
    const price = Number(item.unitPrice);
    const discount = item.discountPercent ? Number(item.discountPercent) : 0;
    return Math.round(price * (1 - discount / 100) * 100) / 100;
  }
}
