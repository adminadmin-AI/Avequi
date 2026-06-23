import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

@Injectable()
export class BankingService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.bankAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, companyId },
    });
    if (!account) {
      throw new BusinessException(
        'Conta bancária não encontrada',
        HttpStatus.NOT_FOUND,
      );
    }
    return account;
  }

  async getBalance(companyId: string, id: string) {
    const account = await this.findOne(companyId, id);

    // Sum of paid receivables (credits)
    const receivableAgg = await this.prisma.receivable.aggregate({
      where: { companyId, bankAccountId: id, status: 'PAID' },
      _sum: { paidAmount: true },
    });

    // Sum of paid payables (debits)
    const payableAgg = await this.prisma.payable.aggregate({
      where: { companyId, bankAccountId: id, status: 'PAID' },
      _sum: { paidAmount: true },
    });

    const credits = Number(receivableAgg._sum.paidAmount ?? 0);
    const debits = Number(payableAgg._sum.paidAmount ?? 0);
    const initialBalance = Number(account.initialBalance);
    const currentBalance = initialBalance + credits - debits;

    // Open receivables (future credits)
    const openReceivableAgg = await this.prisma.receivable.aggregate({
      where: { companyId, bankAccountId: id, status: 'OPEN' },
      _sum: { amount: true },
    });

    // Open payables (future debits)
    const openPayableAgg = await this.prisma.payable.aggregate({
      where: { companyId, bankAccountId: id, status: 'OPEN' },
      _sum: { amount: true },
    });

    const pendingCredits = Number(openReceivableAgg._sum.amount ?? 0);
    const pendingDebits = Number(openPayableAgg._sum.amount ?? 0);
    const projectedBalance = currentBalance + pendingCredits - pendingDebits;

    return {
      account: {
        id: account.id,
        name: account.name,
        bankCode: account.bankCode,
        agency: account.agency,
        accountNumber: account.accountNumber,
      },
      initialBalance,
      credits,
      debits,
      currentBalance,
      pendingCredits,
      pendingDebits,
      projectedBalance,
    };
  }

  // ─── Overview consolidado ──────────────────────────────────────────────────

  async getOverview(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
    });

    // Build per-account balance summaries in parallel
    const accountSummaries = await Promise.all(
      accounts.map(async (acc) => {
        const [paidRec, paidPay, openRec, openPay] = await Promise.all([
          this.prisma.receivable.aggregate({
            where: { companyId, bankAccountId: acc.id, status: 'PAID' },
            _sum: { paidAmount: true },
          }),
          this.prisma.payable.aggregate({
            where: { companyId, bankAccountId: acc.id, status: 'PAID' },
            _sum: { paidAmount: true },
          }),
          this.prisma.receivable.aggregate({
            where: { companyId, bankAccountId: acc.id, status: 'OPEN' },
            _sum: { amount: true },
          }),
          this.prisma.payable.aggregate({
            where: { companyId, bankAccountId: acc.id, status: 'OPEN' },
            _sum: { amount: true },
          }),
        ]);

        const initialBalance = Number(acc.initialBalance);
        const credits = Number(paidRec._sum.paidAmount ?? 0);
        const debits = Number(paidPay._sum.paidAmount ?? 0);
        const currentBalance = initialBalance + credits - debits;
        const pendingCredits = Number(openRec._sum.amount ?? 0);
        const pendingDebits = Number(openPay._sum.amount ?? 0);
        const projectedBalance = currentBalance + pendingCredits - pendingDebits;

        return {
          id: acc.id,
          name: acc.name,
          bankCode: acc.bankCode,
          agency: acc.agency,
          accountNumber: acc.accountNumber,
          type: acc.type,
          initialBalance,
          currentBalance,
          projectedBalance,
        };
      }),
    );

    const totalCurrentBalance = accountSummaries.reduce(
      (sum, a) => sum + a.currentBalance,
      0,
    );
    const totalProjectedBalance = accountSummaries.reduce(
      (sum, a) => sum + a.projectedBalance,
      0,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Open receivables summary
    const [openReceivableAgg, overdueReceivableCount, openPayableAgg, overduePayableCount] =
      await Promise.all([
        this.prisma.receivable.aggregate({
          where: { companyId, status: 'OPEN' },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.receivable.count({
          where: { companyId, status: 'OPEN', dueDate: { lt: today } },
        }),
        this.prisma.payable.aggregate({
          where: { companyId, status: 'OPEN' },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.payable.count({
          where: { companyId, status: 'OPEN', dueDate: { lt: today } },
        }),
      ]);

    return {
      accounts: accountSummaries,
      totals: {
        currentBalance: totalCurrentBalance,
        projectedBalance: totalProjectedBalance,
      },
      receivables: {
        openCount: openReceivableAgg._count,
        openAmount: Number(openReceivableAgg._sum.amount ?? 0),
        overdueCount: overdueReceivableCount,
      },
      payables: {
        openCount: openPayableAgg._count,
        openAmount: Number(openPayableAgg._sum.amount ?? 0),
        overdueCount: overduePayableCount,
      },
    };
  }
}
