import {
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { REPORT_QUEUE, ReportJobData, ReportJobName } from './report.types';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(REPORT_QUEUE) private readonly reportQueue: Queue,
  ) {}

  // ─── helpers ──────────────────────────────────────────────────────────────

  private tempFile(name: string): string {
    return path.join(os.tmpdir(), `gdr-report-${name}-${Date.now()}.xlsx`);
  }

  private styleHeader(row: ExcelJS.Row): void {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F3864' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      };
    });
  }

  private autoWidth(sheet: ExcelJS.Worksheet): void {
    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 50);
    });
  }

  private streamFile(filePath: string): StreamableFile {
    const stream = fs.createReadStream(filePath);
    stream.on('close', () => {
      fs.unlink(filePath, () => {});
    });
    return new StreamableFile(stream, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${path.basename(filePath)}"`,
    });
  }

  private shortId(id: string): string {
    return id.slice(-8).toUpperCase();
  }

  // ─── S22.01: Export Produtos ──────────────────────────────────────────────

  async exportProducts(companyId: string): Promise<StreamableFile> {
    const products = await this.prisma.product.findMany({
      where: { companyId },
      include: {
        stockBalances: { select: { available: true, reserved: true } },
      },
      orderBy: { sku: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Produtos');
    ws.addRow([
      'SKU',
      'Nome',
      'Unidade',
      'Tipo',
      'Preço Custo',
      'Preço Venda',
      'Custo Médio',
      'Estoque Disponível',
      'Ativo',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const p of products) {
      const totalAvailable = p.stockBalances.reduce(
        (acc, s) => acc + Number(s.available),
        0,
      );
      ws.addRow([
        p.sku,
        p.name,
        p.unit,
        p.type,
        p.costPrice ? Number(p.costPrice) : '',
        p.salePrice ? Number(p.salePrice) : '',
        p.avgCost ? Number(p.avgCost) : '',
        totalAvailable,
        p.isActive ? 'Sim' : 'Não',
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('produtos');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.02: Export Clientes ──────────────────────────────────────────────

  async exportCustomers(companyId: string): Promise<StreamableFile> {
    const customers = await this.prisma.customer.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clientes');
    ws.addRow(['Nome', 'CPF/CNPJ', 'E-mail', 'Telefone', 'Cidade', 'UF', 'Ativo']);
    this.styleHeader(ws.getRow(1));

    for (const c of customers) {
      ws.addRow([
        c.name,
        c.document ?? '',
        c.email ?? '',
        c.phone ?? '',
        c.city ?? '',
        c.state ?? '',
        c.isActive ? 'Sim' : 'Não',
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('clientes');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.03: Export Fornecedores ─────────────────────────────────────────

  async exportSuppliers(companyId: string): Promise<StreamableFile> {
    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fornecedores');
    ws.addRow(['Nome', 'CNPJ', 'E-mail', 'Telefone', 'Lead Time (dias)', 'Ativo']);
    this.styleHeader(ws.getRow(1));

    for (const s of suppliers) {
      ws.addRow([
        s.name,
        s.cnpj ?? '',
        s.email ?? '',
        s.phone ?? '',
        s.leadTimeDays,
        s.isActive ? 'Sim' : 'Não',
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('fornecedores');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.04: Export Ordens de Venda ──────────────────────────────────────

  async exportSales(companyId: string): Promise<StreamableFile> {
    const orders = await this.prisma.salesOrder.findMany({
      where: { companyId },
      include: {
        customer: { select: { name: true } },
        createdBy: { select: { name: true } },
        items: { select: { quantity: true, unitPrice: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ordens de Venda');
    ws.addRow(['ID OV', 'Cliente', 'Status', 'Total (R$)', 'Criado por', 'Data']);
    this.styleHeader(ws.getRow(1));

    for (const o of orders) {
      const total = o.items.reduce(
        (acc, i) => acc + Number(i.quantity) * Number(i.unitPrice),
        0,
      );
      ws.addRow([
        this.shortId(o.id),
        o.customer?.name ?? '—',
        o.status,
        total,
        o.createdBy?.name ?? '',
        o.createdAt.toISOString().split('T')[0],
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('vendas');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.05: Export Ordens de Compra ─────────────────────────────────────

  async exportPurchases(companyId: string): Promise<StreamableFile> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { companyId },
      include: {
        supplier: { select: { name: true } },
        items: { select: { quantity: true, unitCost: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ordens de Compra');
    ws.addRow(['ID OC', 'Fornecedor', 'Status', 'Total (R$)', 'Data']);
    this.styleHeader(ws.getRow(1));

    for (const o of orders) {
      const total = o.items.reduce(
        (acc, i) => acc + Number(i.quantity) * Number(i.unitCost),
        0,
      );
      ws.addRow([
        this.shortId(o.id),
        o.supplier.name,
        o.status,
        total,
        o.createdAt.toISOString().split('T')[0],
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('compras');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.06: Export Posições de Estoque ──────────────────────────────────

  async exportStock(companyId: string): Promise<StreamableFile> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { companyId },
      include: {
        product: { select: { sku: true, name: true, unit: true, avgCost: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: [{ warehouse: { code: 'asc' } }, { product: { sku: 'asc' } }],
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Estoque');
    ws.addRow([
      'Armazém',
      'SKU',
      'Produto',
      'Unidade',
      'Disponível',
      'Reservado',
      'Em Trânsito',
      'Total',
      'Valor Estoque (R$)',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const b of balances) {
      const available = Number(b.available);
      const reserved = Number(b.reserved);
      const inTransit = Number(b.inTransit);
      const avgCost = b.product.avgCost ? Number(b.product.avgCost) : 0;
      ws.addRow([
        `${b.warehouse.code} — ${b.warehouse.name}`,
        b.product.sku,
        b.product.name,
        b.product.unit,
        available,
        reserved,
        inTransit,
        available + reserved + inTransit,
        (available + reserved) * avgCost,
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('estoque');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.07: Relatório de Inadimplência (Aging) ───────────────────────────

  async exportAging(companyId: string): Promise<StreamableFile> {
    const today = new Date();
    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type: 'RECEIVABLE',
        status: 'OVERDUE',
      },
      include: {
        salesOrder: {
          include: { customer: { select: { name: true } } },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inadimplência');
    ws.addRow([
      'Cliente',
      'ID OV',
      'Valor (R$)',
      'Vencimento',
      'Atraso (dias)',
      'Faixa',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const e of entries) {
      const daysLate = Math.floor(
        (today.getTime() - e.dueDate.getTime()) / 86_400_000,
      );
      const faixa =
        daysLate <= 30
          ? '0–30 dias'
          : daysLate <= 60
            ? '31–60 dias'
            : daysLate <= 90
              ? '61–90 dias'
              : '>90 dias';

      const row = ws.addRow([
        e.salesOrder?.customer?.name ?? '—',
        e.salesOrder ? this.shortId(e.salesOrder.id) : '—',
        Number(e.amount),
        e.dueDate.toISOString().split('T')[0],
        daysLate,
        faixa,
      ]);

      if (daysLate > 90) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFD0D0' },
          };
        });
      }
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('inadimplencia');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.08: Compras por Fornecedor ──────────────────────────────────────

  async exportPurchasesBySupplier(companyId: string): Promise<StreamableFile> {
    const items = await this.prisma.pOItem.findMany({
      where: { purchaseOrder: { companyId } },
      include: {
        purchaseOrder: {
          include: { supplier: { select: { name: true } } },
        },
        product: { select: { sku: true, name: true } },
      },
    });

    const map = new Map<
      string,
      {
        supplier: string;
        sku: string;
        name: string;
        qty: number;
        total: number;
        orders: number;
      }
    >();

    for (const item of items) {
      const key = `${item.purchaseOrder.supplier.name}||${item.product.sku}`;
      const qty = Number(item.quantity);
      const total = Number(item.unitCost) * qty;
      const existing = map.get(key);
      if (existing) {
        existing.qty += qty;
        existing.total += total;
        existing.orders += 1;
      } else {
        map.set(key, {
          supplier: item.purchaseOrder.supplier.name,
          sku: item.product.sku,
          name: item.product.name,
          qty,
          total,
          orders: 1,
        });
      }
    }

    const rows = [...map.values()].sort((a, b) =>
      a.supplier.localeCompare(b.supplier),
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Compras por Fornecedor');
    ws.addRow([
      'Fornecedor',
      'SKU',
      'Produto',
      'Qtd Total',
      'Valor Total (R$)',
      'Preço Médio (R$)',
      'Nº OCs',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const r of rows) {
      ws.addRow([
        r.supplier,
        r.sku,
        r.name,
        r.qty,
        r.total,
        r.qty > 0 ? r.total / r.qty : 0,
        r.orders,
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('compras-fornecedor');
    await wb.xlsx.writeFile(filePath);
    return this.streamFile(filePath);
  }

  // ─── S22.09: Enfileirar relatório pesado ─────────────────────────────────

  async enqueueReport(
    companyId: string,
    jobName: ReportJobName,
  ): Promise<{ jobId: string; message: string }> {
    const data: ReportJobData = {
      companyId,
      jobName,
      requestedAt: new Date().toISOString(),
    };
    const job = await this.reportQueue.add(jobName, data, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: false,
      removeOnFail: false,
    });
    return {
      jobId: String(job.id),
      message: `Relatório "${jobName}" enfileirado. Consulte GET /reports/${job.id}/status`,
    };
  }

  // ─── S22.10: Status de job ────────────────────────────────────────────────

  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    status: string;
    progress?: number;
    downloadUrl?: string;
    error?: string;
  }> {
    const job: Job | null = await this.reportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} não encontrado`);

    const state = await job.getState();
    const result = job.returnvalue as { filePath?: string; error?: string } | null;

    return {
      jobId,
      status: state,
      progress: job.progress() as number,
      downloadUrl:
        state === 'completed' && result?.filePath
          ? `/api/reports/${jobId}/download`
          : undefined,
      error:
        state === 'failed' ? (result?.error ?? job.failedReason) : undefined,
    };
  }

  // ─── S22.11: Download de relatório pesado ────────────────────────────────

  async downloadReport(jobId: string): Promise<StreamableFile> {
    const job: Job | null = await this.reportQueue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} não encontrado`);

    const state = await job.getState();
    if (state !== 'completed') {
      throw new NotFoundException(
        `Relatório ainda não está pronto (status: ${state})`,
      );
    }

    const result = job.returnvalue as { filePath?: string };
    if (!result?.filePath || !fs.existsSync(result.filePath)) {
      throw new NotFoundException('Arquivo do relatório não encontrado');
    }

    return this.streamFile(result.filePath);
  }

  // ─── geração dos relatórios pesados (chamado pelo processor) ─────────────

  async generateCostHistory(companyId: string): Promise<string> {
    const movements = await this.prisma.stockMovement.findMany({
      where: { companyId, type: 'ENTRY' },
      include: {
        product: {
          select: { sku: true, name: true, unit: true, avgCost: true },
        },
      },
      orderBy: [{ product: { sku: 'asc' } }, { createdAt: 'asc' }],
    });

    // custo médio ponderado acumulado por produto
    const productMap = new Map<
      string,
      { totalQty: number; totalCost: number }
    >();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Custo Médio por Produto');
    ws.addRow([
      'SKU',
      'Produto',
      'Unidade',
      'Data Movimento',
      'Qtd Entrada',
      'CMP Acumulado (R$)',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const m of movements) {
      const key = m.productId;
      // usa avgCost do produto como proxy do custo unitário da entrada
      const unitCost = m.product.avgCost ? Number(m.product.avgCost) : 0;
      const qty = Number(m.quantity);
      const existing = productMap.get(key);

      let cmp: number;
      if (existing) {
        const newTotalQty = existing.totalQty + qty;
        const newTotalCost = existing.totalCost + unitCost * qty;
        existing.totalQty = newTotalQty;
        existing.totalCost = newTotalCost;
        cmp = newTotalQty > 0 ? newTotalCost / newTotalQty : 0;
      } else {
        productMap.set(key, { totalQty: qty, totalCost: unitCost * qty });
        cmp = unitCost;
      }

      ws.addRow([
        m.product.sku,
        m.product.name,
        m.product.unit,
        m.createdAt.toISOString().split('T')[0],
        qty,
        cmp,
      ]);
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('custo-historico');
    await wb.xlsx.writeFile(filePath);
    return filePath;
  }

  async generateStockAbc(companyId: string): Promise<string> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { companyId },
      include: {
        product: {
          select: {
            sku: true,
            name: true,
            unit: true,
            salePrice: true,
            avgCost: true,
          },
        },
      },
    });

    const exits = await this.prisma.stockMovement.groupBy({
      by: ['productId'],
      where: { companyId, type: 'EXIT' },
      _sum: { quantity: true },
      _count: { id: true },
    });

    const exitMap = new Map(
      exits.map((e) => [
        e.productId,
        { qty: Number(e._sum.quantity ?? 0), count: e._count.id },
      ]),
    );

    // agregar por produto (pode haver múltiplos armazéns)
    const productMap = new Map<
      string,
      {
        sku: string;
        name: string;
        unit: string;
        stockQty: number;
        stockValue: number;
        demandQty: number;
        demandValue: number;
        demandCount: number;
      }
    >();

    for (const b of balances) {
      const price = b.product.salePrice
        ? Number(b.product.salePrice)
        : b.product.avgCost
          ? Number(b.product.avgCost)
          : 0;
      const stockQty = Number(b.available) + Number(b.reserved);
      const exit = exitMap.get(b.productId) ?? { qty: 0, count: 0 };
      const existing = productMap.get(b.productId);
      if (existing) {
        existing.stockQty += stockQty;
        existing.stockValue += stockQty * price;
      } else {
        productMap.set(b.productId, {
          sku: b.product.sku,
          name: b.product.name,
          unit: b.product.unit,
          stockQty,
          stockValue: stockQty * price,
          demandQty: exit.qty,
          demandValue: exit.qty * price,
          demandCount: exit.count,
        });
      }
    }

    const rows = [...productMap.values()].sort(
      (a, b) => b.demandValue - a.demandValue,
    );
    const totalDemand = rows.reduce((s, r) => s + r.demandValue, 0);
    let cumulative = 0;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Curva ABC Estoque');
    ws.addRow([
      'Classe',
      'SKU',
      'Produto',
      'Unidade',
      'Estoque',
      'Valor Estoque (R$)',
      'Saídas (qtd)',
      'Valor Saídas (R$)',
      '% Acumulado',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const r of rows) {
      cumulative += totalDemand > 0 ? r.demandValue / totalDemand : 0;
      const classe = cumulative <= 0.8 ? 'A' : cumulative <= 0.95 ? 'B' : 'C';
      const row = ws.addRow([
        classe,
        r.sku,
        r.name,
        r.unit,
        r.stockQty,
        r.stockValue,
        r.demandQty,
        r.demandValue,
        (cumulative * 100).toFixed(1) + '%',
      ]);

      const color =
        classe === 'A' ? 'FFD4EDDA' : classe === 'B' ? 'FFFFF3CD' : 'FFFCE8E6';
      row.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: color },
        };
      });
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('estoque-abc');
    await wb.xlsx.writeFile(filePath);
    return filePath;
  }

  async generateProductionEfficiency(companyId: string): Promise<string> {
    const orders = await this.prisma.productionOrder.findMany({
      where: { companyId, status: 'DONE' },
      include: {
        product: { select: { sku: true, name: true } },
        cost: true,
        logs: true,
      },
      orderBy: { completedAt: 'desc' },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Eficiência de Produção');
    ws.addRow([
      'ID OP',
      'Produto',
      'SKU',
      'Qtd Planejada',
      'Qtd Realizada',
      '% Realizado',
      'Custo Material (R$)',
      'Custo Total (R$)',
      'Custo/Unidade (R$)',
      'Data Conclusão',
      'Apontamentos',
    ]);
    this.styleHeader(ws.getRow(1));

    for (const o of orders) {
      const planned = Number(o.plannedQty);
      const produced = Number(o.producedQty);
      const pct = planned > 0 ? ((produced / planned) * 100).toFixed(1) + '%' : '—';

      const row = ws.addRow([
        this.shortId(o.id),
        o.product.name,
        o.product.sku,
        planned,
        produced,
        pct,
        o.cost ? Number(o.cost.materialCost) : 0,
        o.cost ? Number(o.cost.totalCost) : 0,
        o.cost ? Number(o.cost.costPerUnit) : 0,
        o.completedAt ? o.completedAt.toISOString().split('T')[0] : '',
        o.logs.length,
      ]);

      // destaca OPs com eficiência abaixo de 90%
      if (planned > 0 && produced / planned < 0.9) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF3CD' },
          };
        });
      }
    }
    this.autoWidth(ws);

    const filePath = this.tempFile('eficiencia-producao');
    await wb.xlsx.writeFile(filePath);
    return filePath;
  }
}
