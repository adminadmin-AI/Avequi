import { Injectable } from '@nestjs/common';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
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

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
