import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SerialStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSerialDto } from './dto/create-serial.dto';
import { UpdateSerialDto } from './dto/update-serial.dto';

@Injectable()
export class SerialService {
  private readonly logger = new Logger(SerialService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Create ──────────────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateSerialDto, _userId?: string) {
    return this.prisma.serialNumber.create({
      data: {
        companyId,
        serial: dto.serial,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        status: dto.status ?? SerialStatus.IN_STOCK,
        productionOrderId: dto.productionOrderId,
        observations: dto.observations,
      },
    });
  }

  // ─── List ────────────────────────────────────────────────────────────────

  async list(
    companyId: string,
    opts: {
      status?: SerialStatus;
      productId?: string;
      warehouseId?: string;
      search?: string;
    } = {},
  ) {
    return this.prisma.serialNumber.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.productId ? { productId: opts.productId } : {}),
        ...(opts.warehouseId ? { warehouseId: opts.warehouseId } : {}),
        ...(opts.search
          ? { serial: { contains: opts.search, mode: 'insensitive' } }
          : {}),
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── GetById ─────────────────────────────────────────────────────────────

  async getById(id: string, companyId: string) {
    const serial = await this.prisma.serialNumber.findFirst({
      where: { id, companyId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        productionOrder: { select: { id: true, status: true } },
        salesOrder: { select: { id: true, status: true } },
      },
    });
    if (!serial) throw new NotFoundException(`SerialNumber ${id} não encontrado`);
    return serial;
  }

  // ─── GetBySerial ──────────────────────────────────────────────────────────

  async getBySerial(serial: string, companyId: string) {
    const found = await this.prisma.serialNumber.findFirst({
      where: { serial, companyId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        productionOrder: { select: { id: true, status: true } },
        salesOrder: { select: { id: true, status: true } },
      },
    });
    if (!found) throw new NotFoundException(`Série "${serial}" não encontrada`);
    return found;
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  async update(id: string, companyId: string, dto: UpdateSerialDto) {
    await this.getById(id, companyId);
    return this.prisma.serialNumber.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.warehouseId !== undefined ? { warehouseId: dto.warehouseId } : {}),
        ...(dto.observations !== undefined ? { observations: dto.observations } : {}),
        ...(dto.engravingStartedAt !== undefined
          ? { engravingStartedAt: new Date(dto.engravingStartedAt) }
          : {}),
        ...(dto.engravingDoneAt !== undefined
          ? { engravingDoneAt: new Date(dto.engravingDoneAt) }
          : {}),
        ...(dto.engravingOperator !== undefined
          ? { engravingOperator: dto.engravingOperator }
          : {}),
      },
    });
  }

  // ─── LinkToProduction ────────────────────────────────────────────────────

  async linkToProduction(
    serialId: string,
    productionOrderId: string,
    companyId: string,
  ) {
    const serial = await this.getById(serialId, companyId);
    if (serial.status !== SerialStatus.IN_STOCK) {
      throw new BadRequestException(
        `Série ${serial.serial} não está em estoque (status: ${serial.status})`,
      );
    }
    return this.prisma.serialNumber.update({
      where: { id: serialId },
      data: {
        productionOrderId,
        status: SerialStatus.IN_PRODUCTION,
        producedAt: new Date(),
      },
    });
  }

  // ─── LinkToSale ───────────────────────────────────────────────────────────

  async linkToSale(
    serialId: string,
    salesOrderId: string,
    companyId: string,
  ) {
    const serial = await this.getById(serialId, companyId);
    if (serial.status !== SerialStatus.IN_STOCK) {
      throw new BadRequestException(
        `Série ${serial.serial} não está em estoque (status: ${serial.status})`,
      );
    }
    return this.prisma.serialNumber.update({
      where: { id: serialId },
      data: {
        salesOrderId,
        status: SerialStatus.SOLD,
        soldAt: new Date(),
      },
    });
  }

  // ─── Scrap ────────────────────────────────────────────────────────────────

  async scrap(id: string, companyId: string, reason?: string) {
    await this.getById(id, companyId);
    return this.prisma.serialNumber.update({
      where: { id },
      data: {
        status: SerialStatus.SCRAPPED,
        ...(reason !== undefined ? { observations: reason } : {}),
      },
    });
  }

  // ─── GetStats ─────────────────────────────────────────────────────────────

  async getStats(companyId: string) {
    const [total, grouped, recentlyProduced] = await Promise.all([
      this.prisma.serialNumber.count({ where: { companyId } }),
      this.prisma.serialNumber.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.serialNumber.findMany({
        where: { companyId, producedAt: { not: null } },
        orderBy: { producedAt: 'desc' },
        take: 10,
        include: {
          product: { select: { sku: true, name: true } },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {
      IN_PRODUCTION: 0,
      IN_STOCK: 0,
      SOLD: 0,
      TRANSFERRED: 0,
      SCRAPPED: 0,
    };
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
    }

    return { total, byStatus, recentlyProduced };
  }

  // ─── Auto-geração de seriais na conclusão da OP (#176) ───────────────────

  async generateForProduction(
    companyId: string,
    productionOrderId: string,
    productId: string,
    warehouseId: string,
    qty: number,
  ): Promise<{ generated: number; serials: string[] }> {
    // Verifica se produto rastreia serial
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { tracksSerial: true, sku: true },
    });

    if (!product?.tracksSerial) {
      return { generated: 0, serials: [] };
    }

    const year = new Date().getFullYear();
    const prefix = `${product.sku}-${year}`;

    // Busca o último serial com este prefixo para continuar a sequência
    const lastSerial = await this.prisma.serialNumber.findFirst({
      where: { serial: { startsWith: prefix } },
      orderBy: { serial: 'desc' },
      select: { serial: true },
    });

    let nextSeq = 1;
    if (lastSerial) {
      const parts = lastSerial.serial.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) nextSeq = lastNum + 1;
    }

    const serials: string[] = [];
    const data = [];

    for (let i = 0; i < qty; i++) {
      const serial = `${prefix}-${String(nextSeq + i).padStart(6, '0')}`;
      serials.push(serial);
      data.push({
        companyId,
        serial,
        productId,
        warehouseId,
        status: 'IN_STOCK' as SerialStatus,
        productionOrderId,
        producedAt: new Date(),
      });
    }

    await this.prisma.serialNumber.createMany({ data });

    // Busca IDs dos seriais recém-criados para rastreabilidade (#186)
    const created = await this.prisma.serialNumber.findMany({
      where: { productionOrderId, serial: { in: serials } },
      select: { id: true },
    });

    this.logger.log(
      `Gerados ${qty} seriais para OP ${productionOrderId}: ${serials[0]} → ${serials[serials.length - 1]}`,
    );

    return { generated: qty, serials, serialIds: created.map((s) => s.id) };
  }

  // ─── Auto-vinculação de seriais no faturamento (#176) ────────────────────

  async assignForSale(
    companyId: string,
    salesOrderId: string,
    items: Array<{ saleItemId: string; productId: string; quantity: number }>,
  ): Promise<{ assigned: number; details: Array<{ saleItemId: string; serialId: string; serial: string }> }> {
    const details: Array<{ saleItemId: string; serialId: string; serial: string }> = [];

    for (const item of items) {
      // Verifica se produto rastreia serial
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, companyId },
        select: { tracksSerial: true },
      });

      if (!product?.tracksSerial) continue;

      // Para itens com serial, qty geralmente é 1 (reboque/chassi),
      // mas suporta múltiplos
      const qty = Math.floor(item.quantity);
      const availableSerials = await this.prisma.serialNumber.findMany({
        where: {
          companyId,
          productId: item.productId,
          status: 'IN_STOCK',
        },
        take: qty,
        orderBy: { createdAt: 'asc' }, // FIFO
      });

      for (const sn of availableSerials) {
        await this.prisma.serialNumber.update({
          where: { id: sn.id },
          data: {
            salesOrderId,
            status: 'SOLD' as SerialStatus,
            soldAt: new Date(),
          },
        });

        // Vincula serial ao item da venda
        await this.prisma.saleItem.update({
          where: { id: item.saleItemId },
          data: { serialNumberId: sn.id },
        });

        details.push({ saleItemId: item.saleItemId, serialId: sn.id, serial: sn.serial });
      }
    }

    this.logger.log(`Vinculados ${details.length} seriais à OV ${salesOrderId}`);
    return { assigned: details.length, details };
  }

  // ─── Rastreabilidade componente ↔ chassi (#186) ───────────────────────────

  async registerComponents(
    serialId: string,
    productionOrderId: string,
    components: { componentProductId: string; batchId?: string; quantity: number }[],
  ) {
    if (components.length === 0) return { registered: 0 };

    await this.prisma.serialComponent.createMany({
      data: components.map((c) => ({
        serialId,
        componentProductId: c.componentProductId,
        batchId: c.batchId ?? null,
        quantity: c.quantity,
        productionOrderId,
      })),
    });

    this.logger.log(`Registrados ${components.length} componentes no serial ${serialId}`);
    return { registered: components.length };
  }

  async getComponents(serialId: string, companyId: string) {
    const serial = await this.prisma.serialNumber.findFirst({
      where: { id: serialId, companyId },
    });
    if (!serial) throw new NotFoundException(`Serial ${serialId} não encontrado`);

    return this.prisma.serialComponent.findMany({
      where: { serialId },
      include: {
        componentProduct: { select: { id: true, sku: true, name: true, unit: true } },
        batch: { select: { id: true, batchNumber: true, status: true, supplierId: true } },
      },
      orderBy: { consumedAt: 'asc' },
    });
  }

  async getComponentTree(serialId: string, companyId: string) {
    const serial = await this.prisma.serialNumber.findFirst({
      where: { id: serialId, companyId },
      include: { product: { select: { id: true, sku: true, name: true } } },
    });
    if (!serial) throw new NotFoundException(`Serial ${serialId} não encontrado`);

    const components = await this.prisma.serialComponent.findMany({
      where: { serialId },
      include: {
        componentProduct: { select: { id: true, sku: true, name: true, unit: true } },
        batch: {
          select: {
            id: true, batchNumber: true, status: true,
            supplier: { select: { id: true, name: true, cnpj: true } },
          },
        },
      },
    });

    return {
      serial: serial.serial,
      product: serial.product,
      producedAt: serial.producedAt,
      components: components.map((c) => ({
        product: c.componentProduct,
        quantity: Number(c.quantity),
        batch: c.batch ? {
          batchNumber: c.batch.batchNumber,
          status: c.batch.status,
          supplier: (c.batch as any).supplier,
        } : null,
        consumedAt: c.consumedAt,
      })),
    };
  }

  async getAffectedSerials(batchId: string, companyId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, companyId },
      select: { id: true, batchNumber: true, productId: true },
    });
    if (!batch) throw new NotFoundException(`Lote ${batchId} não encontrado`);

    const components = await this.prisma.serialComponent.findMany({
      where: { batchId },
      include: {
        serial: {
          select: { id: true, serial: true, status: true, productId: true,
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });

    const serials = components.map((c) => ({
      serialId: c.serial.id,
      serial: c.serial.serial,
      status: c.serial.status,
      product: c.serial.product,
      quantityUsed: Number(c.quantity),
      consumedAt: c.consumedAt,
    }));

    return {
      batch: { id: batch.id, batchNumber: batch.batchNumber },
      affectedCount: serials.length,
      serials,
    };
  }
}
