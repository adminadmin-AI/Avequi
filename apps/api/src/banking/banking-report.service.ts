import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntryDirection = 'CREDIT' | 'DEBIT';

export interface StatementEntry {
  date: Date;
  description: string;
  direction: EntryDirection;
  amount: number;
  runningBalance: number;
  source: 'RECEIVABLE' | 'PAYABLE' | 'PIX' | 'BOLETO';
  referenceId: string;
}

export interface BankStatement {
  bankAccount: {
    id: string;
    name: string;
    bankCode: string | null;
    agency: string | null;
    accountNumber: string | null;
  };
  period: { startDate: Date; endDate: Date };
  openingBalance: number;
  closingBalance: number;
  entries: StatementEntry[];
}

export interface AccountSummary {
  bankAccountId: string;
  bankAccountName: string;
  totalCredits: number;
  totalDebits: number;
  netMovement: number;
}

export interface BankingSummary {
  period: { startDate: Date; endDate: Date };
  totalCredits: number;
  totalDebits: number;
  netMovement: number;
  byAccount: AccountSummary[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BankingReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a bank statement for a specific account in a date range.
   * Combines paid Payables (debits), paid Receivables (credits),
   * paid Pix charges (credits) and paid Boletos (credits).
   * Calculates running balance starting from account initialBalance.
   */
  async getStatement(
    companyId: string,
    bankAccountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BankStatement> {
    // Validate bank account belongs to company
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
    });
    if (!bankAccount) {
      throw new BusinessException(
        'Conta bancária não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }

    // Set end of day on endDate
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Calculate opening balance: initialBalance + all movements BEFORE startDate
    const openingBalance = await this.calculateBalance(
      companyId,
      bankAccountId,
      Number(bankAccount.initialBalance),
      new Date(0),
      new Date(startDate.getTime() - 1),
    );

    // Fetch all movements within the period
    const [payables, receivables, pixCharges, boletos] = await Promise.all([
      this.prisma.payable.findMany({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endOfDay },
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.receivable.findMany({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endOfDay },
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.pixCharge.findMany({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endOfDay },
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.boleto.findMany({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { gte: startDate, lte: endOfDay },
        },
        orderBy: { paidAt: 'asc' },
      }),
    ]);

    // Build flat entry list
    const rawEntries: Omit<StatementEntry, 'runningBalance'>[] = [];

    for (const p of payables) {
      rawEntries.push({
        date: p.paidAt ?? p.dueDate,
        description: p.description ?? 'Pagamento',
        direction: 'DEBIT',
        amount: Number(p.paidAmount ?? p.amount),
        source: 'PAYABLE',
        referenceId: p.id,
      });
    }

    for (const r of receivables) {
      rawEntries.push({
        date: r.paidAt ?? r.dueDate,
        description: r.description ?? 'Recebimento',
        direction: 'CREDIT',
        amount: Number(r.paidAmount ?? r.amount),
        source: 'RECEIVABLE',
        referenceId: r.id,
      });
    }

    for (const px of pixCharges) {
      rawEntries.push({
        date: px.paidAt ?? px.createdAt,
        description: px.description ?? 'Cobrança Pix',
        direction: 'CREDIT',
        amount: Number(px.paidAmount ?? px.amount),
        source: 'PIX',
        referenceId: px.id,
      });
    }

    for (const b of boletos) {
      rawEntries.push({
        date: (b as any).paidAt ?? b.dueDate,
        description: b.description ?? 'Boleto',
        direction: 'CREDIT',
        amount: Number((b as any).paidAmount ?? b.amount),
        source: 'BOLETO',
        referenceId: b.id,
      });
    }

    // Sort by date ascending
    rawEntries.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate running balance
    let runningBalance = openingBalance;
    const entries: StatementEntry[] = rawEntries.map((e) => {
      if (e.direction === 'CREDIT') {
        runningBalance += e.amount;
      } else {
        runningBalance -= e.amount;
      }
      return { ...e, runningBalance };
    });

    const closingBalance = entries.length > 0
      ? entries[entries.length - 1].runningBalance
      : openingBalance;

    return {
      bankAccount: {
        id: bankAccount.id,
        name: bankAccount.name,
        bankCode: bankAccount.bankCode,
        agency: bankAccount.agency,
        accountNumber: bankAccount.accountNumber,
      },
      period: { startDate, endDate: endOfDay },
      openingBalance,
      closingBalance,
      entries,
    };
  }

  /**
   * Aggregated summary across all accounts for the company in a date range.
   */
  async getSummary(
    companyId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BankingSummary> {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);

    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const byAccount: AccountSummary[] = await Promise.all(
      accounts.map(async (acc) => {
        const [payableAgg, receivableAgg, pixAgg, boletoAgg] = await Promise.all([
          this.prisma.payable.aggregate({
            where: {
              companyId,
              bankAccountId: acc.id,
              status: 'PAID',
              paidAt: { gte: startDate, lte: endOfDay },
            },
            _sum: { paidAmount: true, amount: true },
          }),
          this.prisma.receivable.aggregate({
            where: {
              companyId,
              bankAccountId: acc.id,
              status: 'PAID',
              paidAt: { gte: startDate, lte: endOfDay },
            },
            _sum: { paidAmount: true, amount: true },
          }),
          this.prisma.pixCharge.aggregate({
            where: {
              companyId,
              bankAccountId: acc.id,
              status: 'PAID',
              paidAt: { gte: startDate, lte: endOfDay },
            },
            _sum: { paidAmount: true, amount: true },
          }),
          this.prisma.boleto.aggregate({
            where: {
              companyId,
              bankAccountId: acc.id,
              status: 'PAID',
              paidAt: { gte: startDate, lte: endOfDay },
            } as any,
            _sum: { amount: true },
          }),
        ]);

        const receivableCredits =
          Number(receivableAgg._sum.paidAmount ?? receivableAgg._sum.amount ?? 0);
        const pixCredits =
          Number(pixAgg._sum.paidAmount ?? pixAgg._sum.amount ?? 0);
        const boletoCredits = Number(boletoAgg._sum.amount ?? 0);
        const totalCredits = receivableCredits + pixCredits + boletoCredits;

        const totalDebits =
          Number(payableAgg._sum.paidAmount ?? payableAgg._sum.amount ?? 0);

        return {
          bankAccountId: acc.id,
          bankAccountName: acc.name,
          totalCredits,
          totalDebits,
          netMovement: totalCredits - totalDebits,
        };
      }),
    );

    const totalCredits = byAccount.reduce((s, a) => s + a.totalCredits, 0);
    const totalDebits = byAccount.reduce((s, a) => s + a.totalDebits, 0);

    return {
      period: { startDate, endDate: endOfDay },
      totalCredits,
      totalDebits,
      netMovement: totalCredits - totalDebits,
      byAccount,
    };
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Calculate balance at a point in time from movements up to endDate.
   */
  private async calculateBalance(
    companyId: string,
    bankAccountId: string,
    initialBalance: number,
    _startDate: Date,
    endDate: Date,
  ): Promise<number> {
    if (endDate.getTime() <= 0) return initialBalance;

    const [receivableAgg, payableAgg] = await Promise.all([
      this.prisma.receivable.aggregate({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { lte: endDate },
        },
        _sum: { paidAmount: true, amount: true },
      }),
      this.prisma.payable.aggregate({
        where: {
          companyId,
          bankAccountId,
          status: 'PAID',
          paidAt: { lte: endDate },
        },
        _sum: { paidAmount: true, amount: true },
      }),
    ]);

    const credits = Number(
      receivableAgg._sum.paidAmount ?? receivableAgg._sum.amount ?? 0,
    );
    const debits = Number(
      payableAgg._sum.paidAmount ?? payableAgg._sum.amount ?? 0,
    );

    return initialBalance + credits - debits;
  }
}
