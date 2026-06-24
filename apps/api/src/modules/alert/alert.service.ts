import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlertSeverity, AlertType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AlertSummary {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  entityId: string | null;
  entityType: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── helpers ──────────────────────────────────────────────────────────────

  private async upsertAlert(params: {
    companyId: string;
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    body: string;
    entityId?: string;
    entityType?: string;
  }): Promise<void> {
    // Evita duplicatas: se já existe alerta ativo do mesmo tipo/entidade, não recria
    const existing = await this.prisma.alert.findFirst({
      where: {
        companyId: params.companyId,
        type: params.type,
        entityId: params.entityId ?? null,
        resolvedAt: null,
      },
    });
    if (existing) return;

    await this.prisma.alert.create({ data: params });
    this.logger.warn(`[ALERT] ${params.type} — ${params.title}`);
  }

  // ─── S24.01: Verificar estoque mínimo ────────────────────────────────────

  async checkStockMin(companyId: string): Promise<number> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { companyId },
      include: {
        product: { select: { id: true, sku: true, name: true, minStock: true } },
      },
    });

    // agregar por produto
    const productTotals = new Map<
      string,
      { sku: string; name: string; minStock: number; available: number }
    >();

    for (const b of balances) {
      const minStock = Number(b.product.minStock);
      if (minStock <= 0) continue; // sem threshold configurado

      const existing = productTotals.get(b.productId);
      if (existing) {
        existing.available += Number(b.available);
      } else {
        productTotals.set(b.productId, {
          sku: b.product.sku,
          name: b.product.name,
          minStock,
          available: Number(b.available),
        });
      }
    }

    let triggered = 0;
    for (const [productId, data] of productTotals) {
      if (data.available < data.minStock) {
        await this.upsertAlert({
          companyId,
          type: AlertType.STOCK_MIN,
          severity: AlertSeverity.WARNING,
          title: `Estoque mínimo: ${data.sku} — ${data.name}`,
          body: `Disponível: ${data.available} | Mínimo: ${data.minStock}`,
          entityId: productId,
          entityType: 'Product',
        });
        triggered++;
      }
    }
    return triggered;
  }

  // ─── S24.02: Verificar CP vencendo em 7 dias ─────────────────────────────

  async checkPayableDue(companyId: string): Promise<number> {
    const in7days = new Date();
    in7days.setDate(in7days.getDate() + 7);
    in7days.setHours(23, 59, 59, 999);

    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type: 'PAYABLE',
        status: { in: ['OPEN', 'OVERDUE'] },
        dueDate: { lte: in7days },
      },
      include: {
        purchaseOrder: { include: { supplier: { select: { name: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });

    let triggered = 0;
    for (const e of entries) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil(
        (e.dueDate.getTime() - today.getTime()) / 86_400_000,
      );
      const supplierName =
        e.purchaseOrder?.supplier?.name ?? 'Fornecedor desconhecido';

      await this.upsertAlert({
        companyId,
        type: AlertType.PAYABLE_DUE,
        severity: daysLeft <= 0 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
        title:
          daysLeft <= 0
            ? `CP vencido: ${supplierName}`
            : `CP vence em ${daysLeft}d: ${supplierName}`,
        body: `Valor: R$ ${Number(e.amount).toFixed(2)} | Vencimento: ${e.dueDate.toISOString().split('T')[0]}`,
        entityId: e.id,
        entityType: 'FinancialEntry',
      });
      triggered++;
    }
    return triggered;
  }

  // ─── S24.03: Verificar OPs atrasadas ─────────────────────────────────────

  async checkProductionLate(companyId: string): Promise<number> {
    const now = new Date();

    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: 'IN_PROGRESS',
        scheduledEnd: { lt: now },
      },
      include: {
        product: { select: { sku: true, name: true } },
      },
    });

    let triggered = 0;
    for (const op of orders) {
      const daysLate = Math.floor(
        (now.getTime() - op.scheduledEnd!.getTime()) / 86_400_000,
      );
      await this.upsertAlert({
        companyId,
        type: AlertType.PRODUCTION_LATE,
        severity: AlertSeverity.WARNING,
        title: `OP atrasada: ${op.product.sku} — ${op.product.name}`,
        body: `Prazo era ${op.scheduledEnd!.toISOString().split('T')[0]} (${daysLate}d de atraso)`,
        entityId: op.id,
        entityType: 'ProductionOrder',
      });
      triggered++;
    }
    return triggered;
  }

  // ─── S24.04: Verificar NF-e rejeitadas ───────────────────────────────────

  async checkNfeRejected(companyId: string): Promise<number> {
    const docs = await this.prisma.fiscalDocument.findMany({
      where: { companyId, status: 'REJECTED' },
      include: {
        salesOrder: { include: { customer: { select: { name: true } } } },
      },
    });

    let triggered = 0;
    for (const doc of docs) {
      await this.upsertAlert({
        companyId,
        type: AlertType.NFE_REJECTED,
        severity: AlertSeverity.CRITICAL,
        title: 'NF-e rejeitada',
        body: `Código: ${doc.rejectionCode ?? '—'} | ${doc.rejectionReason ?? 'Sem descrição'} | Cliente: ${doc.salesOrder?.customer?.name ?? '—'}`,
        entityId: doc.id,
        entityType: 'FiscalDocument',
      });
      triggered++;
    }
    return triggered;
  }

  // ─── S24.05: Notificar MRP Run concluído ─────────────────────────────────

  async notifyMrpRunDone(
    companyId: string,
    runId: string,
    suggestionCount: number,
  ): Promise<void> {
    await this.upsertAlert({
      companyId,
      type: AlertType.MRP_RUN_DONE,
      severity: AlertSeverity.INFO,
      title: `MRP automático concluído: ${suggestionCount} sugestões`,
      body: `Run ID: ${runId} | Sugestões pendentes de aprovação: ${suggestionCount}`,
      entityId: runId,
      entityType: 'MrpRun',
    });
  }

  // ─── S24.06: Alerta Focus NFe indisponível ────────────────────────────────

  async alertFocusNfeDown(companyId: string, error: string): Promise<void> {
    await this.upsertAlert({
      companyId,
      type: AlertType.FOCUS_NFE_DOWN,
      severity: AlertSeverity.CRITICAL,
      title: 'Integração Focus NFe indisponível',
      body: error,
      entityType: 'FocusNfe',
    });
  }

  async alertManifestOverdue(companyId: string, count: number): Promise<void> {
    await this.upsertAlert({
      companyId,
      type: AlertType.MANIFEST_OVERDUE,
      severity: AlertSeverity.WARNING,
      title: `${count} NF-e não manifestada(s) há mais de 30 dias`,
      body: `Existem ${count} NF-e pendentes de manifestação que ultrapassaram o prazo de 30 dias. Acesse Fiscal > Manifestação para regularizar.`,
      entityType: 'NfeManifest',
    });
  }

  async resolveFocusNfeAlert(companyId: string): Promise<void> {
    await this.prisma.alert.updateMany({
      where: {
        companyId,
        type: AlertType.FOCUS_NFE_DOWN,
        resolvedAt: null,
      },
      data: { resolvedAt: new Date() },
    });
  }

  // ─── S24.07: Painel — listar alertas ativos ───────────────────────────────

  async listActive(companyId: string): Promise<AlertSummary[]> {
    return this.prisma.alert.findMany({
      where: { companyId, resolvedAt: null },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listAll(
    companyId: string,
    opts: { resolved?: boolean; type?: AlertType } = {},
  ): Promise<AlertSummary[]> {
    return this.prisma.alert.findMany({
      where: {
        companyId,
        ...(opts.resolved !== undefined
          ? opts.resolved
            ? { resolvedAt: { not: null } }
            : { resolvedAt: null }
          : {}),
        ...(opts.type ? { type: opts.type } : {}),
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  // ─── S24.08: Resolver alerta manualmente ─────────────────────────────────

  async resolve(id: string, companyId: string): Promise<AlertSummary> {
    const alert = await this.prisma.alert.findFirst({
      where: { id, companyId },
    });
    if (!alert) throw new NotFoundException(`Alerta ${id} não encontrado`);

    return this.prisma.alert.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  // ─── S24.09: Verificação completa (todos os checks de uma vez) ────────────

  async runAllChecks(companyId: string): Promise<{
    stockMin: number;
    payableDue: number;
    productionLate: number;
    nfeRejected: number;
  }> {
    const [stockMin, payableDue, productionLate, nfeRejected] =
      await Promise.all([
        this.checkStockMin(companyId),
        this.checkPayableDue(companyId),
        this.checkProductionLate(companyId),
        this.checkNfeRejected(companyId),
      ]);

    return { stockMin, payableDue, productionLate, nfeRejected };
  }
}
