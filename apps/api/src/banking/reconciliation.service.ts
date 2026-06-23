import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async importFromRetorno(companyId: string, retornoId: string) {
    const retorno = await this.prisma.cnabRetorno.findFirst({
      where: { id: retornoId, companyId },
      include: { items: { where: { matched: true } } },
    });
    if (!retorno) {
      throw new BusinessException('Retorno CNAB não encontrado', HttpStatus.NOT_FOUND);
    }

    const paidItems = retorno.items.filter(
      item => ['06', '07', '17'].includes(item.occurrence) && item.paidAmount,
    );

    const reconciliationData = paidItems.map(item => ({
      companyId,
      bankAccountId: retorno.bankAccountId,
      date: item.paidAt ?? new Date(),
      description: `Boleto liquidado — Nosso Número: ${item.nossoNumero} (${item.occurrenceDesc ?? item.occurrence})`,
      amount: Number(item.paidAmount ?? 0),
      type: 'CREDIT',
      matched: !!item.boletoId,
      matchedToId: item.boletoId ?? undefined,
      matchedToType: item.boletoId ? 'BOLETO' : undefined,
      importSource: 'CNAB_RETORNO',
    }));

    if (reconciliationData.length === 0) {
      return { created: 0 };
    }

    const result = await this.prisma.reconciliationItem.createMany({
      data: reconciliationData,
      skipDuplicates: true,
    });

    return { created: result.count };
  }

  async findUnmatched(companyId: string, bankAccountId: string) {
    const where: Record<string, unknown> = {
      companyId,
      matched: false,
    };
    if (bankAccountId) where.bankAccountId = bankAccountId;

    return this.prisma.reconciliationItem.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        bankAccount: { select: { id: true, name: true } },
      },
    });
  }

  async matchItem(
    companyId: string,
    id: string,
    matchedToId: string,
    matchedToType: 'PAYABLE' | 'RECEIVABLE' | 'BOLETO',
  ) {
    const item = await this.prisma.reconciliationItem.findFirst({
      where: { id, companyId },
    });
    if (!item) {
      throw new BusinessException('Item de conciliação não encontrado', HttpStatus.NOT_FOUND);
    }
    if (item.matched) {
      throw new BusinessException('Item já foi conciliado');
    }

    return this.prisma.reconciliationItem.update({
      where: { id },
      data: { matched: true, matchedToId, matchedToType },
    });
  }
}
