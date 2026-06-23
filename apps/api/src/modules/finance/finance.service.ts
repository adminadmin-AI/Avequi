import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayEntryDto } from './dto/pay-entry.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateInstallmentsDto } from './dto/create-installments.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── S09.02: Gerar CR de venda confirmada ────────────────────────────────

  async createReceivableForSale(params: {
    companyId: string;
    salesOrderId: string;
    amount: number;
    dueDate?: Date;
    fiscalDocumentId?: string;
  }): Promise<void> {
    // Idempotência: uma venda → no máximo um CR
    const existing = await this.prisma.financialEntry.findUnique({
      where: { salesOrderId: params.salesOrderId },
    });
    if (existing) {
      this.logger.warn(`CR já existe para OV ${params.salesOrderId}`);
      return;
    }

    const dueDate = params.dueDate ?? this.addDays(new Date(), 30);

    const entry = await this.prisma.financialEntry.create({
      data: {
        companyId: params.companyId,
        type: FinancialEntryType.RECEIVABLE,
        status: FinancialEntryStatus.OPEN,
        amount: params.amount,
        dueDate,
        description: `Conta a receber referente à venda #${params.salesOrderId}`,
        salesOrderId: params.salesOrderId,
        fiscalDocumentId: params.fiscalDocumentId ?? null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        entity: 'FinancialEntry',
        action: 'CREATE_RECEIVABLE',
        payload: { id: entry.id, salesOrderId: params.salesOrderId, amount: params.amount },
      },
    });

    this.logger.log(`RECEIVABLE criado: ${entry.id} — OV ${params.salesOrderId} — R$ ${params.amount}`);
  }

  // ─── S09.03: Gerar CP de recebimento de compra ───────────────────────────

  async createPayableForReceipt(params: {
    companyId: string;
    purchaseOrderId: string;
    goodsReceiptId: string;
    amount: number;
    dueDate?: Date;
  }): Promise<void> {
    // Idempotência: um GR → no máximo um CP
    const existing = await this.prisma.financialEntry.findUnique({
      where: { goodsReceiptId: params.goodsReceiptId },
    });
    if (existing) {
      this.logger.warn(`CP já existe para GR ${params.goodsReceiptId}`);
      return;
    }

    const dueDate = params.dueDate ?? this.addDays(new Date(), 30);

    const entry = await this.prisma.financialEntry.create({
      data: {
        companyId: params.companyId,
        type: FinancialEntryType.PAYABLE,
        status: FinancialEntryStatus.OPEN,
        amount: params.amount,
        dueDate,
        description: `Conta a pagar referente ao recebimento #${params.goodsReceiptId}`,
        purchaseOrderId: params.purchaseOrderId,
        goodsReceiptId: params.goodsReceiptId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        entity: 'FinancialEntry',
        action: 'CREATE_PAYABLE',
        payload: { id: entry.id, goodsReceiptId: params.goodsReceiptId, amount: params.amount },
      },
    });

    this.logger.log(`PAYABLE criado: ${entry.id} — GR ${params.goodsReceiptId} — R$ ${params.amount}`);
  }

  // ─── S09.05: Registrar pagamento (parcial ou total) ───────────────────────

  async pay(id: string, companyId: string, dto: PayEntryDto) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId },
      include: { payments: true },
    });

    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);

    const payableStatuses: FinancialEntryStatus[] = [
      FinancialEntryStatus.OPEN,
      FinancialEntryStatus.OVERDUE,
      FinancialEntryStatus.PARTIALLY_PAID,
    ];
    if (!payableStatuses.includes(entry.status)) {
      throw new BadRequestException(
        `Lançamento não pode ser baixado. Status atual: ${entry.status}`,
      );
    }

    const previouslyPaid = entry.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const totalAmount = Number(entry.amount);
    const remaining = totalAmount - previouslyPaid;

    if (dto.paidAmount > remaining + 0.01) {
      throw new BadRequestException(
        `Valor excede saldo devedor. Restante: R$ ${remaining.toFixed(2)}`,
      );
    }

    const newTotalPaid = previouslyPaid + dto.paidAmount;
    const isFullyPaid = newTotalPaid >= totalAmount - 0.01;
    const newStatus = isFullyPaid
      ? FinancialEntryStatus.PAID
      : FinancialEntryStatus.PARTIALLY_PAID;

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          financialEntryId: id,
          amount: dto.paidAmount,
          paidAt: new Date(dto.paidAt),
          method: dto.method,
          bankAccountId: dto.bankAccountId ?? null,
          reference: dto.reference ?? null,
        },
      }),
      this.prisma.financialEntry.update({
        where: { id },
        data: {
          status: newStatus,
          paidAt: isFullyPaid ? new Date(dto.paidAt) : null,
          paidAmount: newTotalPaid,
          paymentNote: dto.paymentNote ?? entry.paymentNote,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FinancialEntry',
          action: isFullyPaid ? 'PAY_FULL' : 'PAY_PARTIAL',
          payload: {
            id,
            paymentAmount: dto.paidAmount,
            totalPaid: newTotalPaid,
            remaining: totalAmount - newTotalPaid,
            method: dto.method,
          },
        },
      }),
    ]);

    this.logger.log(
      `FinancialEntry ${id} → ${newStatus} — pagamento R$ ${dto.paidAmount} (total pago: R$ ${newTotalPaid.toFixed(2)})`,
    );

    return {
      paymentId: payment.id,
      status: newStatus,
      totalPaid: newTotalPaid,
      remaining: totalAmount - newTotalPaid,
    };
  }

  // ─── Parcelamento de títulos ─────────────────────────────────────────────

  async createInstallments(id: string, companyId: string, dto: CreateInstallmentsDto) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId },
      include: { installments: true },
    });

    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);

    if (entry.installments.length > 0) {
      throw new BadRequestException('Lançamento já foi parcelado');
    }

    if (entry.status === FinancialEntryStatus.PAID || entry.status === FinancialEntryStatus.CANCELLED) {
      throw new BadRequestException(`Lançamento com status ${entry.status} não pode ser parcelado`);
    }

    const totalAmount = Number(entry.amount);
    const installmentAmount = Math.floor((totalAmount / dto.numberOfInstallments) * 100) / 100;
    const lastInstallmentAmount = +(totalAmount - installmentAmount * (dto.numberOfInstallments - 1)).toFixed(2);

    const installmentsData = Array.from({ length: dto.numberOfInstallments }, (_, i) => {
      const dueDate = new Date(dto.firstDueDate);
      dueDate.setDate(dueDate.getDate() + i * dto.intervalDays);

      return {
        companyId: entry.companyId,
        type: entry.type,
        status: FinancialEntryStatus.OPEN,
        amount: i === dto.numberOfInstallments - 1 ? lastInstallmentAmount : installmentAmount,
        dueDate,
        description: `${entry.description ?? 'Parcela'} (${i + 1}/${dto.numberOfInstallments})`,
        parentEntryId: entry.id,
        salesOrderId: null as string | null,
        purchaseOrderId: entry.purchaseOrderId,
        goodsReceiptId: null as string | null,
      };
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const installments = await Promise.all(
        installmentsData.map((data) => tx.financialEntry.create({ data })),
      );

      await tx.financialEntry.update({
        where: { id },
        data: { status: FinancialEntryStatus.CANCELLED },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entity: 'FinancialEntry',
          action: 'CREATE_INSTALLMENTS',
          payload: {
            parentId: id,
            numberOfInstallments: dto.numberOfInstallments,
            installmentIds: installments.map((i) => i.id),
          },
        },
      });

      return installments;
    });

    this.logger.log(
      `FinancialEntry ${id} parcelado em ${dto.numberOfInstallments}x — IDs: ${created.map((i) => i.id).join(', ')}`,
    );

    return created;
  }

  // ─── Cancelar lançamento (preserva histórico, não deleta) ────────────────

  async cancel(id: string, companyId: string): Promise<void> {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId },
    });

    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);
    if (entry.status === FinancialEntryStatus.PAID) {
      throw new BadRequestException('Lançamento já pago não pode ser cancelado');
    }
    if (entry.status === FinancialEntryStatus.CANCELLED) {
      throw new BadRequestException('Lançamento já está cancelado');
    }
    if (entry.status === FinancialEntryStatus.PARTIALLY_PAID) {
      throw new BadRequestException('Lançamento parcialmente pago não pode ser cancelado. Estorne os pagamentos primeiro');
    }

    await this.prisma.financialEntry.update({
      where: { id },
      data: { status: FinancialEntryStatus.CANCELLED },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'FinancialEntry',
        action: 'CANCEL',
        payload: { id },
      },
    });

    this.logger.log(`FinancialEntry ${id} → CANCELLED`);
  }

  // ─── S09.04: Listagem financeira com filtros ──────────────────────────────

  async findAll(
    companyId: string,
    filters: {
      type?: FinancialEntryType;
      status?: FinancialEntryStatus;
      dueDateFrom?: string;
      dueDateTo?: string;
    } = {},
  ) {
    return this.prisma.financialEntry.findMany({
      where: {
        companyId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.dueDateFrom || filters.dueDateTo
          ? {
              dueDate: {
                ...(filters.dueDateFrom ? { gte: new Date(filters.dueDateFrom) } : {}),
                ...(filters.dueDateTo ? { lte: new Date(filters.dueDateTo) } : {}),
              },
            }
          : {}),
      },
      include: {
        salesOrder: { include: { customer: true } },
        purchaseOrder: { include: { supplier: true } },
        goodsReceipt: true,
        fiscalDocument: { select: { id: true, chave: true, status: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId },
      include: {
        salesOrder: { include: { customer: true, items: { include: { product: true } } } },
        purchaseOrder: { include: { supplier: true } },
        goodsReceipt: { include: { items: { include: { product: true } } } },
        fiscalDocument: true,
        payments: { orderBy: { paidAt: 'asc' } },
        installments: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);
    return entry;
  }

  // ─── S09.05b: Cron diário — OPEN vencidos → OVERDUE ─────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async markOverdue(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await this.prisma.financialEntry.updateMany({
      where: {
        status: FinancialEntryStatus.OPEN,
        dueDate: { lt: today },
      },
      data: { status: FinancialEntryStatus.OVERDUE },
    });

    if (count > 0) {
      this.logger.log(`markOverdue: ${count} lançamentos marcados como OVERDUE`);
    }
  }

  // ─── S09.07: BankAccount CRUD ─────────────────────────────────────────────

  async createBankAccount(companyId: string, dto: CreateBankAccountDto) {
    const account = await this.prisma.bankAccount.create({
      data: { companyId, ...dto },
    });
    this.logger.log(`BankAccount criado: ${account.id} — ${dto.name}`);
    return account;
  }

  async findAllBankAccounts(companyId: string) {
    return this.prisma.bankAccount.findMany({
      where: { companyId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateBankAccount(id: string, companyId: string, dto: Partial<CreateBankAccountDto>) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new NotFoundException(`Conta bancária ${id} não encontrada`);

    return this.prisma.bankAccount.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateBankAccount(id: string, companyId: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new NotFoundException(`Conta bancária ${id} não encontrada`);

    return this.prisma.bankAccount.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── S09.08: CashFlowSnapshot — entradas e saídas previstas ──────────────

  async getCashFlow(
    companyId: string,
    filters: { from?: string; to?: string } = {},
  ): Promise<{
    totalReceivable: number;
    totalPayable: number;
    netBalance: number;
    entries: Array<{
      id: string;
      type: FinancialEntryType;
      status: FinancialEntryStatus;
      amount: number;
      dueDate: Date;
      description: string | null;
    }>;
  }> {
    const where = {
      companyId,
      status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.OVERDUE] as FinancialEntryStatus[] },
      ...(filters.from || filters.to
        ? {
            dueDate: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const rows = await this.prisma.financialEntry.findMany({
      where,
      select: { id: true, type: true, status: true, amount: true, dueDate: true, description: true },
      orderBy: { dueDate: 'asc' },
    });

    let totalReceivable = 0;
    let totalPayable = 0;

    for (const row of rows) {
      const amount = Number(row.amount);
      if (row.type === FinancialEntryType.RECEIVABLE) totalReceivable += amount;
      else totalPayable += amount;
    }

    return {
      totalReceivable,
      totalPayable,
      netBalance: totalReceivable - totalPayable,
      entries: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    };
  }

  // ─── Util ─────────────────────────────────────────────────────────────────

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}
