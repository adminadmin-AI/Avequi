import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateDdaMandateDto } from './dto/create-dda-mandate.dto';

export interface DdaMandateFilters {
  status?: string;
  customerId?: string;
  bankAccountId?: string;
}

@Injectable()
export class DdaService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Create mandate ───────────────────────────────────────────────────────

  async createMandate(companyId: string, dto: CreateDdaMandateDto) {
    // Verify customer belongs to company
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId },
    });
    if (!customer) {
      throw new BusinessException('Cliente não encontrado', HttpStatus.NOT_FOUND);
    }

    // Verify bank account belongs to company
    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId },
    });
    if (!bankAccount) {
      throw new BusinessException('Conta bancária não encontrada', HttpStatus.NOT_FOUND);
    }

    return this.prisma.ddaMandate.create({
      data: {
        companyId,
        customerId: dto.customerId,
        bankAccountId: dto.bankAccountId,
        maxAmount: dto.maxAmount ?? null,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        reference: dto.reference ?? null,
        consentStatus: 'PENDING',
      },
      include: {
        customer: { select: { id: true, name: true, document: true } },
        bankAccount: { select: { id: true, name: true, bankCode: true } },
      },
    });
  }

  // ─── Cancel mandate ───────────────────────────────────────────────────────

  async cancelMandate(companyId: string, mandateId: string) {
    const mandate = await this.prisma.ddaMandate.findFirst({
      where: { id: mandateId, companyId },
    });

    if (!mandate) {
      throw new BusinessException('Mandato DDA não encontrado', HttpStatus.NOT_FOUND);
    }

    if (mandate.consentStatus === 'CANCELLED') {
      throw new BusinessException('Mandato já está cancelado', HttpStatus.CONFLICT);
    }

    return this.prisma.ddaMandate.update({
      where: { id: mandateId },
      data: {
        consentStatus: 'CANCELLED',
        cancelledAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true } },
        bankAccount: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Find mandates ────────────────────────────────────────────────────────

  async findMandates(companyId: string, filters: DdaMandateFilters = {}) {
    const where: Record<string, unknown> = { companyId };

    if (filters.status) {
      where['consentStatus'] = filters.status;
    }
    if (filters.customerId) {
      where['customerId'] = filters.customerId;
    }
    if (filters.bankAccountId) {
      where['bankAccountId'] = filters.bankAccountId;
    }

    return this.prisma.ddaMandate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, document: true } },
        bankAccount: { select: { id: true, name: true, bankCode: true } },
        debits: {
          orderBy: { debitDate: 'desc' },
          take: 5,
        },
      },
    });
  }

  // ─── Process authorized debits ────────────────────────────────────────────

  /**
   * Job that finds ACTIVE mandates with pending debits and processes them.
   * Intended to be called by a scheduler (e.g. Bull queue or cron).
   */
  async processAuthorizedDebits(): Promise<{ processed: number; failed: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find all pending debits for ACTIVE mandates due today or before
    const pendingDebits = await this.prisma.ddaDebit.findMany({
      where: {
        status: 'PENDING',
        debitDate: { lte: today },
        mandate: { consentStatus: 'ACTIVE' },
      },
      include: {
        mandate: {
          include: {
            bankAccount: true,
          },
        },
      },
    });

    let processed = 0;
    let failed = 0;

    for (const debit of pendingDebits) {
      try {
        // Check mandate is still valid
        const mandate = debit.mandate;
        if (mandate.endDate && mandate.endDate < today) {
          // Mandate expired — mark as failed
          await this.prisma.ddaDebit.update({
            where: { id: debit.id },
            data: {
              status: 'FAILED',
              failReason: 'Mandato expirado',
            },
          });

          // Expire the mandate
          await this.prisma.ddaMandate.update({
            where: { id: mandate.id },
            data: { consentStatus: 'EXPIRED' },
          });

          failed++;
          continue;
        }

        // Check max amount constraint
        if (mandate.maxAmount && Number(debit.amount) > Number(mandate.maxAmount)) {
          await this.prisma.ddaDebit.update({
            where: { id: debit.id },
            data: {
              status: 'FAILED',
              failReason: `Valor R$${Number(debit.amount).toFixed(2)} excede limite do mandato R$${Number(mandate.maxAmount).toFixed(2)}`,
            },
          });
          failed++;
          continue;
        }

        // Mark as processed
        await this.prisma.ddaDebit.update({
          where: { id: debit.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        });

        processed++;
      } catch {
        // Mark individual debit as failed without aborting the whole batch
        await this.prisma.ddaDebit.update({
          where: { id: debit.id },
          data: {
            status: 'FAILED',
            failReason: 'Erro interno durante processamento',
          },
        }).catch(() => { /* ignore update errors */ });

        failed++;
      }
    }

    return { processed, failed };
  }
}
