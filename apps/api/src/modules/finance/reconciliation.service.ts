import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FinancialEntryStatus, FinancialEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { parseOfx } from './ofx-parser';

/**
 * Conciliação bancária automática (#385, Wellington 5.2/5.3).
 *
 * Import OFX → BankStatement (idempotente por fitId) → match automático:
 *   1. exato: mesmo valor (±R$0,01) e vencimento a ±3 dias da data do extrato
 *   2. por referência: nº de documento no memo aparece na description da entry
 * Sem match → fica UNMATCHED para conciliação manual (vincular / criar
 * lançamento avulso, ex.: tarifas bancárias).
 *
 * Conciliar NÃO dá baixa: vincula extrato↔lançamento. A baixa continua sendo
 * o pay() — conciliação é evidência bancária, não decisão financeira.
 */

const OPEN_STATUSES = [
  FinancialEntryStatus.OPEN,
  FinancialEntryStatus.OVERDUE,
  FinancialEntryStatus.PARTIALLY_PAID,
];

const TOLERANCIA_VALOR = 0.01;
const TOLERANCIA_DIAS = 3;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Importa um arquivo OFX para a conta e roda o match automático */
  async importOfx(companyId: string, bankAccountId: string, ofxContent: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
    });
    if (!account) throw new NotFoundException(`Conta bancária ${bankAccountId} não encontrada`);

    const txns = parseOfx(ofxContent);
    if (txns.length === 0) {
      throw new BadRequestException('Nenhuma transação encontrada no OFX — confira o arquivo.');
    }

    const batchId = `OFX-${Date.now()}`;
    let imported = 0;
    let skipped = 0;

    for (const t of txns) {
      // idempotência por fitId (reimportar o mesmo extrato não duplica)
      const exists = t.fitId
        ? await this.prisma.bankStatement.findFirst({
            where: { companyId, bankAccountId, fitId: t.fitId },
            select: { id: true },
          })
        : null;
      if (exists) {
        skipped++;
        continue;
      }
      await this.prisma.bankStatement.create({
        data: {
          companyId,
          bankAccountId,
          transactionDate: t.date,
          amount: Math.abs(t.amount),
          description: t.description || null,
          reference: t.reference ?? null,
          type: t.type,
          fitId: t.fitId,
          importBatchId: batchId,
        },
      });
      imported++;
    }

    const match = await this.autoMatch(companyId, bankAccountId);
    return { batchId, imported, skipped, ...match };
  }

  /** Roda o algoritmo de match nos statements UNMATCHED da empresa/conta */
  async autoMatch(companyId: string, bankAccountId?: string) {
    const statements = await this.prisma.bankStatement.findMany({
      where: {
        companyId,
        matchStatus: 'UNMATCHED',
        ...(bankAccountId && { bankAccountId }),
      },
      orderBy: { transactionDate: 'asc' },
    });

    let matched = 0;
    for (const st of statements) {
      const entry = await this.findMatch(companyId, st);
      if (entry) {
        await this.prisma.bankStatement.update({
          where: { id: st.id },
          data: { matchStatus: 'MATCHED', matchedEntryId: entry.id, matchedAt: new Date() },
        });
        matched++;
      }
    }
    return { matched, unmatched: statements.length - matched };
  }

  /**
   * Match de um statement: exato (valor ±0,01 + vencimento ±3d) e depois
   * por referência (nº de documento do memo contido na description da entry).
   */
  private async findMatch(
    companyId: string,
    st: { id: string; amount: any; transactionDate: Date; description: string | null; reference: string | null; type: string },
  ) {
    const type = st.type === 'CREDIT' ? FinancialEntryType.RECEIVABLE : FinancialEntryType.PAYABLE;
    const valor = Number(st.amount);

    // entries já vinculadas a outro statement não podem ser reusadas
    const usadas = await this.prisma.bankStatement.findMany({
      where: { companyId, matchedEntryId: { not: null } },
      select: { matchedEntryId: true },
    });
    const usadasIds = usadas.map((u) => u.matchedEntryId!) as string[];

    const from = new Date(st.transactionDate.getTime() - TOLERANCIA_DIAS * 86_400_000);
    const to = new Date(st.transactionDate.getTime() + TOLERANCIA_DIAS * 86_400_000);

    // 1. match exato
    const exato = await this.prisma.financialEntry.findFirst({
      where: {
        companyId,
        type,
        status: { in: OPEN_STATUSES },
        id: { notIn: usadasIds },
        amount: { gte: valor - TOLERANCIA_VALOR, lte: valor + TOLERANCIA_VALOR },
        dueDate: { gte: from, lte: to },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (exato) return exato;

    // 2. match por referência: números (≥4 dígitos) do memo × description da entry
    const texto = `${st.description ?? ''} ${st.reference ?? ''}`;
    const refs = [...new Set(texto.match(/\d{4,}/g) ?? [])];
    for (const ref of refs) {
      const porRef = await this.prisma.financialEntry.findFirst({
        where: {
          companyId,
          type,
          status: { in: OPEN_STATUSES },
          id: { notIn: usadasIds },
          description: { contains: ref },
          // referência forte, valor com tolerância de 1% (juros/desconto pequenos)
          amount: { gte: valor * 0.99, lte: valor * 1.01 },
        },
      });
      if (porRef) return porRef;
    }
    return null;
  }

  /** Lançamentos sem correspondência + candidatos sugeridos para o manual */
  async getUnmatched(companyId: string, bankAccountId?: string) {
    const statements = await this.prisma.bankStatement.findMany({
      where: {
        companyId,
        matchStatus: 'UNMATCHED',
        ...(bankAccountId && { bankAccountId }),
      },
      orderBy: { transactionDate: 'desc' },
      take: 200,
    });

    const result = [] as any[];
    for (const st of statements) {
      const type = st.type === 'CREDIT' ? FinancialEntryType.RECEIVABLE : FinancialEntryType.PAYABLE;
      const valor = Number(st.amount);
      // sugestões: abertas do mesmo tipo, valor a ±10%, mais próximas primeiro
      const candidates = await this.prisma.financialEntry.findMany({
        where: {
          companyId,
          type,
          status: { in: OPEN_STATUSES },
          amount: { gte: valor * 0.9, lte: valor * 1.1 },
        },
        select: { id: true, description: true, amount: true, dueDate: true, status: true },
        orderBy: { dueDate: 'asc' },
        take: 3,
      });
      result.push({ ...st, amount: valor, suggestions: candidates });
    }
    return result;
  }

  /** Vínculo manual extrato ↔ lançamento */
  async matchManual(companyId: string, statementId: string, entryId: string) {
    const [st, entry] = await Promise.all([
      this.prisma.bankStatement.findFirst({ where: { id: statementId, companyId } }),
      this.prisma.financialEntry.findFirst({ where: { id: entryId, companyId } }),
    ]);
    if (!st) throw new NotFoundException(`Lançamento de extrato ${statementId} não encontrado`);
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${entryId} não encontrado`);
    const jaUsada = await this.prisma.bankStatement.findFirst({
      where: { companyId, matchedEntryId: entryId, id: { not: statementId } },
      select: { id: true },
    });
    if (jaUsada) {
      throw new BadRequestException('Este lançamento financeiro já está conciliado com outro item do extrato.');
    }
    return this.prisma.bankStatement.update({
      where: { id: st.id },
      data: { matchStatus: 'MATCHED', matchedEntryId: entryId, matchedAt: new Date() },
    });
  }

  /** Desfaz uma conciliação */
  async unmatch(companyId: string, statementId: string) {
    const st = await this.prisma.bankStatement.findFirst({ where: { id: statementId, companyId } });
    if (!st) throw new NotFoundException(`Lançamento de extrato ${statementId} não encontrado`);
    return this.prisma.bankStatement.update({
      where: { id: st.id },
      data: { matchStatus: 'UNMATCHED', matchedEntryId: null, matchedAt: null },
    });
  }

  /**
   * Cria lançamento avulso a partir de item do extrato sem correspondência
   * (tarifa bancária, IOF, rendimento) — nasce PAID e já conciliado.
   */
  async createEntryFromStatement(
    companyId: string,
    statementId: string,
    dto: { description?: string; categoryId?: string } = {},
  ) {
    const st = await this.prisma.bankStatement.findFirst({ where: { id: statementId, companyId } });
    if (!st) throw new NotFoundException(`Lançamento de extrato ${statementId} não encontrado`);
    if (st.matchStatus === 'MATCHED') {
      throw new BadRequestException('Item do extrato já conciliado.');
    }

    const entry = await this.prisma.financialEntry.create({
      data: {
        companyId,
        type: st.type === 'CREDIT' ? FinancialEntryType.RECEIVABLE : FinancialEntryType.PAYABLE,
        status: FinancialEntryStatus.PAID,
        amount: st.amount,
        paidAmount: st.amount,
        dueDate: st.transactionDate,
        paidAt: st.transactionDate,
        description: dto.description ?? st.description ?? 'Lançamento de extrato bancário',
        source: 'MANUAL' as any,
        ...(dto.categoryId && { categoryId: dto.categoryId }),
      },
    });
    await this.prisma.bankStatement.update({
      where: { id: st.id },
      data: { matchStatus: 'MATCHED', matchedEntryId: entry.id, matchedAt: new Date() },
    });
    return entry;
  }
}
