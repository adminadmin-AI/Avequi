import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PDD — Provisão para Devedores Duvidosos + write-off (#389, Wellington 5.2).
 *
 * Provisão calculada sob demanda: recebíveis abertos vencidos classificados
 * pela faixa de atraso da ProvisionRule; provisão = saldo × %. Write-off é
 * baixa por perda (status WRITTEN_OFF) — some do "em aberto" do crédito e da
 * régua, mas fica distinto de CANCELLED para o relatório contábil.
 */

export const DEFAULT_PROVISION_RULES = [
  { daysFrom: 0, daysTo: 30, percentage: 1 },
  { daysFrom: 31, daysTo: 60, percentage: 5 },
  { daysFrom: 61, daysTo: 90, percentage: 10 },
  { daysFrom: 91, daysTo: 180, percentage: 30 },
  { daysFrom: 181, daysTo: 365, percentage: 70 },
  { daysFrom: 366, daysTo: 99999, percentage: 100 },
];

const OPEN_STATUSES = [
  FinancialEntryStatus.OPEN,
  FinancialEntryStatus.OVERDUE,
  FinancialEntryStatus.PARTIALLY_PAID,
];

@Injectable()
export class ProvisionService {
  constructor(private readonly prisma: PrismaService) {}

  findRules(companyId: string) {
    return this.prisma.provisionRule.findMany({
      where: { companyId },
      orderBy: { daysFrom: 'asc' },
    });
  }

  /** Cria as 6 faixas padrão (idempotente) */
  async seedDefaults(companyId: string) {
    let created = 0;
    for (const r of DEFAULT_PROVISION_RULES) {
      const exists = await this.prisma.provisionRule.findFirst({
        where: { companyId, daysFrom: r.daysFrom },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.provisionRule.create({ data: { companyId, ...r } });
      created++;
    }
    return { created, total: DEFAULT_PROVISION_RULES.length };
  }

  async updateRule(
    id: string,
    companyId: string,
    dto: Partial<{ daysFrom: number; daysTo: number; percentage: number; isActive: boolean }>,
  ) {
    const rule = await this.prisma.provisionRule.findFirst({ where: { id, companyId } });
    if (!rule) throw new NotFoundException(`Faixa de provisão ${id} não encontrada`);
    return this.prisma.provisionRule.update({ where: { id }, data: dto });
  }

  /** Relatório de PDD: provisão por faixa + detalhamento por título */
  async getPdd(companyId: string) {
    const rules = await this.prisma.provisionRule.findMany({
      where: { companyId, isActive: true },
      orderBy: { daysFrom: 'asc' },
    });
    if (rules.length === 0) {
      return { totalProvisao: 0, totalVencido: 0, faixas: [], detalhes: [], semRegras: true };
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const vencidos = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type: FinancialEntryType.RECEIVABLE,
        status: { in: OPEN_STATUSES },
        dueDate: { lt: hoje },
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        dueDate: true,
        description: true,
        salesOrder: { select: { customer: { select: { id: true, name: true } } } },
      },
    });

    const faixas = rules.map((r) => ({
      daysFrom: r.daysFrom,
      daysTo: r.daysTo,
      percentage: Number(r.percentage),
      valorVencido: 0,
      provisao: 0,
      titulos: 0,
    }));
    const detalhes: any[] = [];

    for (const e of vencidos) {
      const dias = Math.floor((hoje.getTime() - new Date(e.dueDate).setHours(0, 0, 0, 0)) / 86_400_000);
      const faixa = faixas.find((f) => dias >= f.daysFrom && dias <= f.daysTo);
      if (!faixa) continue;
      const saldo = Number(e.amount) - Number(e.paidAmount ?? 0);
      const provisao = round2((saldo * faixa.percentage) / 100);
      faixa.valorVencido = round2(faixa.valorVencido + saldo);
      faixa.provisao = round2(faixa.provisao + provisao);
      faixa.titulos++;
      detalhes.push({
        entryId: e.id,
        cliente: e.salesOrder?.customer?.name ?? null,
        descricao: e.description,
        diasAtraso: dias,
        saldo: round2(saldo),
        percentual: faixa.percentage,
        provisao,
      });
    }

    return {
      referencia: hoje.toISOString().slice(0, 10),
      totalVencido: round2(faixas.reduce((s, f) => s + f.valorVencido, 0)),
      totalProvisao: round2(faixas.reduce((s, f) => s + f.provisao, 0)),
      faixas,
      detalhes: detalhes.sort((a, b) => b.provisao - a.provisao),
    };
  }

  /** Write-off — baixa por perda (#389): irreversível, exige justificativa */
  async writeOff(entryId: string, companyId: string, reason: string, userId?: string) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id: entryId, companyId },
    });
    if (!entry) throw new NotFoundException(`Lançamento ${entryId} não encontrado`);
    if (entry.type !== FinancialEntryType.RECEIVABLE) {
      throw new BadRequestException('Write-off só se aplica a recebíveis.');
    }
    if (!OPEN_STATUSES.includes(entry.status as any)) {
      throw new BadRequestException(`Lançamento não está em aberto (status: ${entry.status}).`);
    }
    if (!reason || reason.trim().length < 10) {
      throw new BadRequestException('Justificativa do write-off é obrigatória (mínimo 10 caracteres).');
    }

    const updated = await this.prisma.financialEntry.update({
      where: { id: entryId },
      data: {
        status: FinancialEntryStatus.WRITTEN_OFF,
        paymentNote: `WRITE-OFF: ${reason.trim()}`,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'FinancialEntry',
        action: 'WRITE_OFF',
        payload: { entryId, amount: Number(entry.amount), reason: reason.trim() },
      },
    });
    return updated;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
