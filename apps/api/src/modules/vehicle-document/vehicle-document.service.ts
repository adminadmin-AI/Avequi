import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { UpdateVehicleDocumentDto } from './dto/update-vehicle-document.dto';
import { RegisterDeliveryDto } from './dto/register-delivery.dto';

/**
 * #364 Documentos regulatórios do veículo (CAT/CCT/Projeto Técnico) por produto,
 * + rastreio de entrega por venda/chassi. Enums passados como string literal
 * (mesmo padrão do repo — o mock jest de @prisma/client não os exporta).
 */
@Injectable()
export class VehicleDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  createDocument(companyId: string, dto: CreateVehicleDocumentDto) {
    return this.prisma.vehicleDocument.create({
      data: {
        companyId,
        productId: dto.productId,
        type: dto.type as any,
        documentNumber: dto.documentNumber,
        issuedAt: new Date(dto.issuedAt),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        fileUrl: dto.fileUrl,
        status: (dto.status ?? 'ACTIVE') as any,
      },
    });
  }

  listDocuments(companyId: string, productId?: string) {
    return this.prisma.vehicleDocument.findMany({
      where: { companyId, ...(productId ? { productId } : {}) },
      // #1028 parte 2: o web resolvia o nome do produto de cada linha contra
      // o catálogo INTEIRO baixado à parte — agora que /products virou
      // combobox de busca server-side (sem catálogo completo no cliente), a
      // linha precisa trazer o nome junto (senão a coluna "Produto" quebra
      // silenciosamente para qualquer produto fora do resultado de busca atual).
      include: { product: { select: { id: true, sku: true, name: true } } },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async getDocument(companyId: string, id: string) {
    const doc = await this.prisma.vehicleDocument.findFirst({
      where: { id, companyId },
      include: { deliveries: { orderBy: { createdAt: 'desc' } } },
    });
    if (!doc) throw new NotFoundException(`Documento veicular ${id} não encontrado`);
    return doc;
  }

  async updateDocument(companyId: string, id: string, dto: UpdateVehicleDocumentDto) {
    await this.getOrThrow(companyId, id);
    return this.prisma.vehicleDocument.update({
      where: { id },
      data: {
        ...(dto.documentNumber !== undefined ? { documentNumber: dto.documentNumber } : {}),
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null } : {}),
        ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl } : {}),
      },
    });
  }

  async removeDocument(companyId: string, id: string) {
    await this.getOrThrow(companyId, id);
    return this.prisma.vehicleDocument.delete({ where: { id } });
  }

  // ─── Entrega por venda/chassi ────────────────────────────────────────────────

  async registerDelivery(companyId: string, documentId: string, dto: RegisterDeliveryDto) {
    await this.getOrThrow(companyId, documentId);
    return this.prisma.vehicleDocumentDelivery.create({
      data: {
        companyId,
        vehicleDocumentId: documentId,
        salesOrderId: dto.salesOrderId,
        serialNumberId: dto.serialNumberId ?? null,
        deliveredTo: dto.deliveredTo as any,
        deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date(),
        deliveredBy: dto.deliveredBy,
      },
    });
  }

  listDeliveriesBySale(companyId: string, salesOrderId: string) {
    return this.prisma.vehicleDocumentDelivery.findMany({
      where: { companyId, salesOrderId },
      include: { vehicleDocument: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Dashboard: vendas de veículo (itens rastreáveis) faturadas que ainda não têm
   * NENHUM documento regulatório entregue.
   */
  async salesMissingDocuments(companyId: string) {
    const vehicleSales = await this.prisma.salesOrder.findMany({
      where: {
        companyId,
        status: 'INVOICED' as any,
        items: { some: { product: { tracksSerial: true } } },
      },
      select: { id: true, invoicedAt: true, createdAt: true },
      orderBy: { invoicedAt: 'desc' },
    });
    const delivered = await this.prisma.vehicleDocumentDelivery.findMany({
      where: { companyId },
      select: { salesOrderId: true },
    });
    const withDocs = new Set(delivered.map((d) => d.salesOrderId));
    return vehicleSales.filter((s) => !withDocs.has(s.id));
  }

  private async getOrThrow(companyId: string, id: string) {
    const doc = await this.prisma.vehicleDocument.findFirst({ where: { id, companyId } });
    if (!doc) throw new NotFoundException(`Documento veicular ${id} não encontrado`);
    return doc;
  }
}
