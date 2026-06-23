import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalClientService } from './fiscal-client.service';
import {
  buildNFCePayload,
  buildNFePayload,
  buildTransferNFePayload,
  calcTotalValue,
  FiscalItem,
  FiscalPayloadInput,
} from './fiscal-mapper';

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FiscalClientService,
  ) {}

  // ─── S08.03: Emitir NF para venda confirmada ──────────────────────────────

  async emitForSale(
    salesOrderId: string,
    type: FiscalDocumentType = FiscalDocumentType.NFCE,
  ): Promise<void> {
    // Evita duplicata — se já existe, não emite novamente
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { salesOrderId },
    });
    if (existing && existing.status !== FiscalStatus.REJECTED && existing.status !== FiscalStatus.ERROR) {
      this.logger.warn(`Documento fiscal já existe para OV ${salesOrderId}: status=${existing.status}`);
      return;
    }

    // Buscar OV completa com relações necessárias
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: {
        company: true,
        customer: true,
        items: { include: { product: true } },
      },
    });

    if (!order) {
      this.logger.error(`OV ${salesOrderId} não encontrada para emissão fiscal`);
      return;
    }

    const ref = `GDR-SO-${salesOrderId}`;

    // Criar ou atualizar FiscalDocument em PENDING
    const fiscalDoc = existing
      ? await this.prisma.fiscalDocument.update({
          where: { salesOrderId },
          data: {
            status: FiscalStatus.PENDING,
            retryCount: { increment: 1 },
            lastError: null,
            rejectionCode: null,
            rejectionReason: null,
          },
        })
      : await this.prisma.fiscalDocument.create({
          data: {
            companyId: order.companyId,
            salesOrderId,
            type,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId: order.companyId,
        entity: 'FiscalDocument',
        action: 'EMIT',
        payload: { fiscalDocumentId: fiscalDoc.id, salesOrderId, type, ref },
      },
    });

    // Montar payload
    const items: FiscalItem[] = order.items.map((i) => ({
      sku: i.product.sku,
      name: i.product.name,
      ncm: i.product.ncm ?? '00000000',
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      unit: i.product.unit,
    }));

    const totalValue = calcTotalValue(items);

    const input: FiscalPayloadInput = {
      ref,
      emitter: {
        cnpj: order.company.cnpj,
        name: order.company.razaoSocial ?? order.company.name,
        ie: order.company.ie ?? undefined,
        crt: order.company.crt ?? undefined,
        address: order.company.street ?? 'Endereço não cadastrado',
        number: order.company.number ?? undefined,
        complement: order.company.complement ?? undefined,
        neighborhood: order.company.neighborhood ?? undefined,
        city: order.company.city ?? 'Cidade',
        state: order.company.state ?? 'SP',
        zipCode: order.company.zipCode ?? undefined,
        ibgeCode: order.company.ibgeCode ?? undefined,
        phone: order.company.phone ?? undefined,
      },
      recipient: order.customer
        ? {
            name: order.customer.name,
            document: order.customer.document ?? undefined,
            state: order.customer.state ?? undefined,
          }
        : undefined,
      items,
      totalValue,
    };

    const payload = type === FiscalDocumentType.NFE ? buildNFePayload(input) : buildNFCePayload(input);

    // Enviar para Focus NFe
    const response =
      type === FiscalDocumentType.NFE
        ? await this.client.emitNFe(ref, payload)
        : await this.client.emitNFCe(ref, payload);

    // Processar resposta e atualizar status
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  // ─── S08.04: Webhook — atualização assíncrona da Focus ────────────────────

  async handleWebhook(body: Record<string, unknown>): Promise<void> {
    const ref = body.ref as string | undefined;
    if (!ref) {
      this.logger.warn('Webhook recebido sem campo ref');
      return;
    }

    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { focusRef: ref },
    });

    if (!doc) {
      this.logger.warn(`Webhook: documento fiscal não encontrado para ref=${ref}`);
      return;
    }

    // Idempotência: se já autorizado, não sobrescreve
    if (doc.status === FiscalStatus.AUTHORIZED) {
      this.logger.log(`Webhook ignorado — documento ${doc.id} já está AUTHORIZED`);
      return;
    }

    await this.applyFocusResponse(doc.id, body as any);

    await this.prisma.auditLog.create({
      data: {
        companyId: doc.companyId,
        entity: 'FiscalDocument',
        action: 'WEBHOOK',
        payload: { fiscalDocumentId: doc.id, ref, status: body.status as string },
      },
    });
  }

  // ─── S08.05: Reprocessar rejeição ────────────────────────────────────────

  async retry(id: string, companyId: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
    });

    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);

    if (doc.status !== FiscalStatus.REJECTED && doc.status !== FiscalStatus.ERROR) {
      throw new BadRequestException(
        `Documento não pode ser reprocessado. Status atual: ${doc.status}`,
      );
    }

    await this.emitForSale(doc.salesOrderId, doc.type);
  }

  // ─── S10: Emitir NF-e de transferência ───────────────────────────────────

  async emitForTransfer(storeTransferId: string): Promise<void> {
    // Idempotência
    const existing = await this.prisma.fiscalDocument.findUnique({
      where: { storeTransferId },
    });
    if (existing && existing.status !== FiscalStatus.REJECTED && existing.status !== FiscalStatus.ERROR) {
      this.logger.warn(`NF-e de transferência já existe para ${storeTransferId}: status=${existing.status}`);
      return;
    }

    const transfer = await this.prisma.storeTransfer.findUnique({
      where: { id: storeTransferId },
      include: {
        company: true,
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: true } },
      },
    });

    if (!transfer) {
      this.logger.error(`Transferência ${storeTransferId} não encontrada para emissão fiscal`);
      return;
    }

    const ref = `GDR-TR-${storeTransferId}`;

    const fiscalDoc = existing
      ? await this.prisma.fiscalDocument.update({
          where: { storeTransferId },
          data: { status: FiscalStatus.PENDING, retryCount: { increment: 1 }, lastError: null },
        })
      : await this.prisma.fiscalDocument.create({
          data: {
            companyId: transfer.companyId,
            storeTransferId,
            type: FiscalDocumentType.NFE,
            status: FiscalStatus.PENDING,
            focusRef: ref,
          },
        });

    await this.prisma.auditLog.create({
      data: {
        companyId: transfer.companyId,
        entity: 'FiscalDocument',
        action: 'EMIT_TRANSFER',
        payload: { fiscalDocumentId: fiscalDoc.id, storeTransferId, ref },
      },
    });

    const items: FiscalItem[] = transfer.items.map((i) => ({
      sku: i.product.sku,
      name: i.product.name,
      ncm: i.product.ncm ?? '00000000',
      quantity: Number(i.quantity),
      unitPrice: Number(i.product.avgCost ?? i.product.costPrice ?? 0),
      unit: String(i.unit),
    }));

    const totalValue = calcTotalValue(items);

    const input: FiscalPayloadInput = {
      ref,
      emitter: {
        cnpj: transfer.company.cnpj,
        name: transfer.company.razaoSocial ?? transfer.company.name,
        ie: transfer.company.ie ?? undefined,
        crt: transfer.company.crt ?? undefined,
        address: transfer.company.street ?? 'Endereço não cadastrado',
        number: transfer.company.number ?? undefined,
        complement: transfer.company.complement ?? undefined,
        neighborhood: transfer.company.neighborhood ?? undefined,
        city: transfer.company.city ?? 'Cidade',
        state: transfer.company.state ?? 'SP',
        zipCode: transfer.company.zipCode ?? undefined,
        ibgeCode: transfer.company.ibgeCode ?? undefined,
        phone: transfer.company.phone ?? undefined,
      },
      recipient: {
        name: transfer.toWarehouse.name,
        state: 'SP',
      },
      items,
      totalValue,
    };

    const payload = buildTransferNFePayload(input);
    const response = await this.client.emitNFe(ref, payload);
    await this.applyFocusResponse(fiscalDoc.id, response);
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  async findAll(companyId: string) {
    return this.prisma.fiscalDocument.findMany({
      where: { companyId },
      include: { salesOrder: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
      include: { salesOrder: { include: { items: { include: { product: true } }, customer: true } } },
    });
    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);
    return doc;
  }

  // ─── Privado: aplica resposta da Focus ───────────────────────────────────

  private async applyFocusResponse(
    fiscalDocId: string,
    response: { status: string; chave_nfe?: string; xml?: string; motivo?: string; codigo?: string },
  ): Promise<void> {
    const statusMap: Record<string, FiscalStatus> = {
      autorizado: FiscalStatus.AUTHORIZED,
      processando_autorizacao: FiscalStatus.PROCESSING,
      rejeitado: FiscalStatus.REJECTED,
      cancelado: FiscalStatus.CANCELLED,
      erro: FiscalStatus.ERROR,
    };

    const newStatus = statusMap[response.status] ?? FiscalStatus.ERROR;

    await this.prisma.fiscalDocument.update({
      where: { id: fiscalDocId },
      data: {
        status: newStatus,
        chave: response.chave_nfe ?? null,
        xml: response.xml ?? null,
        rejectionCode: response.codigo ?? null,
        rejectionReason: newStatus === FiscalStatus.REJECTED ? (response.motivo ?? null) : null,
        lastError: newStatus === FiscalStatus.ERROR ? (response.motivo ?? null) : null,
      },
    });

    this.logger.log(`FiscalDocument ${fiscalDocId} → ${newStatus}`);
  }
}
