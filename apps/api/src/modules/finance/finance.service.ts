import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CollectionAttemptChannel, DebtorType, FinancialEntryStatus, FinancialEntryType, Prisma, ScheduledPaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTALLMENT_METHODS, isCardMethod } from '../acquirer/payment-classification';
import {
  FUSO_OPERACIONAL,
  dataOperacionalHoje,
  limiteDeDataPura,
  somarDias,
} from '../../common/date/dia-operacional';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Divide um total em N parcelas de centavos consistentes: as N−1 primeiras
 * iguais (piso) e a última absorvendo o resto, de modo que a soma feche exato.
 * Fonte única do rateio de parcelas (cartão, boleto e createInstallments).
 */
function splitInstallments(total: number, n: number): { number: number; amount: number }[] {
  const base = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    amount: i === n - 1 ? round2(total - base * (n - 1)) : base,
  }));
}
import { SupplierAdvanceService } from './supplier-advance.service';
import { PayEntryDto } from './dto/pay-entry.dto';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateInstallmentsDto } from './dto/create-installments.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { CreateManualEntryDto } from './dto/create-manual-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { ConfigureBankAccountDto } from './dto/configure-bank-account.dto';
import { CreateScheduledPaymentDto } from './dto/create-scheduled-payment.dto';
import { TriggerCollectionDto } from './dto/trigger-collection.dto';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly advanceService: SupplierAdvanceService,
  ) {}

  // ─── S09.02: Gerar CR de venda confirmada ────────────────────────────────

  /**
   * #586 — Gera os títulos da venda a partir do PLANO DE PAGAMENTO (#584):
   * - à vista (PIX/dinheiro/TED) → 1 CR contra o CLIENTE, D+0;
   * - boleto/cheque N× → N parcelas contra o CLIENTE, vencendo a cada 30 dias;
   * - cartão crédito N× → N CRs contra a ADQUIRENTE, valor LÍQUIDO (bruto − MDR),
   *   liquidando em D+settlement, +30 dias por parcela; MDR vira despesa PAGA;
   * - cartão débito → 1 CR líquido contra a ADQUIRENTE em D+settlement.
   * Sem plano → comportamento legado (1 CR cliente, 30 dias).
   */
  async createReceivableForSale(params: {
    companyId: string;
    salesOrderId: string;
    amount: number;
    dueDate?: Date;
    fiscalDocumentId?: string;
  }): Promise<void> {
    // Idempotência: se a venda já tem qualquer CR, não regenera (1:N desde #586)
    const existing = await this.prisma.financialEntry.findFirst({
      where: { salesOrderId: params.salesOrderId, type: FinancialEntryType.RECEIVABLE },
    });
    if (existing) {
      this.logger.warn(`CR já existe para OV ${params.salesOrderId}`);
      return;
    }

    const order = await this.prisma.salesOrder.findFirst({
      where: { id: params.salesOrderId, companyId: params.companyId },
      include: { payments: true },
    });
    const plan = order?.payments ?? [];

    // ── Legado: venda sem plano de pagamento → 1 CR cliente em 30 dias ──────
    if (plan.length === 0) {
      // Vencimento é DATA DE NEGÓCIO (#901): parte do dia operacional, não do
      // instante do processo. Venda fechada às 22h de 14/08 continua contando
      // a partir de 14/08 — antes, o relógio UTC já dizia 15/08.
      const dueDate = params.dueDate ?? this.vencimentoEmDias(30);
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
      return;
    }

    // ── Plano de pagamento → N títulos ──────────────────────────────────────
    // Data-base do plano: o DIA OPERACIONAL do faturamento (#901).
    const diaDoFaturamento = dataOperacionalHoje();

    const receivables: any[] = [];

    for (const p of plan) {
      const n = p.installments ?? 1;
      const gross = Number(p.amount);

      if (isCardMethod(p.method)) {
        // Devedor = ADQUIRENTE (não o cliente!), valor LÍQUIDO (bruto − MDR),
        // liquidação real. A MDR NÃO vira uma despesa separada: como a receita
        // do ERP deriva dos recebíveis (getDre), lançar a MDR à parte contaria
        // duas vezes. O valor/percentual da MDR fica em SalesPayment.mdrAmount
        // p/ relatório de taxas de cartão (fonte da conciliação #588).
        const mdr = Number(p.mdrAmount ?? 0);
        const net = round2(gross - mdr);
        const settlement = p.settlementDays ?? 30;
        for (const inst of splitInstallments(net, n)) {
          receivables.push({
            companyId: params.companyId,
            type: FinancialEntryType.RECEIVABLE,
            status: FinancialEntryStatus.OPEN,
            amount: inst.amount,
            dueDate: this.vencimentoEmDias(settlement + 30 * (inst.number - 1), diaDoFaturamento),
            description: `Venda #${params.salesOrderId} — cartão ${inst.number}/${n} (líquido adquirente)`,
            salesOrderId: params.salesOrderId,
            debtorType: DebtorType.ACQUIRER,
            acquirerId: p.acquirerId,
            salesPaymentId: p.id,
            installmentNumber: inst.number,
          });
        }
      } else if (INSTALLMENT_METHODS.includes(p.method)) {
        // Cliente paga em N parcelas — vencimento a cada 30 dias
        for (const inst of splitInstallments(gross, n)) {
          receivables.push({
            companyId: params.companyId,
            type: FinancialEntryType.RECEIVABLE,
            status: FinancialEntryStatus.OPEN,
            amount: inst.amount,
            dueDate: this.vencimentoEmDias(30 * inst.number, diaDoFaturamento),
            description: `Venda #${params.salesOrderId} — ${p.method} ${inst.number}/${n}`,
            salesOrderId: params.salesOrderId,
            debtorType: DebtorType.CUSTOMER,
            salesPaymentId: p.id,
            installmentNumber: inst.number,
          });
        }
      } else {
        // À vista (PIX/dinheiro/TED) — cliente, D+0
        receivables.push({
          companyId: params.companyId,
          type: FinancialEntryType.RECEIVABLE,
          status: FinancialEntryStatus.OPEN,
          amount: gross,
          dueDate: this.vencimentoEmDias(0, diaDoFaturamento),
          description: `Venda #${params.salesOrderId} — ${p.method} à vista`,
          salesOrderId: params.salesOrderId,
          debtorType: DebtorType.CUSTOMER,
          salesPaymentId: p.id,
          installmentNumber: 1,
        });
      }
    }

    // NF-e vinculada ao primeiro título (fiscalDocumentId segue @unique)
    if (params.fiscalDocumentId && receivables.length > 0) {
      receivables[0].fiscalDocumentId = params.fiscalDocumentId;
    }

    // 1 statement (createMany) em vez de N inserts sequenciais — evita segurar
    // a conexão do pooler por N round-trips (lição P2024, #498). A unique parcial
    // (salesPaymentId, installmentNumber) faz um evento duplicado falhar atômico
    // em vez de duplicar o plano.
    await this.prisma.financialEntry.createMany({ data: receivables });

    await this.prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        entity: 'FinancialEntry',
        action: 'CREATE_RECEIVABLES_PLAN',
        payload: { salesOrderId: params.salesOrderId, receivables: receivables.length },
      },
    });

    this.logger.log(
      `Plano de pagamento OV ${params.salesOrderId}: ${receivables.length} título(s) gerado(s)`,
    );
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

    // #393: abate adiantamentos abertos do fornecedor automaticamente
    try {
      const po = await this.prisma.purchaseOrder.findUnique({
        where: { id: params.purchaseOrderId },
        select: { supplierId: true },
      });
      if (po?.supplierId) {
        await this.advanceService.applyToPayable(params.companyId, po.supplierId, entry.id);
      }
    } catch (err) {
      // adiantamento é conveniência — falha não pode quebrar a criação do payable
      this.logger.error(`Falha ao aplicar adiantamento no payable ${entry.id}: ${(err as Error).message}`);
    }
  }

  // ─── Lançamento manual (avulso) ────────────────────────────────────────────

  async createManualEntry(companyId: string, dto: CreateManualEntryDto) {
    const recurrence = dto.recurrence ?? 'NONE';
    const count = recurrence !== 'NONE' ? (dto.recurrenceCount ?? 6) : 1;

    const entries = Array.from({ length: count }, (_, i) => {
      const dueDate = new Date(dto.dueDate);
      if (recurrence === 'MONTHLY') dueDate.setMonth(dueDate.getMonth() + i);
      else if (recurrence === 'WEEKLY') dueDate.setDate(dueDate.getDate() + i * 7);

      // #788 — previsão de pagamento: usa a informada; senão, o vencimento
      // (recalculado por parcela na recorrência).
      const expectedPaymentDate = dto.expectedPaymentDate
        ? new Date(dto.expectedPaymentDate)
        : new Date(dueDate);

      return {
        companyId,
        type: dto.type as FinancialEntryType,
        status: FinancialEntryStatus.OPEN,
        amount: dto.amount,
        dueDate,
        expectedPaymentDate,
        description: count > 1 ? `${dto.description} (${i + 1}/${count})` : dto.description,
        source: 'MANUAL' as const,
        supplierId: dto.supplierId ?? null, // #785
        categoryId: dto.categoryId ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
        // Fase 2 do detalhe — pagamento/documento
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        documentNumber: dto.documentNumber || null,
        paymentMethod: dto.paymentMethod ?? null,
        boletoBarcode: dto.boletoBarcode || null,
        pixCopiaECola: dto.pixCopiaECola || null,
      };
    });

    const created = await this.prisma.$transaction(
      entries.map((data) => this.prisma.financialEntry.create({ data })),
    );

    // Cost center split if provided
    if (dto.costCenterId) {
      await this.prisma.$transaction(
        created.map((entry) =>
          this.prisma.entryCostCenterSplit.create({
            data: {
              entryId: entry.id,
              costCenterId: dto.costCenterId!,
              percentage: 100,
              amount: dto.amount,
            },
          }),
        ),
      );
    }

    this.logger.log(`Manual entries criados: ${created.length} — ${dto.description}`);
    return created;
  }

  // ─── Editar título EM ABERTO (OPEN/OVERDUE) ───────────────────────────────
  // Só campos de cadastro. Pago/cancelado/parcial NÃO podem ser editados —
  // esses têm fluxo próprio (pay/cancel) e mexer neles corromperia o histórico.
  // `costCenterId`: undefined = mantém rateio atual; null = remove todo o
  // rateio; id = substitui por um único split a 100% (semântica de 3 vias).
  async updateEntry(
    id: string,
    companyId: string,
    dto: UpdateFinancialEntryDto,
    actorId?: string,
  ) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId }, // escopo de empresa: título de outra empresa = 404
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);

    const editableStatuses: FinancialEntryStatus[] = [
      FinancialEntryStatus.OPEN,
      FinancialEntryStatus.OVERDUE,
    ];
    if (!editableStatuses.includes(entry.status)) {
      throw new BadRequestException(
        `Só é possível editar lançamentos em aberto. Status atual: ${entry.status}`,
      );
    }

    // Ponto 4 — vínculo financeiro vivo: agendamento PENDING guarda snapshot do
    // valor e reserva saldo da conta. Editar valor/vencimento/fornecedor deixaria
    // a instrução de pagamento divergente. Bloqueio conservador: exige cancelar o
    // agendamento antes (mesma filosofia do cancel() com PARTIALLY_PAID).
    const pendingScheduled = await this.prisma.scheduledPayment.count({
      where: { financialEntryId: id, companyId, status: ScheduledPaymentStatus.PENDING },
    });
    if (pendingScheduled > 0) {
      throw new BadRequestException(
        'Título com pagamento agendado pendente não pode ser editado. Cancele o agendamento primeiro.',
      );
    }

    // Ponto 5 — isolamento entre empresas: fornecedor/categoria/centro têm que
    // pertencer à MESMA empresa do usuário. Não achou na empresa = 404 (não
    // revela existência em outra empresa).
    if (dto.supplierId) {
      const ok = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId }, select: { id: true },
      });
      if (!ok) throw new NotFoundException(`Fornecedor ${dto.supplierId} não encontrado`);
    }
    if (dto.categoryId) {
      const ok = await this.prisma.financialCategory.findFirst({
        where: { id: dto.categoryId, companyId }, select: { id: true },
      });
      if (!ok) throw new NotFoundException(`Categoria ${dto.categoryId} não encontrada`);
    }
    if (dto.costCenterId) {
      const ok = await this.prisma.costCenter.findFirst({
        where: { id: dto.costCenterId, companyId }, select: { id: true },
      });
      if (!ok) throw new NotFoundException(`Centro de custo ${dto.costCenterId} não encontrado`);
    }

    // Monta o update SOMENTE com os campos enviados (PATCH parcial) e registra
    // antes→depois só do que realmente muda (Ponto 9 — auditoria útil).
    const data: Prisma.FinancialEntryUncheckedUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const track = (field: string, from: unknown, to: unknown) => {
      changes[field] = { from, to };
    };

    if (dto.description !== undefined && dto.description !== entry.description) {
      data.description = dto.description;
      track('description', entry.description, dto.description);
    }
    if (dto.amount !== undefined && dto.amount !== Number(entry.amount)) {
      data.amount = dto.amount;
      track('amount', Number(entry.amount), dto.amount);
    }
    if (dto.dueDate !== undefined) {
      const newDue = new Date(dto.dueDate);
      if (newDue.getTime() !== entry.dueDate.getTime()) {
        data.dueDate = newDue;
        track('dueDate', entry.dueDate, newDue);
      }
      // Ponto 6 — status é PERSISTIDO (cron markOverdue). Ao mudar o vencimento,
      // reconcilia OPEN/OVERDUE pela regra oficial (vencido = dueDate < hoje 00h).
      const limiteDeHoje = limiteDeDataPura(dataOperacionalHoje());
      const reconciled =
        newDue < limiteDeHoje ? FinancialEntryStatus.OVERDUE : FinancialEntryStatus.OPEN;
      if (reconciled !== entry.status) {
        data.status = reconciled;
        track('status', entry.status, reconciled);
      }
    }
    if (dto.expectedPaymentDate !== undefined) {
      const newExp = new Date(dto.expectedPaymentDate);
      if (newExp.getTime() !== entry.expectedPaymentDate?.getTime()) {
        data.expectedPaymentDate = newExp;
        track('expectedPaymentDate', entry.expectedPaymentDate, newExp);
      }
    }
    // Escalares (igual createManualEntry): '' / null desvincula.
    if (dto.supplierId !== undefined) {
      const to = dto.supplierId || null;
      if (to !== entry.supplierId) { data.supplierId = to; track('supplierId', entry.supplierId, to); }
    }
    if (dto.categoryId !== undefined) {
      const to = dto.categoryId || null;
      if (to !== entry.categoryId) { data.categoryId = to; track('categoryId', entry.categoryId, to); }
    }
    // Fase 2 do detalhe — pagamento/documento ('' / null limpa o campo).
    if (dto.issueDate !== undefined) {
      const to = dto.issueDate ? new Date(dto.issueDate) : null;
      if (to?.getTime() !== entry.issueDate?.getTime()) {
        data.issueDate = to;
        track('issueDate', entry.issueDate, to);
      }
    }
    if (dto.documentNumber !== undefined) {
      const to = dto.documentNumber || null;
      if (to !== entry.documentNumber) {
        data.documentNumber = to;
        track('documentNumber', entry.documentNumber, to);
      }
    }
    if (dto.paymentMethod !== undefined) {
      const to = dto.paymentMethod ?? null;
      if (to !== entry.paymentMethod) {
        data.paymentMethod = to;
        track('paymentMethod', entry.paymentMethod, to);
      }
    }
    if (dto.boletoBarcode !== undefined) {
      const to = dto.boletoBarcode || null;
      if (to !== entry.boletoBarcode) {
        data.boletoBarcode = to;
        track('boletoBarcode', entry.boletoBarcode, to);
      }
    }
    if (dto.pixCopiaECola !== undefined) {
      const to = dto.pixCopiaECola || null;
      if (to !== entry.pixCopiaECola) {
        data.pixCopiaECola = to;
        track('pixCopiaECola', entry.pixCopiaECola, to);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.financialEntry.update({ where: { id }, data });

      // Centro de custo (Ponto 7, semântica de 3 vias):
      //   undefined → não toca (preserva rateio multi-centro da migração Omie);
      //   null      → remove TODO o rateio;
      //   id        → substitui por um único split a 100%.
      if (dto.costCenterId !== undefined) {
        await tx.entryCostCenterSplit.deleteMany({ where: { entryId: id } });
        if (dto.costCenterId) {
          const effectiveAmount = dto.amount ?? Number(entry.amount);
          await tx.entryCostCenterSplit.create({
            data: {
              entryId: id,
              costCenterId: dto.costCenterId,
              percentage: 100,
              amount: effectiveAmount,
            },
          });
        }
        track('costCenter', '(rateio anterior)', dto.costCenterId ?? '(removido)');
      }

      await tx.auditLog.create({
        data: {
          userId: actorId ?? null, // ator (Ponto 9)
          companyId,
          entity: 'FinancialEntry',
          action: 'UPDATE',
          payload: { id, changes } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `FinancialEntry ${id} editado (em aberto) por ${actorId ?? '?'} — campos: ${Object.keys(changes).join(', ') || 'nenhum'}`,
    );
    return this.findOne(id, companyId);
  }

  // ─── Fase 2 do detalhe: histórico do título (AuditLog → timeline) ──────────

  /**
   * Timeline "quem fez o quê, quando" do lançamento. Fonte = AuditLog v1
   * (as ações do financeiro gravam `payload.id` do título — updateEntry inclui
   * o diff antes→depois em `payload.changes`). Escopo de empresa: título de
   * outra empresa = 404, sem revelar existência.
   */
  async entryHistory(id: string, companyId: string) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, companyId },
      select: { id: true, createdAt: true, source: true },
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);

    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: 'FinancialEntry',
        payload: { path: ['id'], equals: id },
      },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });

    return {
      createdAt: entry.createdAt, // âncora: títulos migrados não têm log de criação
      source: entry.source,
      events: logs.map((l) => ({
        at: l.createdAt,
        action: l.action,
        user: l.user, // null = ação de sistema (cron/evento) ou pré-auditoria
        changes: (l.payload as { changes?: unknown } | null)?.changes ?? null,
      })),
    };
  }

  // ─── #864 anti-fraude: dados bancários do fornecedor mudaram há pouco? ─────

  /** Dias da janela do aviso de troca bancária (decisão do Rafael: 15). */
  private static readonly BANKING_ALERT_WINDOW_DAYS = 15;

  /**
   * Última TROCA (A→B; primeiro preenchimento não conta) de chave PIX/dados
   * bancários do fornecedor do título, dentro da janela. Alimenta o aviso
   * amarelo no detalhe/baixa de Contas a Pagar. Escopo de empresa via o
   * próprio título (404) — permissão reusada: finance.entries.view.
   */
  async bankingAlert(entryId: string, companyId: string) {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id: entryId, companyId },
      select: { id: true, supplierId: true },
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${entryId} não encontrado`);
    if (!entry.supplierId) return { alert: null };

    const since = new Date();
    since.setDate(since.getDate() - FinanceService.BANKING_ALERT_WINDOW_DAYS);

    const log = await this.prisma.auditLog.findFirst({
      where: {
        companyId,
        entity: 'Supplier',
        action: 'BANKING_UPDATE',
        createdAt: { gte: since },
        AND: [
          { payload: { path: ['id'], equals: entry.supplierId } },
          { payload: { path: ['troca'], equals: true } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!log) return { alert: null };

    const changes =
      (log.payload as { changes?: Record<string, { from: unknown; to: unknown }> } | null)
        ?.changes ?? {};
    return {
      alert: {
        at: log.createdAt,
        by: log.user, // null = mudança de sistema/pré-auditoria
        fields: Object.keys(changes),
      },
    };
  }

  // ─── S09.05: Registrar pagamento (parcial ou total) ───────────────────────

  async pay(id: string, companyId: string, dto: PayEntryDto, actorId?: string) {
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

    // Build transaction operations
    const operations: any[] = [
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
          userId: actorId ?? null, // quem baixou — aparece no histórico do título
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
    ];

    // Update BankAccount balance if linked
    if (dto.bankAccountId) {
      const balanceChange = entry.type === FinancialEntryType.RECEIVABLE
        ? dto.paidAmount    // Recebível → credita
        : -dto.paidAmount;  // Pagável → debita

      operations.push(
        this.prisma.bankAccount.update({
          where: { id: dto.bankAccountId },
          data: { balance: { increment: balanceChange } },
        }),
      );
    }

    const [payment] = await this.prisma.$transaction(operations);

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

  async createInstallments(id: string, companyId: string, dto: CreateInstallmentsDto, actorId?: string) {
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
    const installmentsData = splitInstallments(totalAmount, dto.numberOfInstallments).map((inst) => {
      const dueDate = new Date(dto.firstDueDate);
      dueDate.setDate(dueDate.getDate() + (inst.number - 1) * dto.intervalDays);

      return {
        companyId: entry.companyId,
        type: entry.type,
        status: FinancialEntryStatus.OPEN,
        amount: inst.amount,
        dueDate,
        description: `${entry.description ?? 'Parcela'} (${inst.number}/${dto.numberOfInstallments})`,
        parentEntryId: entry.id,
        salesOrderId: entry.salesOrderId ?? null,
        purchaseOrderId: entry.purchaseOrderId ?? null,
        goodsReceiptId: entry.goodsReceiptId ?? null,
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
          userId: actorId ?? null, // quem parcelou — aparece no histórico do título
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

  async cancel(id: string, companyId: string, actorId?: string): Promise<void> {
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
        userId: actorId ?? null, // quem cancelou — aparece no histórico do título
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
        supplier: true, // #785 — fornecedor direto (títulos sem PO, ex.: migração Omie)
        goodsReceipt: true,
        fiscalDocument: { select: { id: true, chave: true, status: true } },
        // Fase 2 do detalhe — categoria e rateio p/ o painel (nome, % e valor)
        category: { select: { id: true, name: true } },
        costCenterSplits: {
          select: {
            id: true,
            percentage: true,
            amount: true,
            costCenter: { select: { id: true, name: true } },
          },
        },
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
        supplier: true, // #785 — fornecedor direto (títulos sem PO)
        goodsReceipt: { include: { items: { include: { product: true } } } },
        fiscalDocument: true,
        payments: { orderBy: { paidAt: 'asc' } },
        installments: { orderBy: { dueDate: 'asc' } },
        // Fase 2 do detalhe — categoria e rateio
        category: { select: { id: true, name: true } },
        costCenterSplits: {
          select: {
            id: true,
            percentage: true,
            amount: true,
            costCenter: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${id} não encontrado`);
    return entry;
  }

  // ─── S09.05b: Cron diário — OPEN vencidos → OVERDUE ─────────────────────

  /**
   * Vira a chave dos vencidos na VIRADA REAL do dia brasileiro (#901).
   *
   * O fuso explícito é parte da correção, não enfeite: sem ele o cron dispara
   * à meia-noite UTC, que é 21h em São Paulo — e marcava como vencido o título
   * que vencia naquele mesmo dia, três horas antes de o dia acabar. Corrigir
   * só a comparação e manter 00:00 UTC inverteria o erro: o título de ontem só
   * viraria OVERDUE às 21h de hoje, 21 horas atrasado.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'finance-mark-overdue',
    timeZone: FUSO_OPERACIONAL,
  })
  async markOverdue(): Promise<void> {
    // Data pura contra data pura: quem vence HOJE não é anterior a hoje.
    const limiteDeHoje = limiteDeDataPura(dataOperacionalHoje());

    // tenant-lint: ok (cron de sistema: OPEN vencido vira OVERDUE em todos os tenants por design)
    const { count } = await this.prisma.financialEntry.updateMany({
      where: {
        status: FinancialEntryStatus.OPEN,
        dueDate: { lt: limiteDeHoje },
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

  // ─── DRE gerencial ────────────────────────────────────────────────────────

  async getDre(companyId: string, filters: { from?: string; to?: string; costCenterId?: string } = {}) {
    const where: any = {
      companyId,
      status: FinancialEntryStatus.PAID,
    };
    if (filters.from || filters.to) {
      where.paidAt = {};
      if (filters.from) where.paidAt.gte = new Date(filters.from);
      if (filters.to) where.paidAt.lte = new Date(filters.to);
    }
    if (filters.costCenterId) {
      where.costCenterSplits = { some: { costCenterId: filters.costCenterId } };
    }

    const entries = await this.prisma.financialEntry.findMany({
      where,
      select: {
        type: true,
        amount: true,
        status: true,
        categoryId: true,
        category: { select: { code: true, name: true, type: true, dreCode: true } },
      },
    });

    let receitaBruta = 0;
    let deducoes = 0;
    let cpv = 0;
    let despesasOp = 0;
    const byCategory: Record<string, { code: string; name: string; dreCode: string | null; total: number }> = {};

    for (const e of entries) {
      const amount = Number(e.amount);
      const catCode = e.category?.code ?? 'SEM-CAT';
      const catName = e.category?.name ?? 'Sem Categoria';
      const dreCode = e.category?.dreCode ?? null;

      if (!byCategory[catCode]) {
        byCategory[catCode] = { code: catCode, name: catName, dreCode, total: 0 };
      }
      byCategory[catCode].total += amount;

      if (e.type === FinancialEntryType.RECEIVABLE) {
        receitaBruta += amount;
      } else {
        // Classify by dreCode prefix
        if (dreCode?.startsWith('2')) cpv += amount;
        else if (dreCode?.startsWith('3')) despesasOp += amount;
        else deducoes += amount;
      }
    }

    const receitaLiquida = receitaBruta - deducoes;
    const lucroBruto = receitaLiquida - cpv;
    const resultadoOperacional = lucroBruto - despesasOp;

    return {
      period: { from: filters.from ?? null, to: filters.to ?? null },
      receitaBruta,
      deducoes,
      receitaLiquida,
      cpv,
      lucroBruto,
      despesasOperacionais: despesasOp,
      resultadoOperacional,
      margemBruta: receitaBruta > 0 ? +(lucroBruto / receitaBruta * 100).toFixed(2) : 0,
      margemOperacional: receitaBruta > 0 ? +(resultadoOperacional / receitaBruta * 100).toFixed(2) : 0,
      detalhamento: Object.values(byCategory).sort((a, b) => (a.dreCode ?? '').localeCompare(b.dreCode ?? '')),
    };
  }

  // ─── Fluxo de caixa projetado dia-a-dia ────────────────────────────────────

  async getCashFlowProjection(companyId: string, filters: { days?: number; bankAccountId?: string } = {}) {
    const days = filters.days ?? 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = this.addDays(today, days);

    // Get current balance
    const accountWhere: any = { companyId, active: true };
    if (filters.bankAccountId) accountWhere.id = filters.bankAccountId;

    const accounts = await this.prisma.bankAccount.findMany({
      where: accountWhere,
      select: { balance: true },
    });
    const currentBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);

    // Get open/overdue/partially_paid entries in the period
    const entries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.OVERDUE, FinancialEntryStatus.PARTIALLY_PAID] },
        dueDate: { gte: today, lte: endDate },
      },
      select: { type: true, amount: true, paidAmount: true, dueDate: true, description: true },
      orderBy: { dueDate: 'asc' },
    });

    // #392: parcelas de dívida PENDING no período entram como saída projetada
    const debtInstallments = await this.prisma.debtInstallment.findMany({
      where: {
        debt: { companyId, status: 'ACTIVE' },
        status: 'PENDING',
        dueDate: { gte: today, lte: endDate },
      },
      select: { amount: true, dueDate: true },
    });
    for (const di of debtInstallments) {
      entries.push({
        type: FinancialEntryType.PAYABLE,
        amount: di.amount,
        paidAmount: null,
        dueDate: di.dueDate,
        description: 'Parcela de financiamento (#392)',
      } as any);
    }

    // Build day-by-day projection
    const projection: Array<{
      date: string;
      receivable: number;
      payable: number;
      netFlow: number;
      projectedBalance: number;
      alert: boolean;
    }> = [];

    let runningBalance = currentBalance;

    for (let i = 0; i <= days; i++) {
      const date = this.addDays(today, i);
      const dateStr = date.toISOString().split('T')[0];

      let dayReceivable = 0;
      let dayPayable = 0;

      for (const e of entries) {
        const entryDate = new Date(e.dueDate);
        entryDate.setHours(0, 0, 0, 0);
        if (entryDate.getTime() === date.getTime()) {
          const remaining = Number(e.amount) - Number(e.paidAmount ?? 0);
          if (e.type === FinancialEntryType.RECEIVABLE) dayReceivable += remaining;
          else dayPayable += remaining;
        }
      }

      const netFlow = dayReceivable - dayPayable;
      runningBalance += netFlow;

      projection.push({
        date: dateStr,
        receivable: +dayReceivable.toFixed(2),
        payable: +dayPayable.toFixed(2),
        netFlow: +netFlow.toFixed(2),
        projectedBalance: +runningBalance.toFixed(2),
        alert: runningBalance < 0,
      });
    }

    const alertDays = projection.filter((d) => d.alert);

    return {
      currentBalance,
      days,
      alertDaysCount: alertDays.length,
      firstAlertDate: alertDays.length > 0 ? alertDays[0].date : null,
      projection,
    };
  }

  /**
   * #383 — Fluxo de caixa 13 semanas rolantes (padrão de tesouraria industrial).
   * Agrega a projeção diária em semanas civis (segunda a domingo).
   */
  async getCashFlowWeekly(companyId: string, filters: { weeks?: number; bankAccountId?: string } = {}) {
    const weeks = filters.weeks ?? 13;
    const daily = await this.getCashFlowProjection(companyId, {
      days: weeks * 7 + 6, // margem p/ completar a última semana civil
      bankAccountId: filters.bankAccountId,
    });

    const buckets = new Map<string, { weekStart: string; weekEnd: string; inflow: number; outflow: number; projectedBalance: number }>();
    for (const d of daily.projection) {
      const date = new Date(`${d.date}T12:00:00Z`);
      const dow = (date.getUTCDay() + 6) % 7; // 0 = segunda
      const start = new Date(date.getTime() - dow * 86_400_000);
      const key = start.toISOString().slice(0, 10);
      const end = new Date(start.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
      const b = buckets.get(key) ?? { weekStart: key, weekEnd: end, inflow: 0, outflow: 0, projectedBalance: 0 };
      b.inflow += d.receivable;
      b.outflow += d.payable;
      b.projectedBalance = d.projectedBalance; // saldo do último dia da semana
      buckets.set(key, b);
    }

    const weeksArr = [...buckets.values()].slice(0, weeks).map((b) => ({
      ...b,
      inflow: +b.inflow.toFixed(2),
      outflow: +b.outflow.toFixed(2),
      netFlow: +(b.inflow - b.outflow).toFixed(2),
      projectedBalance: +b.projectedBalance.toFixed(2),
      alert: b.projectedBalance < 0,
    }));

    return {
      currentBalance: daily.currentBalance,
      weeks: weeksArr.length,
      firstAlertWeek: weeksArr.find((w) => w.alert)?.weekStart ?? null,
      projection: weeksArr,
    };
  }

  /** #383 — Fluxo de caixa 12 meses rolantes (agrega a projeção diária por mês) */
  async getCashFlowMonthly(companyId: string, filters: { months?: number; bankAccountId?: string } = {}) {
    const months = filters.months ?? 12;
    const daily = await this.getCashFlowProjection(companyId, {
      days: months * 31,
      bankAccountId: filters.bankAccountId,
    });

    const buckets = new Map<string, { month: string; inflow: number; outflow: number; projectedBalance: number }>();
    for (const d of daily.projection) {
      const key = d.date.slice(0, 7); // YYYY-MM
      const b = buckets.get(key) ?? { month: key, inflow: 0, outflow: 0, projectedBalance: 0 };
      b.inflow += d.receivable;
      b.outflow += d.payable;
      b.projectedBalance = d.projectedBalance;
      buckets.set(key, b);
    }

    const monthsArr = [...buckets.values()].slice(0, months).map((b) => ({
      ...b,
      inflow: +b.inflow.toFixed(2),
      outflow: +b.outflow.toFixed(2),
      netFlow: +(b.inflow - b.outflow).toFixed(2),
      projectedBalance: +b.projectedBalance.toFixed(2),
      alert: b.projectedBalance < 0,
    }));

    return {
      currentBalance: daily.currentBalance,
      months: monthsArr.length,
      firstAlertMonth: monthsArr.find((m) => m.alert)?.month ?? null,
      projection: monthsArr,
    };
  }

  /**
   * #390 — Projeção de caixa com cenários (base / otimista / estresse).
   * Deriva da projeção diária: receitas × revenueMultiplier × (1 − inadimplência
   * efetiva), despesas × expenseMultiplier. Inadimplência base estimada do aging
   * atual (vencido aberto / recebível total vencido) e escalada por cenário.
   */
  async getCashFlowScenarios(companyId: string, filters: { days?: number; bankAccountId?: string } = {}) {
    const daily = await this.getCashFlowProjection(companyId, filters);

    // inadimplência histórica: % dos recebíveis vencidos que segue em aberto
    const hoje = new Date();
    const [vencidoAberto, recebidoRecente] = await Promise.all([
      this.prisma.financialEntry.aggregate({
        where: {
          companyId,
          type: FinancialEntryType.RECEIVABLE,
          status: { in: [FinancialEntryStatus.OVERDUE, FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
          dueDate: { lt: hoje },
        },
        _sum: { amount: true, paidAmount: true },
      }),
      this.prisma.financialEntry.aggregate({
        where: {
          companyId,
          type: FinancialEntryType.RECEIVABLE,
          status: FinancialEntryStatus.PAID,
          paidAt: { gte: new Date(hoje.getTime() - 90 * 86_400_000) },
        },
        _sum: { amount: true },
      }),
    ]);
    const aberto = Number(vencidoAberto._sum.amount ?? 0) - Number(vencidoAberto._sum.paidAmount ?? 0);
    const recebido = Number(recebidoRecente._sum.amount ?? 0);
    const baseDefaultRate = aberto + recebido > 0 ? aberto / (aberto + recebido) : 0;

    const scenarios = [
      { name: 'base', revenueMultiplier: 1.0, expenseMultiplier: 1.0, defaultRateMultiplier: 1.0, description: 'Projeção sem ajustes' },
      { name: 'otimista', revenueMultiplier: 1.15, expenseMultiplier: 0.95, defaultRateMultiplier: 0.7, description: '+15% receitas, −5% despesas, −30% inadimplência' },
      { name: 'estresse', revenueMultiplier: 0.8, expenseMultiplier: 1.1, defaultRateMultiplier: 1.5, description: '−20% receitas, +10% despesas, +50% inadimplência' },
    ];

    const results = scenarios.map((sc) => {
      const rate = Math.min(1, baseDefaultRate * sc.defaultRateMultiplier);
      let balance = daily.currentBalance;
      let firstAlertDate: string | null = null;
      const projection = daily.projection.map((d) => {
        const inflow = round2fin(d.receivable * sc.revenueMultiplier * (1 - rate));
        const outflow = round2fin(d.payable * sc.expenseMultiplier);
        balance = round2fin(balance + inflow - outflow);
        if (balance < 0 && !firstAlertDate) firstAlertDate = d.date;
        return { date: d.date, inflow, outflow, netFlow: round2fin(inflow - outflow), projectedBalance: balance, alert: balance < 0 };
      });
      return {
        ...sc,
        effectiveDefaultRate: round2fin(rate * 100), // %
        finalBalance: balance,
        firstAlertDate,
        projection,
      };
    });

    return {
      currentBalance: daily.currentBalance,
      days: daily.days,
      baseDefaultRate: round2fin(baseDefaultRate * 100),
      scenarios: results,
    };
  }

  // ─── Extrato bancário e saldo consolidado ─────────────────────────────────

  async getBankStatement(
    bankAccountId: string,
    companyId: string,
    filters: { from?: string; to?: string } = {},
  ) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
    });
    if (!account) throw new NotFoundException(`Conta bancária ${bankAccountId} não encontrada`);

    const where: any = { bankAccountId };
    if (filters.from || filters.to) {
      where.paidAt = {};
      if (filters.from) where.paidAt.gte = new Date(filters.from);
      if (filters.to) where.paidAt.lte = new Date(filters.to);
    }

    const payments = await this.prisma.payment.findMany({
      where,
      include: {
        financialEntry: {
          select: { id: true, type: true, description: true, amount: true },
        },
      },
      orderBy: { paidAt: 'asc' },
    });

    return {
      bankAccount: {
        id: account.id,
        name: account.name,
        bank: account.bank,
        currentBalance: Number(account.balance),
      },
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        method: p.method,
        reference: p.reference,
        type: p.financialEntry.type,
        direction: p.financialEntry.type === FinancialEntryType.RECEIVABLE ? 'IN' : 'OUT',
        entryDescription: p.financialEntry.description,
      })),
    };
  }

  async getConsolidatedBalance(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, bank: true, balance: true },
      orderBy: { name: 'asc' },
    });

    const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);

    return {
      totalBalance,
      accounts: accounts.map((a) => ({
        ...a,
        balance: Number(a.balance),
      })),
    };
  }

  // ─── Categorias gerenciais ─────────────────────────────────────────────────

  async createCategory(companyId: string, dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.financialCategory.findFirst({
        where: { id: dto.parentId, companyId },
      });
      if (!parent) throw new NotFoundException(`Categoria pai ${dto.parentId} não encontrada`);
    }

    return this.prisma.financialCategory.create({
      data: { companyId, ...dto },
    });
  }

  async findAllCategories(companyId: string) {
    const categories = await this.prisma.financialCategory.findMany({
      where: { companyId, isActive: true },
      include: { children: { where: { isActive: true } } },
      orderBy: { code: 'asc' },
    });

    // Return only root categories (parentId === null) with children nested
    return categories.filter((c) => !c.parentId);
  }

  async updateCategory(id: string, companyId: string, dto: Partial<CreateCategoryDto>) {
    const category = await this.prisma.financialCategory.findFirst({ where: { id, companyId } });
    if (!category) throw new NotFoundException(`Categoria ${id} não encontrada`);

    return this.prisma.financialCategory.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateCategory(id: string, companyId: string) {
    const category = await this.prisma.financialCategory.findFirst({ where: { id, companyId } });
    if (!category) throw new NotFoundException(`Categoria ${id} não encontrada`);

    return this.prisma.financialCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Centros de custo ─────────────────────────────────────────────────────

  async createCostCenter(companyId: string, dto: CreateCostCenterDto) {
    if (dto.parentId) {
      const parent = await this.prisma.costCenter.findFirst({
        where: { id: dto.parentId, companyId },
      });
      if (!parent) throw new NotFoundException(`Centro de custo pai ${dto.parentId} não encontrado`);
    }

    return this.prisma.costCenter.create({
      data: { companyId, ...dto },
    });
  }

  async findAllCostCenters(companyId: string) {
    const centers = await this.prisma.costCenter.findMany({
      where: { companyId, isActive: true },
      include: { children: { where: { isActive: true } } },
      orderBy: { code: 'asc' },
    });

    return centers.filter((c) => !c.parentId);
  }

  async updateCostCenter(id: string, companyId: string, dto: Partial<CreateCostCenterDto>) {
    const center = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!center) throw new NotFoundException(`Centro de custo ${id} não encontrado`);

    return this.prisma.costCenter.update({
      where: { id },
      data: dto,
    });
  }

  async deactivateCostCenter(id: string, companyId: string) {
    const center = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!center) throw new NotFoundException(`Centro de custo ${id} não encontrado`);

    return this.prisma.costCenter.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Banking: Account detail & config ──────────────────────────────────────

  async findOneBankAccount(companyId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, companyId },
    });
    if (!account) throw new NotFoundException(`Conta bancária ${id} não encontrada`);
    return account;
  }

  async getBankAccountBalance(companyId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, companyId },
    });
    if (!account) throw new NotFoundException(`Conta bancária ${id} não encontrada`);

    const balance = Number(account.balance);
    const minCashBalance = account.minCashBalance ? Number(account.minCashBalance) : null;
    const belowMinimum = minCashBalance !== null ? balance < minCashBalance : false;

    return { balance, minCashBalance, belowMinimum };
  }

  async configureBankAccount(companyId: string, id: string, dto: ConfigureBankAccountDto) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id, companyId },
    });
    if (!account) throw new NotFoundException(`Conta bancária ${id} não encontrada`);

    const updated = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...(dto.provider !== undefined ? { provider: dto.provider } : {}),
        ...(dto.pixKey !== undefined ? { pixKey: dto.pixKey } : {}),
        ...(dto.minCashBalance !== undefined ? { minCashBalance: dto.minCashBalance } : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'BankAccount',
        action: 'CONFIGURE',
        payload: JSON.stringify({ id, ...dto }),
      },
    });

    this.logger.log(`BankAccount ${id} configurado: provider=${dto.provider}, pixKey=${dto.pixKey}`);
    return updated;
  }

  async getBankingOverview(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, bank: true, balance: true, minCashBalance: true },
      orderBy: { name: 'asc' },
    });

    const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
    const accountsBelowMinimum = accounts.filter(
      (a) => a.minCashBalance !== null && Number(a.balance) < Number(a.minCashBalance),
    );

    return {
      totalBalance,
      accountCount: accounts.length,
      accountsBelowMinimum: accountsBelowMinimum.map((a) => ({
        id: a.id,
        name: a.name,
        balance: Number(a.balance),
        minCashBalance: Number(a.minCashBalance),
      })),
      accounts: accounts.map((a) => ({
        ...a,
        balance: Number(a.balance),
        minCashBalance: a.minCashBalance ? Number(a.minCashBalance) : null,
      })),
    };
  }

  // ─── Scheduled Payments ───────────────────────────────────────────────────

  async createScheduledPayment(companyId: string, dto: CreateScheduledPaymentDto) {
    // Validate financial entry exists, is PAYABLE, and status is OPEN or OVERDUE
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id: dto.financialEntryId, companyId },
    });
    if (!entry) throw new NotFoundException(`Lançamento financeiro ${dto.financialEntryId} não encontrado`);
    if (entry.type !== FinancialEntryType.PAYABLE) {
      throw new BadRequestException('Apenas lançamentos do tipo PAYABLE podem ser agendados');
    }
    if (entry.status !== FinancialEntryStatus.OPEN && entry.status !== FinancialEntryStatus.OVERDUE) {
      throw new BadRequestException(`Lançamento com status ${entry.status} não pode ser agendado. Apenas OPEN ou OVERDUE`);
    }

    // Validate bank account exists
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId },
    });
    if (!bankAccount) throw new NotFoundException(`Conta bancária ${dto.bankAccountId} não encontrada`);

    // Check projected balance: current balance minus pending scheduled amounts for same account
    const currentBalance = Number(bankAccount.balance);
    const pendingScheduled = await this.prisma.scheduledPayment.aggregate({
      where: {
        bankAccountId: dto.bankAccountId,
        status: ScheduledPaymentStatus.PENDING,
        companyId,
      },
      _sum: { amount: true },
    });
    const pendingTotal = Number(pendingScheduled._sum.amount ?? 0);
    const projectedBalance = currentBalance - pendingTotal - dto.amount;

    if (projectedBalance < 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Saldo projetado insuficiente para agendamento',
        currentBalance,
        projectedBalance,
        shortfall: Math.abs(projectedBalance),
      });
    }

    const scheduled = await this.prisma.scheduledPayment.create({
      data: {
        companyId,
        financialEntryId: dto.financialEntryId,
        bankAccountId: dto.bankAccountId,
        scheduledDate: new Date(dto.scheduledDate),
        amount: dto.amount,
        note: dto.note ?? null,
      },
      include: { financialEntry: true, bankAccount: true },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'ScheduledPayment',
        action: 'CREATE',
        payload: JSON.stringify({ id: scheduled.id, financialEntryId: dto.financialEntryId, amount: dto.amount }),
      },
    });

    this.logger.log(`ScheduledPayment criado: ${scheduled.id} — R$ ${dto.amount} em ${dto.scheduledDate}`);
    return scheduled;
  }

  async findAllScheduledPayments(companyId: string, status?: ScheduledPaymentStatus) {
    return this.prisma.scheduledPayment.findMany({
      where: {
        companyId,
        ...(status ? { status } : {}),
      },
      include: {
        financialEntry: { select: { id: true, description: true, amount: true, dueDate: true, type: true, status: true } },
        bankAccount: { select: { id: true, name: true, bank: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async cancelScheduledPayment(companyId: string, id: string) {
    const scheduled = await this.prisma.scheduledPayment.findFirst({
      where: { id, companyId },
    });
    if (!scheduled) throw new NotFoundException(`Agendamento ${id} não encontrado`);
    if (scheduled.status !== ScheduledPaymentStatus.PENDING) {
      throw new BadRequestException(`Agendamento com status ${scheduled.status} não pode ser cancelado. Apenas PENDING`);
    }

    const updated = await this.prisma.scheduledPayment.update({
      where: { id },
      data: { status: ScheduledPaymentStatus.CANCELLED },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'ScheduledPayment',
        action: 'CANCEL',
        payload: JSON.stringify({ id }),
      },
    });

    this.logger.log(`ScheduledPayment ${id} → CANCELLED`);
    return updated;
  }

  // ─── Collection Monitor ───────────────────────────────────────────────────

  async getCollectionStatus(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Overdue FinancialEntry of type RECEIVABLE
    const overdueEntries = await this.prisma.financialEntry.findMany({
      where: {
        companyId,
        type: FinancialEntryType.RECEIVABLE,
        status: FinancialEntryStatus.OVERDUE,
      },
      include: {
        salesOrder: { include: { customer: true } },
        collectionAttempts: { orderBy: { sentAt: 'desc' } },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Overdue Receivables (legacy)
    const overdueReceivables = await this.prisma.receivable.findMany({
      where: {
        companyId,
        status: 'OVERDUE',
      },
      include: {
        customer: true,
        collectionAttempts: { orderBy: { sentAt: 'desc' } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const entriesResult = overdueEntries.map((e) => {
      const daysOverdue = Math.floor((today.getTime() - new Date(e.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: e.id,
        source: 'FINANCIAL_ENTRY' as const,
        customerName: e.salesOrder?.customer?.name ?? null,
        customerId: e.salesOrder?.customer?.id ?? null,
        amount: Number(e.amount),
        dueDate: e.dueDate,
        daysOverdue,
        description: e.description,
        attemptCount: e.collectionAttempts.length,
        lastAttemptDate: e.collectionAttempts[0]?.sentAt ?? null,
        lastAttemptChannel: e.collectionAttempts[0]?.channel ?? null,
      };
    });

    const receivablesResult = overdueReceivables.map((r) => {
      const daysOverdue = Math.floor((today.getTime() - new Date(r.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: r.id,
        source: 'RECEIVABLE' as const,
        customerName: r.customer?.name ?? null,
        customerId: r.customer?.id ?? null,
        amount: Number(r.amount),
        dueDate: r.dueDate,
        daysOverdue,
        description: r.description,
        attemptCount: r.collectionAttempts.length,
        lastAttemptDate: r.collectionAttempts[0]?.sentAt ?? null,
        lastAttemptChannel: r.collectionAttempts[0]?.channel ?? null,
      };
    });

    return [...entriesResult, ...receivablesResult].sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  async getDailyCollectionReport(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = this.addDays(today, 1);

    // Total overdue (FinancialEntry RECEIVABLE + Receivable)
    const overdueEntries = await this.prisma.financialEntry.aggregate({
      where: { companyId, type: FinancialEntryType.RECEIVABLE, status: FinancialEntryStatus.OVERDUE },
      _sum: { amount: true },
      _count: true,
    });
    const overdueReceivables = await this.prisma.receivable.aggregate({
      where: { companyId, status: 'OVERDUE' },
      _sum: { amount: true },
      _count: true,
    });
    const totalOverdue = Number(overdueEntries._sum.amount ?? 0) + Number(overdueReceivables._sum.amount ?? 0);

    // Total collected today (paid today)
    const collectedToday = await this.prisma.financialEntry.aggregate({
      where: {
        companyId,
        type: FinancialEntryType.RECEIVABLE,
        status: FinancialEntryStatus.PAID,
        paidAt: { gte: today, lt: tomorrow },
      },
      _sum: { paidAmount: true },
      _count: true,
    });
    const totalCollected = Number(collectedToday._sum.paidAmount ?? 0);

    // Total pending (OPEN receivables)
    const pendingEntries = await this.prisma.financialEntry.aggregate({
      where: { companyId, type: FinancialEntryType.RECEIVABLE, status: FinancialEntryStatus.OPEN },
      _sum: { amount: true },
    });
    const pendingReceivables = await this.prisma.receivable.aggregate({
      where: { companyId, status: 'OPEN' },
      _sum: { amount: true },
    });
    const totalPending = Number(pendingEntries._sum.amount ?? 0) + Number(pendingReceivables._sum.amount ?? 0);

    const totalDue = totalOverdue + totalCollected;
    const conversionRate = totalDue > 0 ? +((totalCollected / totalDue) * 100).toFixed(2) : 0;

    return {
      totalOverdue,
      totalCollected,
      totalPending,
      conversionRate,
      overdueCount: (overdueEntries._count ?? 0) + (overdueReceivables._count ?? 0),
      collectedCount: collectedToday._count ?? 0,
    };
  }

  async triggerCollection(companyId: string, dto: TriggerCollectionDto) {
    const attempts = dto.ids.map((id) => ({
      companyId,
      // Try to link to either financialEntry or receivable — we'll determine below
      financialEntryId: null as string | null,
      receivableId: null as string | null,
      channel: dto.channel,
      note: dto.note ?? null,
    }));

    // Check which ids are FinancialEntry and which are Receivable
    const financialEntries = await this.prisma.financialEntry.findMany({
      where: { id: { in: dto.ids }, companyId },
      select: { id: true },
    });
    const feIds = new Set(financialEntries.map((e) => e.id));

    const receivables = await this.prisma.receivable.findMany({
      where: { id: { in: dto.ids.filter((id) => !feIds.has(id)) }, companyId },
      select: { id: true },
    });
    const recIds = new Set(receivables.map((r) => r.id));

    const validAttempts = dto.ids
      .filter((id) => feIds.has(id) || recIds.has(id))
      .map((id) => ({
        companyId,
        financialEntryId: feIds.has(id) ? id : null,
        receivableId: recIds.has(id) ? id : null,
        channel: dto.channel,
        note: dto.note ?? null,
      }));

    if (validAttempts.length === 0) {
      throw new BadRequestException('Nenhum ID válido encontrado para cobrança');
    }

    await this.prisma.collectionAttempt.createMany({
      data: validAttempts,
    });

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'CollectionAttempt',
        action: 'TRIGGER',
        payload: JSON.stringify({ ids: dto.ids, channel: dto.channel, triggered: validAttempts.length }),
      },
    });

    this.logger.log(`Collection triggered: ${validAttempts.length} tentativas via ${dto.channel}`);
    return { triggered: validAttempts.length };
  }

  // ─── Util ─────────────────────────────────────────────────────────────────

  /**
   * Vencimento como DATA DE NEGÓCIO (#901): parte do dia operacional em São
   * Paulo, soma o prazo em dias de calendário e devolve a representação
   * canônica de data pura (`YYYY-MM-DDT00:00:00.000Z`) — a mesma forma dos
   * 3.687 títulos já em produção (migração do Omie e lançamento manual).
   */
  private vencimentoEmDias(dias: number, base = dataOperacionalHoje()): Date {
    return limiteDeDataPura(somarDias(base, dias));
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}

function round2fin(v: number): number {
  return Math.round(v * 100) / 100;
}
