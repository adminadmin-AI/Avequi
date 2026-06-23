import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FiscalDocumentType, FiscalStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalClientService } from './fiscal-client.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { FISCAL_CANCELLED_EVENT, FiscalCancelledEvent } from './events/fiscal-cancelled.event';
import {
  buildNFCePayload,
  buildNFePayload,
  buildTransferNFePayload,
  calcTotalValue,
  FiscalItem,
  FiscalPayloadInput,
} from './fiscal-mapper';

const CANCEL_DEADLINE_HOURS = 24;

@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FiscalClientService,
    private readonly taxCalc: TaxCalculationService,
    private readonly eventEmitter: EventEmitter2,
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

    // Montar payload com cálculo tributário
    const isInterstate = order.customer?.state && order.company.state !== order.customer.state;
    const operationType = isInterstate
      ? 'VENDA_INTERESTADUAL' as any
      : 'VENDA_INTERNA' as any;

    const items: FiscalItem[] = [];
    for (const i of order.items) {
      const itemValue = Number(i.quantity) * Number(i.unitPrice);
      const taxResult = await this.taxCalc.calculateTaxes({
        companyId: order.companyId,
        operationType,
        ncm: i.product.ncm ?? undefined,
        productType: i.product.type,
        ufOrigem: order.company.state ?? 'SP',
        ufDestino: order.customer?.state ?? order.company.state ?? 'SP',
        itemValue,
      });

      items.push({
        sku: i.product.sku,
        name: i.product.name,
        ncm: i.product.ncm ?? '00000000',
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        unit: i.product.unit,
        tax: {
          cfop: taxResult.cfop,
          icmsCst: taxResult.icms.cst,
          icmsBase: taxResult.icms.baseCalculo,
          icmsAliquota: taxResult.icms.aliquota,
          icmsValor: taxResult.icms.valor,
          ipiCst: taxResult.ipi.cst,
          ipiBase: taxResult.ipi.baseCalculo,
          ipiAliquota: taxResult.ipi.aliquota,
          ipiValor: taxResult.ipi.valor,
          pisCst: taxResult.pis.cst,
          pisBase: taxResult.pis.baseCalculo,
          pisAliquota: taxResult.pis.aliquota,
          pisValor: taxResult.pis.valor,
          cofinsCst: taxResult.cofins.cst,
          cofinsBase: taxResult.cofins.baseCalculo,
          cofinsAliquota: taxResult.cofins.aliquota,
          cofinsValor: taxResult.cofins.valor,
        },
      });
    }

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

    const transferOpType = 'TRANSFERENCIA_INTERNA' as any;

    const items: FiscalItem[] = [];
    for (const i of transfer.items) {
      const unitPrice = Number(i.product.avgCost ?? i.product.costPrice ?? 0);
      const itemValue = Number(i.quantity) * unitPrice;
      const taxResult = await this.taxCalc.calculateTaxes({
        companyId: transfer.companyId,
        operationType: transferOpType,
        ncm: i.product.ncm ?? undefined,
        productType: i.product.type,
        ufOrigem: transfer.company.state ?? 'SP',
        ufDestino: transfer.company.state ?? 'SP',
        itemValue,
      });
      items.push({
        sku: i.product.sku,
        name: i.product.name,
        ncm: i.product.ncm ?? '00000000',
        quantity: Number(i.quantity),
        unitPrice,
        unit: String(i.unit),
        tax: {
          cfop: taxResult.cfop,
          icmsCst: taxResult.icms.cst, icmsBase: taxResult.icms.baseCalculo, icmsAliquota: taxResult.icms.aliquota, icmsValor: taxResult.icms.valor,
          ipiCst: taxResult.ipi.cst, ipiBase: taxResult.ipi.baseCalculo, ipiAliquota: taxResult.ipi.aliquota, ipiValor: taxResult.ipi.valor,
          pisCst: taxResult.pis.cst, pisBase: taxResult.pis.baseCalculo, pisAliquota: taxResult.pis.aliquota, pisValor: taxResult.pis.valor,
          cofinsCst: taxResult.cofins.cst, cofinsBase: taxResult.cofins.baseCalculo, cofinsAliquota: taxResult.cofins.aliquota, cofinsValor: taxResult.cofins.valor,
        },
      });
    }

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

  // ─── Cancelamento de NF-e (#164) ──────────────────────────────────────────

  async cancel(id: string, companyId: string, justificativa: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findFirst({
      where: { id, companyId },
    });

    if (!doc) throw new NotFoundException(`Documento fiscal ${id} não encontrado`);

    if (doc.status !== FiscalStatus.AUTHORIZED) {
      throw new BadRequestException(
        `Somente documentos AUTHORIZED podem ser cancelados. Status atual: ${doc.status}`,
      );
    }

    // Validar prazo de 24h
    const hoursElapsed = (Date.now() - doc.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > CANCEL_DEADLINE_HOURS) {
      throw new UnprocessableEntityException(
        `Prazo de ${CANCEL_DEADLINE_HOURS}h para cancelamento expirado (${Math.floor(hoursElapsed)}h desde a emissão). Use Carta de Correção.`,
      );
    }

    // Chamar Focus NFe para cancelamento
    const response = await this.client.cancelNFe(doc.focusRef, justificativa);

    if (response.status === 'cancelado') {
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          status: FiscalStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationJustification: justificativa,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FiscalDocument',
          action: 'CANCEL',
          payload: { fiscalDocumentId: id, justificativa },
        },
      });

      // Emitir evento para reversão de estoque e financeiro
      this.eventEmitter.emit(
        FISCAL_CANCELLED_EVENT,
        new FiscalCancelledEvent(companyId, id, doc.salesOrderId, doc.storeTransferId),
      );

      this.logger.log(`NF-e ${id} cancelada com sucesso`);
    } else {
      // Rejeição do cancelamento pela SEFAZ
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          lastError: response.motivo ?? 'Erro ao cancelar na SEFAZ',
        },
      });

      throw new BadRequestException(
        `Cancelamento rejeitado pela SEFAZ: ${response.motivo ?? 'erro desconhecido'}`,
      );
    }
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
