import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { FinanceKpiService } from './finance-kpi.service';
import { ProvisionService } from './provision.service';
import { DebtService } from './debt.service';

/**
 * Book Gerencial Mensal (#394, Wellington 5.5 FP&A).
 *
 * Consolida num único payload (e num .xlsx via exceljs) o que a diretoria
 * revisa no fechamento: DRE do mês, KPIs (PMP/PMR/ciclo/runway), aging AR/AP,
 * PDD, fluxo projetado 12 meses, margem por SKU (top 10), top clientes e
 * endividamento. Cron no dia 5 sinaliza o book do mês anterior via Alert.
 */

const OPEN_STATUSES = [
  FinancialEntryStatus.OPEN,
  FinancialEntryStatus.OVERDUE,
  FinancialEntryStatus.PARTIALLY_PAID,
];

const AGING_BUCKETS = [
  { label: '0-30', from: 0, to: 30 },
  { label: '31-60', from: 31, to: 60 },
  { label: '61-90', from: 61, to: 90 },
  { label: '>90', from: 91, to: 999999 },
];

@Injectable()
export class ManagementBookService {
  private readonly logger = new Logger(ManagementBookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
    private readonly kpiService: FinanceKpiService,
    private readonly provisionService: ProvisionService,
    private readonly debtService: DebtService,
  ) {}

  /** Book consolidado do mês (default: mês anterior) */
  async getBook(companyId: string, month?: string) {
    const ref = month ?? previousMonth();
    const from = `${ref}-01`;
    const lastDay = new Date(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), 0).getDate();
    const to = `${ref}-${String(lastDay).padStart(2, '0')}`;

    const [dre, kpis, pdd, dividas, fluxo12m, margem, topClientes, aging] = await Promise.all([
      this.financeService.getDre(companyId, { from, to }),
      this.kpiService.getKpis(companyId, { from, to }),
      this.provisionService.getPdd(companyId),
      this.debtService.dashboard(companyId),
      this.financeService.getCashFlowMonthly(companyId, { months: 12 }),
      this.kpiService.getMarginBySku(companyId, { from, to }),
      this.topClientes(companyId, from, to),
      this.aging(companyId),
    ]);

    return {
      referencia: ref,
      period: { from, to },
      geradoEm: new Date().toISOString(),
      kpis,
      dre,
      aging,
      pdd: { totalVencido: pdd.totalVencido, totalProvisao: pdd.totalProvisao, faixas: pdd.faixas },
      endividamento: {
        saldoDevedorTotal: dividas.saldoDevedorTotal,
        contratosAtivos: dividas.contratosAtivos,
        porTipo: dividas.porTipo,
      },
      fluxoProjetado12m: fluxo12m,
      margemPorSku: { totais: margem.totais, top10: margem.items.slice(0, 10) },
      topClientes,
    };
  }

  /** Workbook Excel do book — uma aba por seção */
  async getBookXlsx(companyId: string, month?: string): Promise<Buffer> {
    const book = await this.getBook(companyId, month);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Avequi ERP';

    const resumo = wb.addWorksheet('Resumo');
    resumo.addRows([
      ['Book Gerencial', book.referencia],
      [],
      ['KPIs', ''],
      ['PMR (dias)', book.kpis.pmr ?? '—'],
      ['PMP (dias)', book.kpis.pmp ?? '—'],
      ['Ciclo financeiro (dias)', book.kpis.cicloFinanceiro ?? '—'],
      ['Cash runway (dias)', book.kpis.cashRunwayDias ?? '—'],
      ['Caixa disponível', book.kpis.caixaDisponivel],
      ['Recebíveis abertos', book.kpis.recebiveisAbertos],
      ['Pagáveis abertos', book.kpis.pagaveisAbertos],
      ['Endividamento líquido', book.kpis.endividamentoLiquido],
      ['Liquidez corrente', book.kpis.liquidezCorrente ?? '—'],
      [],
      ['PDD', ''],
      ['Total vencido', book.pdd.totalVencido],
      ['Provisão', book.pdd.totalProvisao],
      [],
      ['Dívidas', ''],
      ['Saldo devedor', book.endividamento.saldoDevedorTotal],
      ['Contratos ativos', book.endividamento.contratosAtivos],
    ]);

    const aging = wb.addWorksheet('Aging');
    aging.addRow(['Faixa', 'A Receber', 'A Pagar']);
    for (const b of book.aging) aging.addRow([b.faixa, b.receber, b.pagar]);

    const fluxo = wb.addWorksheet('Fluxo 12m');
    fluxo.addRow(['Mês', 'Entradas', 'Saídas', 'Líquido', 'Saldo projetado']);
    for (const m of book.fluxoProjetado12m.projection) {
      fluxo.addRow([m.month, m.inflow, m.outflow, m.netFlow, m.projectedBalance]);
    }

    const margem = wb.addWorksheet('Margem Top 10');
    margem.addRow(['SKU', 'Produto', 'Qtd', 'Receita', 'Custo', 'Impostos', 'Margem R$', 'Margem %']);
    for (const i of book.margemPorSku.top10) {
      margem.addRow([i.sku, i.name, i.quantidade, i.receita, i.custo, i.impostos, i.margemContribuicao, i.margemPct]);
    }

    const clientes = wb.addWorksheet('Top Clientes');
    clientes.addRow(['Cliente', 'Receita', 'Pedidos']);
    for (const c of book.topClientes) clientes.addRow([c.cliente, c.receita, c.pedidos]);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async topClientes(companyId: string, from: string, to: string) {
    const items = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: {
          companyId,
          status: 'INVOICED' as any,
          invoicedAt: { gte: new Date(`${from}T00:00:00-03:00`), lte: new Date(`${to}T23:59:59-03:00`) },
        },
      },
      select: {
        quantity: true,
        unitPrice: true,
        salesOrder: { select: { id: true, customer: { select: { id: true, name: true } } } },
      },
    });
    const map = new Map<string, { cliente: string; receita: number; pedidos: Set<string> }>();
    for (const i of items) {
      const c = i.salesOrder?.customer;
      if (!c) continue;
      const b = map.get(c.id) ?? { cliente: c.name, receita: 0, pedidos: new Set<string>() };
      b.receita += Number(i.quantity) * Number(i.unitPrice);
      b.pedidos.add(i.salesOrder!.id);
      map.set(c.id, b);
    }
    return [...map.values()]
      .map((c) => ({ cliente: c.cliente, receita: Math.round(c.receita * 100) / 100, pedidos: c.pedidos.size }))
      .sort((a, b) => b.receita - a.receita)
      .slice(0, 10);
  }

  /** Aging AR/AP em aberto por faixa de atraso */
  private async aging(companyId: string) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const abertos = await this.prisma.financialEntry.findMany({
      where: { companyId, status: { in: OPEN_STATUSES }, dueDate: { lt: hoje } },
      select: { type: true, amount: true, paidAmount: true, dueDate: true },
    });
    const buckets = AGING_BUCKETS.map((b) => ({ faixa: b.label, receber: 0, pagar: 0 }));
    for (const e of abertos) {
      const dias = Math.floor((hoje.getTime() - new Date(e.dueDate).setHours(0, 0, 0, 0)) / 86_400_000);
      const idx = AGING_BUCKETS.findIndex((b) => dias >= b.from && dias <= b.to);
      if (idx < 0) continue;
      const saldo = Number(e.amount) - Number(e.paidAmount ?? 0);
      if (e.type === FinancialEntryType.RECEIVABLE) buckets[idx].receber = r2(buckets[idx].receber + saldo);
      else buckets[idx].pagar = r2(buckets[idx].pagar + saldo);
    }
    return buckets;
  }

  /** Dia 5, 8h: sinaliza que o book do mês anterior está disponível */
  @Cron('0 8 5 * *', { name: 'management-book-monthly' })
  async announceMonthlyBook() {
    const ref = previousMonth();
    const companies = await this.prisma.financialEntry.findMany({
      select: { companyId: true },
      distinct: ['companyId'],
    });
    for (const c of companies) {
      const title = `Book gerencial de ${ref} disponível`;
      const exists = await this.prisma.alert.findFirst({
        where: { companyId: c.companyId, title, resolvedAt: null },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.alert.create({
        data: {
          companyId: c.companyId,
          type: 'MRP_RUN_DONE' as any, // aviso informativo — sem tipo dedicado de FP&A
          severity: 'INFO' as any,
          title,
          body: `Fechamento de ${ref}: GET /finance/management-book?month=${ref} (JSON) ou &format=xlsx (#394)`,
        },
      });
    }
    this.logger.log(`Book gerencial de ${ref} anunciado para ${companies.length} empresas`);
  }
}

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
