import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SerialStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSerialDto } from './dto/create-serial.dto';
import { UpdateSerialDto } from './dto/update-serial.dto';

@Injectable()
export class SerialService {
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
}
