import { Injectable } from '@nestjs/common';
import { DebtorType, FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * KPIs financeiros da proposta de consultoria (Wellington, seções 5.1-5.3):
 * #382 — PMP, PMR e ciclo financeiro (PMR + PME − PMP)
 * #387 — cash runway, endividamento líquido e liquidez corrente
 *
 * Tudo calculado de FinancialEntry/BankAccount/StockBalance — nenhum campo
 * novo, só leitura. Valores em dias/R$ arredondados a 1 casa/centavos.
 */

const OPEN_STATUSES = [
  FinancialEntryStatus.OPEN,
  FinancialEntryStatus.OVERDUE,
  FinancialEntryStatus.PARTIALLY_PAID,
];

export interface FinanceKpis {
  period: { from: string; to: string };
  pmp: number | null; // Prazo Médio de Pagamento (dias)
  pmr: number | null; // Prazo Médio de Recebimento (dias)
  pme: number | null; // Prazo Médio de Estoque (dias) — aproximação por giro
  cicloFinanceiro: number | null; // PMR + PME − PMP
  cashRunwayDias: number | null; // saldo / média de saídas diárias (90d)
  mediaSaidasDiarias: number;
  caixaDisponivel: number;
  recebiveisAbertos: number;
  pagaveisAbertos: number;
  endividamentoLiquido: number; // pagáveis abertos − caixa (negativo = saudável)
  liquidezCorrente: number | null; // (caixa + recebíveis) / pagáveis
}

@Injectable()
export class FinanceKpiService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(companyId: string, filters: { from?: string; to?: string } = {}): Promise<FinanceKpis> {
    const to = filters.to ? new Date(`${filters.to}T23:59:59-03:00`) : new Date();
    const from = filters.from
      ? new Date(`${filters.from}T00:00:00-03:00`)
      : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000); // default: últimos 90 dias

    const [pmp, pmr, pme, caixa, abertos, mediaSaidas] = await Promise.all([
      this.prazoMedio(companyId, FinancialEntryType.PAYABLE, from, to),
      this.prazoMedio(companyId, FinancialEntryType.RECEIVABLE, from, to),
      this.prazoMedioEstoque(companyId, from, to),
      this.caixaDisponivel(companyId),
      this.abertosPorTipo(companyId),
      this.mediaSaidasDiarias(companyId),
    ]);

    const cicloFinanceiro =
      pmr != null && pmp != null ? round1(pmr + (pme ?? 0) - pmp) : null;
    const cashRunwayDias = mediaSaidas > 0 ? round1(caixa / mediaSaidas) : null;
    const endividamentoLiquido = round2(abertos.pagaveis - caixa);
    const liquidezCorrente =
      abertos.pagaveis > 0 ? round2((caixa + abertos.recebiveis) / abertos.pagaveis) : null;

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      pmp,
      pmr,
      pme,
      cicloFinanceiro,
      cashRunwayDias,
      mediaSaidasDiarias: round2(mediaSaidas),
      caixaDisponivel: round2(caixa),
      recebiveisAbertos: round2(abertos.recebiveis),
      pagaveisAbertos: round2(abertos.pagaveis),
      endividamentoLiquido,
      liquidezCorrente,
    };
  }

  /**
   * #386 — Margem de contribuição por SKU (Wellington 5.4 Pricing).
   * receita (SaleItem faturado) − custo (avgCost × qtd) − impostos destacados
   * (FiscalDocumentItemTax: ICMS+IPI+PIS+COFINS+DIFAL/FCP das NF-e AUTORIZADAS).
   */
  async getMarginBySku(companyId: string, filters: { from?: string; to?: string } = {}) {
    const to = filters.to ? new Date(`${filters.to}T23:59:59-03:00`) : new Date();
    const from = filters.from
      ? new Date(`${filters.from}T00:00:00-03:00`)
      : new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);

    const vendidos = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: { companyId, status: 'INVOICED' as any, invoicedAt: { gte: from, lte: to } },
      },
      select: {
        quantity: true,
        unitPrice: true,
        productId: true,
        product: { select: { sku: true, name: true, avgCost: true } },
      },
    });

    // impostos por produto — itens fiscais das NF-e autorizadas do período
    const fiscalItems = await this.prisma.fiscalDocumentItem.findMany({
      where: {
        productId: { not: null },
        fiscalDocument: {
          companyId,
          status: 'AUTHORIZED' as any,
          salesOrder: { invoicedAt: { gte: from, lte: to } },
        },
      },
      select: { productId: true, taxes: true },
    });
    const impostosPorProduto = new Map<string, number>();
    for (const fi of fiscalItems) {
      const t = (fi as any).taxes?.[0] ?? (fi as any).taxes;
      const taxes = Array.isArray((fi as any).taxes) ? (fi as any).taxes : t ? [t] : [];
      const total = taxes.reduce(
        (s: number, tx: any) =>
          s +
          Number(tx?.valorIcms ?? 0) +
          Number(tx?.valorIpi ?? 0) +
          Number(tx?.valorPis ?? 0) +
          Number(tx?.valorCofins ?? 0) +
          Number(tx?.difalValor ?? 0) +
          Number(tx?.difalFcpValor ?? 0),
        0,
      );
      impostosPorProduto.set(fi.productId!, (impostosPorProduto.get(fi.productId!) ?? 0) + total);
    }

    const porProduto = new Map<
      string,
      { sku: string; name: string; qty: number; receita: number; custo: number }
    >();
    for (const i of vendidos) {
      const b = porProduto.get(i.productId) ?? {
        sku: i.product?.sku ?? i.productId,
        name: i.product?.name ?? '',
        qty: 0,
        receita: 0,
        custo: 0,
      };
      const qty = Number(i.quantity);
      b.qty += qty;
      b.receita += qty * Number(i.unitPrice);
      b.custo += qty * Number(i.product?.avgCost ?? 0);
      porProduto.set(i.productId, b);
    }

    const items = [...porProduto.entries()]
      .map(([productId, b]) => {
        const impostos = round2(impostosPorProduto.get(productId) ?? 0);
        const margem = round2(b.receita - b.custo - impostos);
        return {
          productId,
          sku: b.sku,
          name: b.name,
          quantidade: b.qty,
          receita: round2(b.receita),
          custo: round2(b.custo),
          impostos,
          margemContribuicao: margem,
          margemPct: b.receita > 0 ? round1((margem / b.receita) * 100) : null,
        };
      })
      .sort((a, b) => b.margemContribuicao - a.margemContribuicao);

    const totais = items.reduce(
      (acc, i) => ({
        receita: acc.receita + i.receita,
        custo: acc.custo + i.custo,
        impostos: acc.impostos + i.impostos,
        margemContribuicao: acc.margemContribuicao + i.margemContribuicao,
      }),
      { receita: 0, custo: 0, impostos: 0, margemContribuicao: 0 },
    );

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      totais: {
        ...mapRound2(totais),
        margemPct: totais.receita > 0 ? round1((totais.margemContribuicao / totais.receita) * 100) : null,
      },
      items,
    };
  }

  /** PMP/PMR: média de (paidAt − createdAt) em dias das entries PAID no período */
  private async prazoMedio(
    companyId: string,
    type: FinancialEntryType,
    from: Date,
    to: Date,
  ): Promise<number | null> {
    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type,
        status: FinancialEntryStatus.PAID,
        paidAt: { gte: from, lte: to },
        // #586: PMR/PMP medem comportamento do CLIENTE/fornecedor — ciclo de
        // liquidação de adquirente (D+30 fixo do cartão) desfiguraria a média
        debtorType: DebtorType.CUSTOMER,
      },
      select: { createdAt: true, paidAt: true },
    });
    if (entries.length === 0) return null;
    const totalDias = entries.reduce((sum, e) => {
      const dias = (e.paidAt!.getTime() - e.createdAt.getTime()) / 86_400_000;
      return sum + Math.max(0, dias);
    }, 0);
    return round1(totalDias / entries.length);
  }

  /**
   * PME por giro de estoque: (valor médio do estoque / CPV do período) × dias.
   * Aproximação: estoque atual a custo médio; CPV = avgCost × qtd faturada.
   */
  private async prazoMedioEstoque(companyId: string, from: Date, to: Date): Promise<number | null> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { warehouse: { companyId }, available: { gt: 0 } },
      select: { available: true, product: { select: { avgCost: true } } },
    });
    const estoqueValor = balances.reduce(
      (s, b) => s + Number(b.available) * Number(b.product?.avgCost ?? 0),
      0,
    );
    if (estoqueValor <= 0) return null;

    const vendidos = await this.prisma.saleItem.findMany({
      where: {
        salesOrder: { companyId, status: 'INVOICED' as any, invoicedAt: { gte: from, lte: to } },
      },
      select: { quantity: true, product: { select: { avgCost: true } } },
    });
    const cpv = vendidos.reduce(
      (s, i) => s + Number(i.quantity) * Number(i.product?.avgCost ?? 0),
      0,
    );
    if (cpv <= 0) return null;

    const dias = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
    return round1((estoqueValor / cpv) * dias);
  }

  private async caixaDisponivel(companyId: string): Promise<number> {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, active: true },
      select: { balance: true },
    });
    return accounts.reduce((s, a) => s + Number(a.balance), 0);
  }

  private async abertosPorTipo(companyId: string): Promise<{ recebiveis: number; pagaveis: number }> {
    const grouped = await this.prisma.financialEntry.groupBy({
      by: ['type'],
      where: { companyId, status: { in: OPEN_STATUSES } },
      _sum: { amount: true, paidAmount: true },
    });
    const remaining = (t: FinancialEntryType) => {
      const g = grouped.find((x) => x.type === t);
      return Number(g?._sum.amount ?? 0) - Number(g?._sum.paidAmount ?? 0);
    };
    return {
      recebiveis: remaining(FinancialEntryType.RECEIVABLE),
      pagaveis: remaining(FinancialEntryType.PAYABLE),
    };
  }

  /** Média de saídas diárias: pagáveis PAGOS nos últimos 90 dias / 90 (#387) */
  private async mediaSaidasDiarias(companyId: string): Promise<number> {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const paid = await this.prisma.financialEntry.aggregate({
      where: {
        companyId,
        type: FinancialEntryType.PAYABLE,
        status: FinancialEntryStatus.PAID,
        paidAt: { gte: from },
      },
      _sum: { paidAmount: true, amount: true },
    });
    const total = Number(paid._sum.paidAmount ?? paid._sum.amount ?? 0);
    return total / 90;
  }
}

function mapRound2<T extends Record<string, number>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round((v as number) * 100) / 100])) as T;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
