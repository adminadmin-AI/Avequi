import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

/**
 * #365 Entrega pós-NF-e. Criada automaticamente ao faturar (AWAITING_BIN) e
 * avançada para AWAITING_PICKUP quando a BIN do chassi é registrada.
 * Enum DeliveryStatus via string literal (padrão do repo).
 */
@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotente: uma entrega por venda (salesOrderId @unique). */
  createOnInvoice(companyId: string, salesOrderId: string, fiscalDocumentId?: string) {
    return this.prisma.delivery.upsert({
      where: { salesOrderId },
      create: { companyId, salesOrderId, fiscalDocumentId: fiscalDocumentId ?? null, status: 'AWAITING_BIN' as any },
      update: {}, // já existe → não recria
    });
  }

  /** BIN registrada → entrega da venda desse chassi passa a AWAITING_PICKUP. */
  async advanceOnBinRegistered(companyId: string, serialNumberId: string) {
    const serial = await this.prisma.serialNumber.findFirst({
      where: { id: serialNumberId, companyId },
      select: { salesOrderId: true },
    });
    if (!serial?.salesOrderId) return { advanced: 0 };
    const res = await this.prisma.delivery.updateMany({
      where: { companyId, salesOrderId: serial.salesOrderId, status: 'AWAITING_BIN' as any },
      data: { status: 'AWAITING_PICKUP' as any },
    });
    return { advanced: res.count };
  }

  list(companyId: string, status?: string) {
    return this.prisma.delivery.findMany({
      where: { companyId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(companyId: string, id: string, dto: UpdateDeliveryStatusDto) {
    const delivery = await this.prisma.delivery.findFirst({ where: { id, companyId } });
    if (!delivery) throw new NotFoundException(`Entrega ${id} não encontrada`);
    return this.prisma.delivery.update({
      where: { id },
      data: {
        status: dto.status as any,
        ...(dto.status === 'DELIVERED' && !delivery.deliveredAt ? { deliveredAt: new Date() } : {}),
        ...(dto.scheduledDate !== undefined ? { scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null } : {}),
        ...(dto.transporterName !== undefined ? { transporterName: dto.transporterName } : {}),
        ...(dto.transporterCnpj !== undefined ? { transporterCnpj: dto.transporterCnpj } : {}),
        ...(dto.vehiclePlate !== undefined ? { vehiclePlate: dto.vehiclePlate } : {}),
        ...(dto.receivedBy !== undefined ? { receivedBy: dto.receivedBy } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }
}
