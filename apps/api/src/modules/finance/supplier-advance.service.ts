import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FinancialEntryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Adiantamentos a fornecedor (#393, Wellington 5.1).
 *
 * Fluxo: cria adiantamento (dinheiro que já saiu) → quando a NF do fornecedor
 * gera o payable (createPayableForReceipt), o saldo aberto de adiantamentos do
 * fornecedor é abatido automaticamente como baixa parcial/total do payable.
 * Saldo por fornecedor = Σ(amount − appliedAmount) dos OPEN/PARTIALLY_APPLIED.
 */

const APPLICABLE = ['OPEN', 'PARTIALLY_APPLIED'];

@Injectable()
export class SupplierAdvanceService {
  private readonly logger = new Logger(SupplierAdvanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    dto: { supplierId: string; amount: number; purchaseOrderId?: string; note?: string; paidAt?: string },
    userId?: string,
  ) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, companyId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException(`Fornecedor ${dto.supplierId} não encontrado`);
    if (dto.amount <= 0) throw new BadRequestException('Valor do adiantamento deve ser positivo.');

    const advance = await this.prisma.supplierAdvance.create({
      data: {
        companyId,
        supplierId: dto.supplierId,
        amount: dto.amount,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        note: dto.note ?? null,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: 'SupplierAdvance',
        action: 'CREATE',
        payload: { advanceId: advance.id, supplierId: dto.supplierId, amount: dto.amount },
      },
    });
    return advance;
  }

  async cancel(id: string, companyId: string, userId?: string) {
    const advance = await this.prisma.supplierAdvance.findFirst({ where: { id, companyId } });
    if (!advance) throw new NotFoundException(`Adiantamento ${id} não encontrado`);
    if (Number(advance.appliedAmount) > 0) {
      throw new BadRequestException('Adiantamento já aplicado (parcial ou total) não pode ser cancelado.');
    }
    return this.prisma.supplierAdvance.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  /** Lista adiantamentos; com saldo aberto agrupado por fornecedor */
  async report(companyId: string) {
    const advances = await this.prisma.supplierAdvance.findMany({
      where: { companyId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const porFornecedor = new Map<string, { supplierId: string; supplier: string; saldoAberto: number; adiantamentos: number }>();
    for (const a of advances) {
      if (!APPLICABLE.includes(a.status)) continue;
      const saldo = Number(a.amount) - Number(a.appliedAmount);
      if (saldo <= 0) continue;
      const b = porFornecedor.get(a.supplierId) ?? {
        supplierId: a.supplierId,
        supplier: a.supplier?.name ?? '',
        saldoAberto: 0,
        adiantamentos: 0,
      };
      b.saldoAberto = round2(b.saldoAberto + saldo);
      b.adiantamentos++;
      porFornecedor.set(a.supplierId, b);
    }
    return {
      totalAberto: round2([...porFornecedor.values()].reduce((s, f) => s + f.saldoAberto, 0)),
      porFornecedor: [...porFornecedor.values()].sort((a, b) => b.saldoAberto - a.saldoAberto),
      adiantamentos: advances,
    };
  }

  /**
   * Abate adiantamentos abertos do fornecedor contra um payable recém-criado.
   * Chamado pelo createPayableForReceipt — baixa parcial/total com trilha.
   * Retorna o total aplicado.
   */
  async applyToPayable(companyId: string, supplierId: string, financialEntryId: string): Promise<number> {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id: financialEntryId, companyId },
    });
    if (!entry) return 0;

    const advances = await this.prisma.supplierAdvance.findMany({
      where: { companyId, supplierId, status: { in: APPLICABLE } },
      orderBy: { paidAt: 'asc' }, // FIFO: adiantamento mais antigo primeiro
    });
    if (advances.length === 0) return 0;

    const devido = Number(entry.amount) - Number(entry.paidAmount ?? 0);
    let restante = devido;
    let aplicadoTotal = 0;

    for (const adv of advances) {
      if (restante <= 0) break;
      const saldoAdv = Number(adv.amount) - Number(adv.appliedAmount);
      if (saldoAdv <= 0) continue;
      const aplicar = round2(Math.min(saldoAdv, restante));
      const novoAplicado = round2(Number(adv.appliedAmount) + aplicar);
      await this.prisma.supplierAdvance.update({
        where: { id: adv.id },
        data: {
          appliedAmount: novoAplicado,
          status: novoAplicado >= Number(adv.amount) ? 'APPLIED' : 'PARTIALLY_APPLIED',
        },
      });
      restante = round2(restante - aplicar);
      aplicadoTotal = round2(aplicadoTotal + aplicar);
    }

    if (aplicadoTotal > 0) {
      const novoPago = round2(Number(entry.paidAmount ?? 0) + aplicadoTotal);
      await this.prisma.financialEntry.update({
        where: { id: entry.id },
        data: {
          paidAmount: novoPago,
          status:
            novoPago >= Number(entry.amount)
              ? FinancialEntryStatus.PAID
              : FinancialEntryStatus.PARTIALLY_PAID,
          ...(novoPago >= Number(entry.amount) && { paidAt: new Date() }),
          paymentNote: `Adiantamento a fornecedor abatido: R$ ${aplicadoTotal.toFixed(2)} (#393)`,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          companyId,
          entity: 'FinancialEntry',
          action: 'ADVANCE_APPLIED',
          payload: { financialEntryId, supplierId, applied: aplicadoTotal },
        },
      });
      this.logger.log(
        `Adiantamento aplicado: R$ ${aplicadoTotal.toFixed(2)} no payable ${financialEntryId} (fornecedor ${supplierId})`,
      );
    }
    return aplicadoTotal;
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
