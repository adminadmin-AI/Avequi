import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Gestão de dívida (#392, Wellington 5.3): FINAME, leasing, capital de giro.
 *
 * Cronograma gerado na contratação (PRICE ou SAC, juros % a.m.); parcelas
 * PENDING entram no fluxo de caixa projetado como saída (finance.service) e
 * o cron diário alerta vencimentos em 7 dias. Baixa por parcela; dívida vira
 * SETTLED quando a última parcela é paga.
 */

const DEBT_TYPES = ['FINAME', 'LEASING', 'CAPITAL_GIRO', 'CHEQUE_ESPECIAL', 'OUTROS'];

export interface CreateDebtInput {
  type: string;
  bank: string;
  description?: string;
  principal: number;
  interestRate: number; // % a.m.
  amortizationType?: 'PRICE' | 'SAC';
  installmentsCount: number;
  contractedAt: string;
  firstDueDate: string;
}

@Injectable()
export class DebtService {
  private readonly logger = new Logger(DebtService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateDebtInput, userId?: string) {
    if (!DEBT_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Tipo inválido — use: ${DEBT_TYPES.join(', ')}`);
    }
    if (dto.principal <= 0 || dto.installmentsCount < 1) {
      throw new BadRequestException('Principal e nº de parcelas devem ser positivos.');
    }
    const system = dto.amortizationType ?? 'PRICE';
    const schedule = buildSchedule(
      dto.principal,
      dto.interestRate / 100,
      dto.installmentsCount,
      new Date(dto.firstDueDate),
      system,
    );

    const debt = await this.prisma.debt.create({
      data: {
        companyId,
        type: dto.type,
        bank: dto.bank,
        description: dto.description ?? null,
        principal: dto.principal,
        interestRate: dto.interestRate,
        amortizationType: system,
        installmentsCount: dto.installmentsCount,
        contractedAt: new Date(dto.contractedAt),
        firstDueDate: new Date(dto.firstDueDate),
        installments: { create: schedule },
      },
      include: { installments: { orderBy: { number: 'asc' } } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'Debt',
        action: 'CREATE',
        payload: { debtId: debt.id, type: dto.type, principal: dto.principal, parcelas: dto.installmentsCount },
      },
    });
    return debt;
  }

  async findAll(companyId: string) {
    const debts = await this.prisma.debt.findMany({
      where: { companyId },
      include: {
        installments: { where: { status: 'PENDING' }, orderBy: { dueDate: 'asc' }, take: 1 },
      },
      orderBy: { contractedAt: 'desc' },
    });
    return debts.map((d) => ({
      ...d,
      proximaParcela: d.installments[0] ?? null,
      installments: undefined,
    }));
  }

  async findOne(id: string, companyId: string) {
    const debt = await this.prisma.debt.findFirst({
      where: { id, companyId },
      include: { installments: { orderBy: { number: 'asc' } } },
    });
    if (!debt) throw new NotFoundException(`Dívida ${id} não encontrada`);
    return debt;
  }

  /** Dashboard de endividamento: total por tipo, saldo devedor, próximos vencimentos */
  async dashboard(companyId: string) {
    const debts = await this.prisma.debt.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { installments: true },
    });

    const porTipo = new Map<string, { tipo: string; contratos: number; saldoDevedor: number }>();
    let saldoTotal = 0;
    for (const d of debts) {
      const pendentes = d.installments.filter((i) => i.status === 'PENDING');
      const saldo = round2(pendentes.reduce((s, i) => s + Number(i.amortization), 0));
      saldoTotal = round2(saldoTotal + saldo);
      const b = porTipo.get(d.type) ?? { tipo: d.type, contratos: 0, saldoDevedor: 0 };
      b.contratos++;
      b.saldoDevedor = round2(b.saldoDevedor + saldo);
      porTipo.set(d.type, b);
    }

    const em30d = new Date(Date.now() + 30 * 86_400_000);
    const proximas = await this.prisma.debtInstallment.findMany({
      where: {
        debt: { companyId, status: 'ACTIVE' },
        status: 'PENDING',
        dueDate: { lte: em30d },
      },
      include: { debt: { select: { bank: true, type: true } } },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });

    return {
      saldoDevedorTotal: saldoTotal,
      contratosAtivos: debts.length,
      porTipo: [...porTipo.values()].sort((a, b) => b.saldoDevedor - a.saldoDevedor),
      proximosVencimentos: proximas.map((p) => ({
        debtId: p.debtId,
        banco: p.debt.bank,
        tipo: p.debt.type,
        parcela: p.number,
        vencimento: p.dueDate,
        valor: Number(p.amount),
      })),
    };
  }

  /** Baixa de parcela; dívida SETTLED quando todas pagas */
  async payInstallment(debtId: string, number: number, companyId: string, userId?: string) {
    const debt = await this.prisma.debt.findFirst({
      where: { id: debtId, companyId },
      include: { installments: true },
    });
    if (!debt) throw new NotFoundException(`Dívida ${debtId} não encontrada`);
    const inst = debt.installments.find((i) => i.number === number);
    if (!inst) throw new NotFoundException(`Parcela ${number} não encontrada`);
    if (inst.status === 'PAID') throw new BadRequestException(`Parcela ${number} já paga.`);

    await this.prisma.debtInstallment.update({
      where: { id: inst.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const restantes = debt.installments.filter((i) => i.id !== inst.id && i.status === 'PENDING').length;
    if (restantes === 0) {
      await this.prisma.debt.update({ where: { id: debtId }, data: { status: 'SETTLED' } });
    }
    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'DebtInstallment',
        action: 'PAY',
        payload: { debtId, number, amount: Number(inst.amount) },
      },
    });
    return { paid: true, settled: restantes === 0 };
  }

  /** Alerta diário: parcelas vencendo em até 7 dias (tipo PAYABLE_DUE) */
  @Cron('30 8 * * *', { name: 'debt-installment-due-check' })
  async alertUpcomingInstallments() {
    const em7d = new Date(Date.now() + 7 * 86_400_000);
    const proximas = await this.prisma.debtInstallment.findMany({
      where: { status: 'PENDING', dueDate: { lte: em7d, gte: new Date() }, debt: { status: 'ACTIVE' } },
      include: { debt: { select: { companyId: true, bank: true, type: true } } },
    });
    for (const p of proximas) {
      const title = `Parcela ${p.number} (${p.debt.type} ${p.debt.bank}) vence em breve`;
      const exists = await this.prisma.alert.findFirst({
        where: { companyId: p.debt.companyId, type: 'PAYABLE_DUE' as any, title, resolvedAt: null },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.alert.create({
        data: {
          companyId: p.debt.companyId,
          type: 'PAYABLE_DUE' as any,
          severity: 'WARNING' as any,
          title,
          message: `R$ ${Number(p.amount).toFixed(2)} vence em ${p.dueDate.toISOString().slice(0, 10)} (#392)`,
        },
      });
    }
    if (proximas.length > 0) this.logger.log(`Dívidas: ${proximas.length} parcelas vencendo em ≤7d`);
  }
}

/** Cronograma PRICE (parcela fixa) ou SAC (amortização fixa), juros % a.m. */
export function buildSchedule(
  principal: number,
  monthlyRate: number,
  n: number,
  firstDue: Date,
  system: 'PRICE' | 'SAC',
) {
  const schedule: Array<{
    number: number;
    dueDate: Date;
    amount: number;
    interest: number;
    amortization: number;
    balance: number;
  }> = [];
  let balance = principal;
  const pmt =
    monthlyRate > 0 ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n)) : principal / n;
  const amortSac = principal / n;

  for (let k = 1; k <= n; k++) {
    const interest = round2(balance * monthlyRate);
    let amortization: number;
    let amount: number;
    if (system === 'SAC') {
      amortization = round2(amortSac);
      amount = round2(amortization + interest);
    } else {
      amount = round2(pmt);
      amortization = round2(amount - interest);
    }
    // última parcela absorve resíduo de arredondamento
    if (k === n) {
      amortization = round2(balance);
      amount = round2(amortization + interest);
    }
    balance = round2(balance - amortization);
    const dueDate = new Date(firstDue);
    dueDate.setMonth(dueDate.getMonth() + (k - 1));
    schedule.push({ number: k, dueDate, amount, interest, amortization, balance });
  }
  return schedule;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
