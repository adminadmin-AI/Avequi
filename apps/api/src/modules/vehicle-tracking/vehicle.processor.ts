import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { RenaveOperationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  BIN_PORT,
  BinPort,
  RENAVE_PORT,
  RenavePort,
  VehicleProviderResponse,
} from './ports/vehicle-provider.port';
import { RenaveOrchestratorService } from './renave-orchestrator.service';
import {
  VEHICLE_JOB_ATPV_EMAIL,
  VEHICLE_JOB_ATPV_PDF,
  VEHICLE_JOB_BIN_REGISTER,
  VEHICLE_JOB_CANCEL_SALE_OUT,
  VEHICLE_JOB_RETURN_MANUFACTURER,
  VEHICLE_JOB_SALE_OUT,
  VEHICLE_JOB_STOCK_IN,
  VEHICLE_QUEUE,
  VehicleJobPayload,
} from './renave.types';

/**
 * Worker da VEHICLE_QUEUE (#532) — mesmo padrão do AuditProcessor: erro do
 * provider marca a operação ERROR e RELANÇA para o Bull re-tentar (attempts 5,
 * backoff exponencial). Job que esgota tentativas fica em ERROR no ledger,
 * visível no card da OV (#533) e elegível a retry manual; o AlertScheduler
 * dispara RENAVE_OP_FAILED (#532).
 */
@Processor(VEHICLE_QUEUE)
export class VehicleProcessor {
  private readonly logger = new Logger(VehicleProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: RenaveOrchestratorService,
    private readonly mail: MailService,
    @Inject(BIN_PORT) private readonly bin: BinPort,
    @Inject(RENAVE_PORT) private readonly renave: RenavePort,
  ) {}

  @Process(VEHICLE_JOB_BIN_REGISTER)
  async handleBinRegister(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, async (serial, operation) => {
      const company = await this.prisma.company.findUnique({
        where: { id: operation.companyId },
        select: { state: true },
      });
      return this.bin.registerVehicle({
        chassi: serial.chassi!,
        condicaoChassi: serial.condicaoVeiculo,
        ufFaturamento: company?.state ?? 'PR',
        codigoMarcaModelo: serial.codigoMarcaModelo ?? serial.product?.codigoMarcaModelo ?? '',
        corDenatran: serial.corDenatran,
        qtdEixos: serial.qtdEixos,
        anoFabricacao: serial.anoFabricacao ?? new Date().getFullYear(),
        anoModelo: serial.anoModelo ?? new Date().getFullYear(),
        especieVeiculo: serial.especieVeiculo ?? '2',
        tipoVeiculo: serial.tipoVeiculo ?? '10',
        cmt: serial.cmt?.toString() ?? null,
        pesoBrutoTotal: serial.pesoBruto?.toString() ?? null,
      });
    });
  }

  @Process(VEHICLE_JOB_STOCK_IN)
  async handleStockIn(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, (serial) => this.renave.entrarEstoque(serial.chassi!));
  }

  @Process(VEHICLE_JOB_SALE_OUT)
  async handleSaleOut(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, async (serial, operation) => {
      if (!operation.fiscalDocumentChave) {
        return { status: 'erro' as const, motivo: 'Operação sem chave de NF-e (fiscalDocumentChave)' };
      }
      // tenant-lint: ok (job Bull interno: ids vêm da fila enfileirada por fluxo tenant-escopado)
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: operation.salesOrderId! },
        select: {
          customer: {
            select: { name: true, razaoSocial: true, document: true, email: true, fiscalEmail: true },
          },
        },
      });
      const customer = order?.customer;
      if (!customer?.document) {
        return { status: 'erro' as const, motivo: 'Cliente da OV sem CPF/CNPJ (document)' };
      }
      return this.renave.sairEstoque({
        chassi: serial.chassi!,
        chaveNfe: operation.fiscalDocumentChave,
        clienteCpfCnpj: customer.document,
        clienteNome: customer.razaoSocial ?? customer.name,
        clienteEmail: customer.fiscalEmail ?? customer.email,
      });
    });
  }

  @Process(VEHICLE_JOB_ATPV_PDF)
  async handleAtpvPdf(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, async (serial, operation) => {
      if (!operation.fiscalDocumentChave) {
        return { status: 'erro' as const, motivo: 'Operação sem chave de NF-e (fiscalDocumentChave)' };
      }
      return this.renave.obterPdfAtpv(serial.chassi!, operation.fiscalDocumentChave);
    });
  }

  @Process(VEHICLE_JOB_CANCEL_SALE_OUT)
  async handleCancelSaleOut(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, (serial) =>
      this.renave.cancelarSaida(serial.chassi!, 'Devolução/cancelamento da venda no ERP'),
    );
  }

  @Process(VEHICLE_JOB_RETURN_MANUFACTURER)
  async handleReturnManufacturer(job: Job<VehicleJobPayload>): Promise<void> {
    await this.runOperation(job, (serial, operation) =>
      this.renave.devolverMontadora(serial.chassi!, operation.fiscalDocumentChave!),
    );
  }

  /**
   * E-mail do ATPV-e ao cliente (#530) — best-effort: sem SMTP configurado ou
   * cliente sem e-mail, loga e conclui SEM lançar (não fica em dead-letter).
   */
  @Process(VEHICLE_JOB_ATPV_EMAIL)
  async handleAtpvEmail(job: Job<VehicleJobPayload>): Promise<void> {
    // tenant-lint: ok (job Bull interno: ids vêm da fila enfileirada por fluxo tenant-escopado)
    const operation = await this.prisma.renaveOperation.findUnique({
      where: { id: job.data.operationId },
    });
    if (!operation?.salesOrderId) return;

    // tenant-lint: ok (job Bull interno: serial vem da operação da própria fila)
    const atpve = await this.prisma.atpveRecord.findFirst({
      where: { serialNumberId: operation.serialNumberId, salesOrderId: operation.salesOrderId },
      include: {
        salesOrder: {
          select: { customer: { select: { name: true, email: true, fiscalEmail: true } } },
        },
        serialNumber: { select: { chassi: true } },
      },
    });
    if (!atpve?.atpvePdfData) return;

    const to = atpve.salesOrder.customer?.fiscalEmail ?? atpve.salesOrder.customer?.email;
    if (!to) {
      this.logger.warn(`ATPV-e ${atpve.id}: cliente sem e-mail — envio pulado`);
      return;
    }

    const sent = await this.mail.send({
      to,
      subject: `ATPV-e do seu veículo — chassi ${atpve.serialNumber.chassi}`,
      text:
        `Olá, ${atpve.clienteNome}!\n\n` +
        `Segue em anexo a ATPV-e (Autorização para Transferência de Propriedade ` +
        `de Veículo eletrônica) do veículo chassi ${atpve.serialNumber.chassi}.\n\n` +
        `Ela é necessária para o emplacamento junto ao DETRAN.\n\nGDR Reboques`,
      attachments: [
        {
          filename: `atpve-${atpve.serialNumber.chassi}.pdf`,
          content: Buffer.from(atpve.atpvePdfData),
        },
      ],
    });
    if (sent.ok) {
      this.logger.log(`ATPV-e ${atpve.id} enviada por e-mail para ${to}`);
    } else {
      this.logger.warn(`ATPV-e ${atpve.id}: e-mail não enviado (${sent.reason})`);
    }
  }

  /**
   * Esqueleto comum: carrega operação+chassi, marca PROCESSING, chama o
   * provider, aplica sucesso via orchestrator ou marca ERROR e relança.
   */
  private async runOperation(
    job: Job<VehicleJobPayload>,
    call: (
      serial: NonNullable<Awaited<ReturnType<VehicleProcessor['loadSerial']>>>,
      operation: NonNullable<Awaited<ReturnType<PrismaService['renaveOperation']['findUnique']>>>,
    ) => Promise<VehicleProviderResponse & { pdfBase64?: string }>,
  ): Promise<void> {
    // tenant-lint: ok (job Bull interno: ids vêm da fila enfileirada por fluxo tenant-escopado)
    const operation = await this.prisma.renaveOperation.findUnique({
      where: { id: job.data.operationId },
    });
    if (!operation) {
      this.logger.warn(`[job:${job.id}] operação ${job.data.operationId} não existe — skip`);
      return;
    }
    // replay de job antigo sobre operação já concluída → no-op (idempotência)
    const terminal: RenaveOperationStatus[] = [
      RenaveOperationStatus.REGISTERED,
      RenaveOperationStatus.STOCK_CONFIRMED,
      RenaveOperationStatus.SALE_INTENT_CREATED,
      RenaveOperationStatus.ACTIVE,
      RenaveOperationStatus.CANCELLED,
    ];
    if (terminal.includes(operation.status)) return;

    const serial = await this.loadSerial(operation.serialNumberId);
    if (!serial?.chassi) {
      await this.orchestrator.markError(operation.id, 'SerialNumber sem chassi');
      return; // sem retry: não se resolve sozinho
    }

    await this.orchestrator.markProcessing(operation.id);
    const result = await call(serial, operation);

    if (result.status === 'erro') {
      await this.orchestrator.markError(operation.id, result.motivo ?? 'erro desconhecido');
      // relança p/ o Bull re-tentar com backoff (padrão AuditProcessor)
      throw new Error(`${operation.type} ${serial.chassi}: ${result.motivo}`);
    }

    await this.orchestrator.completeOperation(operation, result);
    this.logger.log(`${operation.type} ${serial.chassi}: OK (${result.protocol ?? 's/ protocolo'})`);
  }

  private loadSerial(serialNumberId: string) {
    // tenant-lint: ok (job Bull interno: ids vêm da fila enfileirada por fluxo tenant-escopado)
    return this.prisma.serialNumber.findUnique({
      where: { id: serialNumberId },
      select: {
        id: true,
        chassi: true,
        condicaoVeiculo: true,
        codigoMarcaModelo: true,
        corDenatran: true,
        qtdEixos: true,
        anoFabricacao: true,
        anoModelo: true,
        especieVeiculo: true,
        tipoVeiculo: true,
        cmt: true,
        pesoBruto: true,
        product: { select: { codigoMarcaModelo: true } },
      },
    });
  }
}
