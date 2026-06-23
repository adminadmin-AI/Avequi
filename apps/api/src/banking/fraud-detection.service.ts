import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FraudFlagType =
  | 'UNUSUAL_HOUR'
  | 'HIGH_VALUE'
  | 'DUPLICATE'
  | 'RATE_LIMIT'
  | 'WHITELIST_EXCEEDED';

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FraudFlag {
  type: FraudFlagType;
  severity: FraudSeverity;
  message: string;
}

export interface FraudCheckResult {
  allowed: boolean;
  flags: FraudFlag[];
}

export interface TransactionStats {
  average: number;
  count: number;
  max: number;
}

export type TransactionType = 'BOLETO' | 'PIX' | 'TRANSFER' | 'PAYMENT';

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FraudDetectionService {
  // Company timezone offset in hours (default UTC-3 for Brazil)
  private readonly DEFAULT_TZ_OFFSET = -3;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run all fraud checks for a banking transaction.
   * Returns { allowed, flags } — blocked if any HIGH severity flag is raised.
   */
  async checkTransaction(
    companyId: string,
    bankAccountId: string,
    amount: number,
    type: TransactionType,
    metadata?: Record<string, unknown>,
  ): Promise<FraudCheckResult> {
    const flags: FraudFlag[] = [];

    const [unusualHourFlag, highValueFlag, duplicateFlag, rateLimitFlag, whitelistFlag] =
      await Promise.all([
        this.checkUnusualHour(),
        this.checkHighValue(companyId, bankAccountId, amount),
        this.checkDuplicate(companyId, bankAccountId, amount),
        this.checkRateLimit(companyId, bankAccountId),
        this.checkWhitelistExceeded(companyId, bankAccountId, type, amount),
      ]);

    if (unusualHourFlag) flags.push(unusualHourFlag);
    if (highValueFlag) flags.push(highValueFlag);
    if (duplicateFlag) flags.push(duplicateFlag);
    if (rateLimitFlag) flags.push(rateLimitFlag);
    if (whitelistFlag) flags.push(whitelistFlag);

    // Block if any HIGH severity flag
    const allowed = !flags.some((f) => f.severity === 'HIGH');

    // Persist HIGH/MEDIUM alerts to DB
    const alertFlags = flags.filter((f) => f.severity !== 'LOW');
    if (alertFlags.length > 0) {
      await Promise.allSettled(
        alertFlags.map((flag) =>
          (this.prisma as any).fraudAlert.create({
            data: {
              companyId,
              bankAccountId,
              flagType: flag.type,
              severity: flag.severity,
              amount,
              message: flag.message,
            },
          }),
        ),
      );
    }

    return { allowed, flags };
  }

  // ─── Individual checks ────────────────────────────────────────────────────

  /**
   * UNUSUAL_HOUR: transactions between 22:00 and 06:00 in company timezone (UTC-3).
   */
  private checkUnusualHour(): FraudFlag | null {
    const now = new Date();
    const brazilHour = (now.getUTCHours() + 24 + this.DEFAULT_TZ_OFFSET) % 24;

    if (brazilHour >= 22 || brazilHour < 6) {
      return {
        type: 'UNUSUAL_HOUR',
        severity: 'LOW',
        message: `Transação realizada em horário incomum (${brazilHour}h horário de Brasília)`,
      };
    }
    return null;
  }

  /**
   * HIGH_VALUE: amount > 3x average of last 30 transactions for this account.
   */
  private async checkHighValue(
    companyId: string,
    bankAccountId: string,
    amount: number,
  ): Promise<FraudFlag | null> {
    const stats = await this.getTransactionStats(companyId, bankAccountId);
    if (stats.count === 0) return null;

    const threshold = stats.average * 3;
    if (amount > threshold) {
      return {
        type: 'HIGH_VALUE',
        severity: 'MEDIUM',
        message: `Valor R$ ${amount.toFixed(2)} é mais de 3x a média (R$ ${stats.average.toFixed(2)}) das últimas ${stats.count} transações`,
      };
    }
    return null;
  }

  /**
   * DUPLICATE: same amount + bankAccountId in last 5 minutes → block.
   */
  private async checkDuplicate(
    companyId: string,
    bankAccountId: string,
    amount: number,
  ): Promise<FraudFlag | null> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Check paid payables with same amount in last 5 minutes
    const recentPayable = await this.prisma.payable.findFirst({
      where: {
        companyId,
        bankAccountId,
        amount,
        updatedAt: { gte: fiveMinutesAgo },
        status: { not: 'CANCELLED' },
      },
    });

    if (recentPayable) {
      return {
        type: 'DUPLICATE',
        severity: 'HIGH',
        message: `Possível duplicidade: transação com valor R$ ${amount.toFixed(2)} já registrada nos últimos 5 minutos (id: ${recentPayable.id})`,
      };
    }

    // Check receivables as well
    const recentReceivable = await this.prisma.receivable.findFirst({
      where: {
        companyId,
        bankAccountId,
        amount,
        updatedAt: { gte: fiveMinutesAgo },
        status: { not: 'CANCELLED' },
      },
    });

    if (recentReceivable) {
      return {
        type: 'DUPLICATE',
        severity: 'HIGH',
        message: `Possível duplicidade: transação com valor R$ ${amount.toFixed(2)} já registrada nos últimos 5 minutos (id: ${recentReceivable.id})`,
      };
    }

    return null;
  }

  /**
   * RATE_LIMIT: more than 20 transactions in last hour for this account.
   */
  private async checkRateLimit(
    companyId: string,
    bankAccountId: string,
  ): Promise<FraudFlag | null> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const limit = 20;

    const [payableCount, receivableCount] = await Promise.all([
      this.prisma.payable.count({
        where: {
          companyId,
          bankAccountId,
          createdAt: { gte: oneHourAgo },
        },
      }),
      this.prisma.receivable.count({
        where: {
          companyId,
          bankAccountId,
          createdAt: { gte: oneHourAgo },
        },
      }),
    ]);

    const total = payableCount + receivableCount;
    if (total >= limit) {
      return {
        type: 'RATE_LIMIT',
        severity: 'MEDIUM',
        message: `Rate limit: ${total} transações na última hora (limite: ${limit})`,
      };
    }
    return null;
  }

  /**
   * WHITELIST_EXCEEDED: amount exceeds configured max per transaction type.
   */
  private async checkWhitelistExceeded(
    companyId: string,
    bankAccountId: string,
    type: TransactionType,
    amount: number,
  ): Promise<FraudFlag | null> {
    // Try account-specific rule first, then company-wide rule
    const rule = await (this.prisma as any).fraudRule.findFirst({
      where: {
        companyId,
        transactionType: type,
        isActive: true,
        OR: [{ bankAccountId }, { bankAccountId: null }],
      },
      orderBy: { bankAccountId: 'desc' }, // account-specific wins
    });

    if (!rule) return null;

    const maxAmount = Number(rule.maxAmount);
    if (amount > maxAmount) {
      return {
        type: 'WHITELIST_EXCEEDED',
        severity: 'HIGH',
        message: `Valor R$ ${amount.toFixed(2)} excede o limite configurado de R$ ${maxAmount.toFixed(2)} para ${type}`,
      };
    }
    return null;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  /**
   * Get transaction statistics (average, count, max) from last 30 transactions
   * for this bank account, combining payables and receivables.
   */
  async getTransactionStats(
    companyId: string,
    bankAccountId: string,
  ): Promise<TransactionStats> {
    const [payableAgg, receivableAgg] = await Promise.all([
      this.prisma.payable.aggregate({
        where: { companyId, bankAccountId },
        _avg: { amount: true },
        _count: { id: true },
        _max: { amount: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      } as any),
      this.prisma.receivable.aggregate({
        where: { companyId, bankAccountId },
        _avg: { amount: true },
        _count: { id: true },
        _max: { amount: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      } as any),
    ]);

    const payableCount = payableAgg._count.id ?? 0;
    const receivableCount = receivableAgg._count.id ?? 0;
    const totalCount = payableCount + receivableCount;

    if (totalCount === 0) {
      return { average: 0, count: 0, max: 0 };
    }

    const payableAvg = Number(payableAgg._avg.amount ?? 0);
    const receivableAvg = Number(receivableAgg._avg.amount ?? 0);
    const weightedAvg =
      (payableAvg * payableCount + receivableAvg * receivableCount) / totalCount;

    const payableMax = Number(payableAgg._max.amount ?? 0);
    const receivableMax = Number(receivableAgg._max.amount ?? 0);
    const max = Math.max(payableMax, receivableMax);

    return {
      average: weightedAvg,
      count: totalCount,
      max,
    };
  }

  // ─── Whitelist config ─────────────────────────────────────────────────────

  /**
   * Create or update the max amount rule for a transaction type in a bank account.
   */
  async setMaxAmount(
    companyId: string,
    bankAccountId: string | null,
    transactionType: TransactionType,
    maxAmount: number,
  ): Promise<unknown> {
    return (this.prisma as any).fraudRule.upsert({
      where: {
        companyId_bankAccountId_transactionType: {
          companyId,
          bankAccountId,
          transactionType,
        },
      },
      update: { maxAmount, isActive: true },
      create: {
        companyId,
        bankAccountId,
        transactionType,
        maxAmount,
      },
    });
  }

  // ─── Rules CRUD ───────────────────────────────────────────────────────────

  async findRules(companyId: string) {
    return (this.prisma as any).fraudRule.findMany({
      where: { companyId, isActive: true },
      include: {
        bankAccount: { select: { id: true, name: true, bankCode: true } },
      },
      orderBy: { transactionType: 'asc' },
    });
  }

  // ─── Alert management ─────────────────────────────────────────────────────

  async findAlerts(companyId: string, resolved?: boolean) {
    const where: Record<string, unknown> = { companyId };
    if (resolved !== undefined) where.resolved = resolved;

    return (this.prisma as any).fraudAlert.findMany({
      where,
      include: {
        bankAccount: { select: { id: true, name: true, bankCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveAlert(companyId: string, alertId: string, resolvedBy: string) {
    const alert = await (this.prisma as any).fraudAlert.findFirst({
      where: { id: alertId, companyId },
    });
    if (!alert) {
      throw new BusinessException('Alerta não encontrado', HttpStatus.NOT_FOUND);
    }

    return (this.prisma as any).fraudAlert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });
  }
}
