import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bull';
import type { RenaveOperation } from '@prisma/client';
import {
  RenaveOperationStatus,
  RenaveOperationType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BIN_REGISTERED_EVENT, BinRegisteredEvent } from './events/bin-registered.event';
import {
  VEHICLE_JOB_ATPV_EMAIL,
  VEHICLE_JOB_ATPV_PDF,
  VEHICLE_JOB_BIN_REGISTER,
  VEHICLE_JOB_CANCEL_SALE_OUT,
  VEHICLE_JOB_OPTS,
  VEHICLE_JOB_RETURN_MANUFACTURER,
  VEHICLE_JOB_SALE_OUT,
  VEHICLE_JOB_STOCK_IN,
  VEHICLE_QUEUE,
  VehicleJobPayload,
} from './renave.types';

/** job Bull correspondente a cada tipo de operação do ledger */
const JOB_BY_TYPE: Record<RenaveOperationType, string> = {
  BIN_REGISTER: VEHICLE_JOB_BIN_REGISTER,
  STOCK_IN: VEHICLE_JOB_STOCK_IN,
  SALE_OUT: VEHICLE_JOB_SALE_OUT,
  ATPVE_PDF: VEHICLE_JOB_ATPV_PDF,
  CANCEL_SALE_OUT: VEHICLE_JOB_CANCEL_SALE_OUT,
  RETURN_MANUFACTURER: VEHICLE_JOB_RETURN_MANUFACTURER,
};

/** status de sucesso de cada tipo (máquina de estados do ledger, #532) */
const SUCCESS_BY_TYPE: Record<RenaveOperationType, RenaveOperationStatus> = {
  BIN_REGISTER: RenaveOperationStatus.REGISTERED,
  STOCK_IN: RenaveOperationStatus.STOCK_CONFIRMED,
  SALE_OUT: RenaveOperationStatus.SALE_INTENT_CREATED,
  ATPVE_PDF: RenaveOperationStatus.ACTIVE,
  // sucesso de uma reversão = a anulação valeu (ATPV-e perde validade)
  CANCEL_SALE_OUT: RenaveOperationStatus.CANCELLED,
  RETURN_MANUFACTURER: RenaveOperationStatus.CANCELLED,
};

/**
 * Orquestrador da cadeia BIN → RENAVE → ATPV-e (#529/#530/#531/#532).
 *
 * Toda operação externa passa pelo ledger RenaveOperation (#527): dedupeKey
 * garante idempotência (retry/replay não duplica chamada ao SERPRO), e o job
 * Bull carrega só o id — o processor recarrega estado do banco.
 *
 * A cadeia avança por evento/conclusão, nunca em transação com a venda:
 * falha externa NUNCA desfaz venda/devolução (padrão fiscal.listener).
 */
@Injectable()
export class RenaveOrchestratorService {
  private readonly logger = new Logger(RenaveOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue(VEHICLE_QUEUE) private readonly queue: Queue<VehicleJobPayload>,
  ) {}

  /** Flag por company (#532) — OFF por default; só a matriz liga após homologação */
  async isEnabled(companyId: string): Promise<boolean> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { renaveEnabled: true },
    });
    return company?.renaveEnabled === true;
  }

  /**
   * Garante UMA operação por dedupeKey e enfileira o job correspondente.
   * Já concluída com sucesso → no-op (retorna null). ERROR/PENDING → re-enfileira.
   */
  async ensureOperation(params: {
    companyId: string;
    type: RenaveOperationType;
    serialNumberId: string;
    salesOrderId?: string | null;
    fiscalDocumentId?: string | null;
    fiscalDocumentChave?: string | null;
  }): Promise<RenaveOperation | null> {
    const { companyId, type, serialNumberId, salesOrderId } = params;
    const dedupeKey = salesOrderId
      ? `${type}:${serialNumberId}:${salesOrderId}`
      : `${type}:${serialNumberId}`;

    const existing = await this.prisma.renaveOperation.findUnique({ where: { dedupeKey } });

    if (existing) {
      const terminal: RenaveOperationStatus[] = [
        RenaveOperationStatus.REGISTERED,
        RenaveOperationStatus.STOCK_CONFIRMED,
        RenaveOperationStatus.SALE_INTENT_CREATED,
        RenaveOperationStatus.ACTIVE,
        RenaveOperationStatus.CANCELLED,
      ];
      if (terminal.includes(existing.status)) {
        this.logger.log(`${dedupeKey}: já ${existing.status} — skip (idempotência)`);
        return null;
      }
      // PENDING/PROCESSING/ERROR: re-enfileira (job perdido/reinício do worker)
      await this.enqueue(existing);
      return existing;
    }

    const operation = await this.prisma.renaveOperation.create({
      data: {
        companyId,
        type,
        serialNumberId,
        salesOrderId: salesOrderId ?? null,
        fiscalDocumentId: params.fiscalDocumentId ?? null,
        fiscalDocumentChave: params.fiscalDocumentChave ?? null,
        dedupeKey,
        status: RenaveOperationStatus.PENDING,
      },
    });
    await this.enqueue(operation);
    return operation;
  }

  /**
   * NF-e de VENDA autorizada (#529): dispara pré-cadastro BIN de cada chassi
   * da OV. O restante da cadeia avança por evento (BIN → estoque → saída).
   */
  async startSaleFlow(
    companyId: string,
    salesOrderId: string,
    fiscalDocumentId: string,
    chave: string | null,
  ): Promise<void> {
    if (!(await this.isEnabled(companyId))) return;

    const serials = await this.prisma.serialNumber.findMany({
      where: { salesOrderId, companyId, chassi: { not: null } },
      select: { id: true, chassi: true },
    });
    if (serials.length === 0) return;

    for (const serial of serials) {
      await this.ensureOperation({
        companyId,
        type: RenaveOperationType.BIN_REGISTER,
        serialNumberId: serial.id,
        fiscalDocumentId,
        fiscalDocumentChave: chave,
      });
    }
    this.logger.log(
      `OV ${salesOrderId}: ${serials.length} chassi(s) enfileirado(s) p/ pré-cadastro BIN`,
    );
  }

  /** BIN REGISTERED (evento) → entrada de estoque RENAVE 0km (#530) */
  async startStockIn(companyId: string, serialNumberId: string): Promise<void> {
    if (!(await this.isEnabled(companyId))) return;
    await this.ensureOperation({
      companyId,
      type: RenaveOperationType.STOCK_IN,
      serialNumberId,
    });
  }

  /**
   * Devolução/cancelamento da venda (#531, cenário A — default): cancela a
   * saída de estoque de cada chassi com intenção de venda criada.
   */
  async cancelSaleFlow(companyId: string, salesOrderId: string): Promise<void> {
    if (!(await this.isEnabled(companyId))) return;

    const saleOuts = await this.prisma.renaveOperation.findMany({
      where: {
        companyId,
        salesOrderId,
        type: RenaveOperationType.SALE_OUT,
        status: {
          in: [RenaveOperationStatus.SALE_INTENT_CREATED, RenaveOperationStatus.ACTIVE],
        },
      },
      select: { serialNumberId: true },
    });

    for (const { serialNumberId } of saleOuts) {
      await this.ensureOperation({
        companyId,
        type: RenaveOperationType.CANCEL_SALE_OUT,
        serialNumberId,
        salesOrderId,
      });
    }
  }

  /**
   * Cenário B (#531) — devolução entre estabelecimentos: exige a chave da
   * NF-e de DEVOLUÇÃO. Disparo manual (endpoint), nunca automático.
   */
  async returnToManufacturer(
    companyId: string,
    salesOrderId: string,
    serialNumberId: string,
    chaveNfeDevolucao: string,
  ): Promise<RenaveOperation | null> {
    if (!/^\d{44}$/.test(chaveNfeDevolucao)) {
      throw new BadRequestException('chaveNfeDevolucao deve ter 44 dígitos');
    }
    return this.ensureOperation({
      companyId,
      type: RenaveOperationType.RETURN_MANUFACTURER,
      serialNumberId,
      salesOrderId,
      fiscalDocumentChave: chaveNfeDevolucao,
    });
  }

  /** Retry manual (#532) — só operações em ERROR (padrão fiscal.nfe.retry) */
  async retry(operationId: string, companyId: string): Promise<RenaveOperation> {
    const operation = await this.prisma.renaveOperation.findFirst({
      where: { id: operationId, companyId },
    });
    if (!operation) throw new NotFoundException('Operação não encontrada');
    if (operation.status !== RenaveOperationStatus.ERROR) {
      throw new BadRequestException(
        `Retry só é permitido em operações ERROR (atual: ${operation.status})`,
      );
    }
    await this.enqueue(operation);
    return operation;
  }

  /** Status consolidado p/ o card "Documentação veicular" da OV (#533) */
  async getSalesOrderStatus(salesOrderId: string, companyId: string) {
    const serials = await this.prisma.serialNumber.findMany({
      where: { salesOrderId, companyId, chassi: { not: null } },
      select: {
        id: true,
        chassi: true,
        binRegistration: {
          select: { id: true, status: true, binNumber: true, registeredAt: true },
        },
      },
    });
    const serialIds = serials.map((s) => s.id);
    const [operations, atpveRecords] = await Promise.all([
      this.prisma.renaveOperation.findMany({
        where: {
          companyId,
          OR: [{ salesOrderId }, { serialNumberId: { in: serialIds }, salesOrderId: null }],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          status: true,
          serialNumberId: true,
          protocol: true,
          attempt: true,
          lastError: true,
          updatedAt: true,
        },
      }),
      this.prisma.atpveRecord.findMany({
        where: { salesOrderId, companyId },
        select: {
          id: true,
          serialNumberId: true,
          status: true,
          atpveNumber: true,
          issuedAt: true,
          atpvePdfUrl: true,
        },
      }),
    ]);
    const pdfReady = await this.prisma.atpveRecord.findMany({
      where: { salesOrderId, companyId, atpvePdfData: { not: null } },
      select: { id: true },
    });
    const pdfIds = new Set(pdfReady.map((r) => r.id));
    return {
      enabled: await this.isEnabled(companyId),
      serials,
      operations,
      atpveRecords: atpveRecords.map((r) => ({ ...r, hasPdf: pdfIds.has(r.id) })),
    };
  }

  // ─── Transições chamadas pelo processor ────────────────────────────────────

  async markProcessing(operationId: string): Promise<RenaveOperation> {
    // tenant-lint: ok (job interno: operationId enfileirado pelo próprio orquestrador)
    return this.prisma.renaveOperation.update({
      where: { id: operationId },
      data: {
        status: RenaveOperationStatus.PROCESSING,
        attempt: { increment: 1 },
        lastError: null,
      },
    });
  }

  async markError(operationId: string, motivo: string): Promise<void> {
    // tenant-lint: ok (job interno: operationId enfileirado pelo próprio orquestrador)
    await this.prisma.renaveOperation.update({
      where: { id: operationId },
      data: { status: RenaveOperationStatus.ERROR, lastError: motivo.slice(0, 500) },
    });
  }

  /**
   * Sucesso da operação: grava resultado no ledger, atualiza a projeção
   * (BinRegistration/AtpveRecord) e agenda o PRÓXIMO elo da cadeia.
   */
  async completeOperation(
    operation: RenaveOperation,
    result: { protocol?: string; raw?: Record<string, unknown>; pdfBase64?: string },
  ): Promise<void> {
    await this.prisma.renaveOperation.update({
      where: { id: operation.id },
      data: {
        status: SUCCESS_BY_TYPE[operation.type],
        protocol: result.protocol ?? null,
        rawResponse: (result.raw as object) ?? undefined,
        lastError: null,
      },
    });

    switch (operation.type) {
      case RenaveOperationType.BIN_REGISTER: {
        // projeção + evento — a cadeia (STOCK_IN) avança pelo BIN_REGISTERED_EVENT,
        // que também cobre o caminho manual (PATCH /bin/:id → REGISTERED)
        await this.prisma.binRegistration.upsert({
          where: { serialNumberId: operation.serialNumberId },
          create: {
            companyId: operation.companyId,
            serialNumberId: operation.serialNumberId,
            status: 'REGISTERED',
            submittedAt: new Date(),
            registeredAt: new Date(),
            binNumber: result.protocol ?? null,
            notes: 'Pré-cadastro automático via SERPRO (#529)',
          },
          update: {
            status: 'REGISTERED',
            registeredAt: new Date(),
            binNumber: result.protocol ?? undefined,
            rejectionReason: null,
          },
        });
        this.eventEmitter.emit(
          BIN_REGISTERED_EVENT,
          new BinRegisteredEvent(operation.companyId, operation.serialNumberId),
        );
        break;
      }

      case RenaveOperationType.STOCK_IN: {
        // chassi entrou no estoque RENAVE — se a venda já tem NF-e autorizada,
        // segue direto pra saída (fluxo pós-faturamento, #530)
        const serial = await this.prisma.serialNumber.findUnique({
          where: { id: operation.serialNumberId },
          select: { salesOrderId: true },
        });
        if (!serial?.salesOrderId) break;
        const fiscalDoc = await this.prisma.fiscalDocument.findFirst({
          where: {
            salesOrderId: serial.salesOrderId,
            companyId: operation.companyId,
            direction: 'EMITIDA', // Fase 1: NF-e de venda emitida pela company
            status: 'AUTHORIZED',
          },
          select: { id: true, chave: true },
        });
        if (!fiscalDoc?.chave) break;
        await this.ensureOperation({
          companyId: operation.companyId,
          type: RenaveOperationType.SALE_OUT,
          serialNumberId: operation.serialNumberId,
          salesOrderId: serial.salesOrderId,
          fiscalDocumentId: fiscalDoc.id,
          fiscalDocumentChave: fiscalDoc.chave,
        });
        break;
      }

      case RenaveOperationType.SALE_OUT: {
        // intenção de venda criada → ATPV-e sistêmica existe; materializa a
        // projeção e busca o PDF
        if (!operation.salesOrderId) break;
        const order = await this.prisma.salesOrder.findUnique({
          where: { id: operation.salesOrderId },
          select: { customer: { select: { name: true, razaoSocial: true, document: true } } },
        });
        // sem unique composto (serial, venda) → findFirst+create (lição do repo)
        const existingAtpve = await this.prisma.atpveRecord.findFirst({
          where: {
            serialNumberId: operation.serialNumberId,
            salesOrderId: operation.salesOrderId,
          },
          select: { id: true },
        });
        if (existingAtpve) {
          await this.prisma.atpveRecord.update({
            where: { id: existingAtpve.id },
            data: { atpveNumber: result.protocol ?? undefined, status: 'PENDING' },
          });
        } else {
          await this.prisma.atpveRecord.create({
            data: {
              companyId: operation.companyId,
              serialNumberId: operation.serialNumberId,
              salesOrderId: operation.salesOrderId,
              status: 'PENDING',
              clienteCpf: order?.customer?.document ?? '',
              clienteNome: order?.customer?.razaoSocial ?? order?.customer?.name ?? '',
              atpveNumber: result.protocol ?? null,
              notes: 'Intenção de venda criada via RENAVE-WS (#530)',
            },
          });
        }
        await this.ensureOperation({
          companyId: operation.companyId,
          type: RenaveOperationType.ATPVE_PDF,
          serialNumberId: operation.serialNumberId,
          salesOrderId: operation.salesOrderId,
          fiscalDocumentId: operation.fiscalDocumentId,
          fiscalDocumentChave: operation.fiscalDocumentChave,
        });
        break;
      }

      case RenaveOperationType.ATPVE_PDF: {
        if (!operation.salesOrderId || !result.pdfBase64) break;
        await this.prisma.atpveRecord.updateMany({
          where: {
            serialNumberId: operation.serialNumberId,
            salesOrderId: operation.salesOrderId,
          },
          data: {
            status: 'ISSUED',
            issuedAt: new Date(),
            issuedBy: 'RENAVE-WS',
            atpvePdfData: Buffer.from(result.pdfBase64, 'base64'),
          },
        });
        // e-mail é best-effort: job próprio, sem entrada no ledger (#530)
        await this.queue.add(
          VEHICLE_JOB_ATPV_EMAIL,
          { operationId: operation.id },
          { ...VEHICLE_JOB_OPTS, attempts: 3 },
        );
        break;
      }

      case RenaveOperationType.CANCEL_SALE_OUT:
      case RenaveOperationType.RETURN_MANUFACTURER: {
        if (!operation.salesOrderId) break;
        await this.prisma.atpveRecord.updateMany({
          where: {
            serialNumberId: operation.serialNumberId,
            salesOrderId: operation.salesOrderId,
          },
          data: { status: 'CANCELLED' },
        });
        // anula os elos de venda do ledger p/ o chassi voltar a ser vendável
        await this.prisma.renaveOperation.updateMany({
          where: {
            serialNumberId: operation.serialNumberId,
            salesOrderId: operation.salesOrderId,
            type: { in: [RenaveOperationType.SALE_OUT, RenaveOperationType.ATPVE_PDF] },
            id: { not: operation.id },
          },
          data: { status: RenaveOperationStatus.CANCELLED },
        });
        break;
      }
    }
  }

  private async enqueue(operation: RenaveOperation): Promise<void> {
    await this.queue.add(
      JOB_BY_TYPE[operation.type],
      { operationId: operation.id },
      VEHICLE_JOB_OPTS,
    );
  }
}
