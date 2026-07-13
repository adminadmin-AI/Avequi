import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FISCAL_AUTHORIZED_EVENT,
  FiscalAuthorizedEvent,
} from '../fiscal/events/fiscal-authorized.event';
import {
  FISCAL_CANCELLED_EVENT,
  FiscalCancelledEvent,
} from '../fiscal/events/fiscal-cancelled.event';
import { SALE_RETURNED_EVENT, SaleReturnedEvent } from '../sales/events/sale-returned.event';
import { PrismaService } from '../../prisma/prisma.service';
import { BIN_REGISTERED_EVENT, BinRegisteredEvent } from './events/bin-registered.event';
import { RenaveOrchestratorService } from './renave-orchestrator.service';

/**
 * Listener da cadeia veicular (#529/#530/#531) — liga os eventos do domínio
 * (fiscal/vendas) ao orquestrador RENAVE.
 *
 * REGRA DE OURO (#532, padrão fiscal.listener): NADA aqui lança exceção.
 * Falha externa nunca desfaz venda/devolução — a operação fica ERROR no
 * ledger, com retry automático (Bull) e manual (endpoint).
 */
@Injectable()
export class VehicleListener {
  private readonly logger = new Logger(VehicleListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: RenaveOrchestratorService,
  ) {}

  /** NF-e autorizada: venda → BIN (#529); NF-e de OV devolvida → cancela saída (#531) */
  @OnEvent(FISCAL_AUTHORIZED_EVENT, { async: true })
  async onFiscalAuthorized(event: FiscalAuthorizedEvent): Promise<void> {
    try {
      if (!event.salesOrderId) return;
      const order = await this.prisma.salesOrder.findUnique({
        where: { id: event.salesOrderId },
        select: { status: true },
      });
      if (!order) return;
      if ((order.status as string) === 'RETURNED') {
        // NF-e de devolução autorizada → cenário A (cancelar saída) por default
        await this.orchestrator.cancelSaleFlow(event.companyId, event.salesOrderId);
        return;
      }
      await this.orchestrator.startSaleFlow(
        event.companyId,
        event.salesOrderId,
        event.fiscalDocumentId,
        event.chave,
      );
    } catch (err) {
      this.logger.error(
        `onFiscalAuthorized OV ${event.salesOrderId}: ${(err as Error).message} — venda NÃO afetada`,
      );
    }
  }

  /** BIN registrada (automática OU manual) → entrada de estoque RENAVE (#530) */
  @OnEvent(BIN_REGISTERED_EVENT, { async: true })
  async onBinRegistered(event: BinRegisteredEvent): Promise<void> {
    try {
      await this.orchestrator.startStockIn(event.companyId, event.serialNumberId);
    } catch (err) {
      this.logger.error(
        `onBinRegistered ${event.serialNumberId}: ${(err as Error).message}`,
      );
    }
  }

  /** Devolução no ERP (INVOICED → RETURNED) → cancela saída RENAVE (#531 cenário A) */
  @OnEvent(SALE_RETURNED_EVENT, { async: true })
  async onSaleReturned(event: SaleReturnedEvent): Promise<void> {
    try {
      await this.orchestrator.cancelSaleFlow(event.companyId, event.salesOrderId);
    } catch (err) {
      this.logger.error(
        `onSaleReturned OV ${event.salesOrderId}: ${(err as Error).message} — devolução NÃO afetada`,
      );
    }
  }

  /** Cancelamento de NF-e (<24h) também anula a saída RENAVE (#531) */
  @OnEvent(FISCAL_CANCELLED_EVENT, { async: true })
  async onFiscalCancelled(event: FiscalCancelledEvent): Promise<void> {
    try {
      if (!event.salesOrderId) return;
      await this.orchestrator.cancelSaleFlow(event.companyId, event.salesOrderId);
    } catch (err) {
      this.logger.error(
        `onFiscalCancelled OV ${event.salesOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
