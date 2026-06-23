import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateCreditLimitDto } from './dto/create-credit-limit.dto';

@Injectable()
export class CreditLimitService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Create or Update ──────────────────────────────────────────────────────

  async create(companyId: string, dto: CreateCreditLimitDto) {
    // Verify customer belongs to company
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, companyId },
    });
    if (!customer) {
      throw new BusinessException('Cliente não encontrado', HttpStatus.NOT_FOUND);
    }

    // Upsert — one limit per (company, customer)
    return this.prisma.creditLimit.upsert({
      where: {
        companyId_customerId: { companyId, customerId: dto.customerId },
      },
      update: {
        maxAmount: dto.maxAmount,
        notes: dto.notes ?? null,
        status: 'ACTIVE',
      },
      create: {
        companyId,
        customerId: dto.customerId,
        maxAmount: dto.maxAmount,
        notes: dto.notes ?? null,
      },
    });
  }

  // ─── Find by customer ──────────────────────────────────────────────────────

  async findByCustomer(companyId: string, customerId: string) {
    const limit = await this.prisma.creditLimit.findUnique({
      where: {
        companyId_customerId: { companyId, customerId },
      },
      include: { customer: { select: { id: true, name: true, document: true } } },
    });
    if (!limit) {
      throw new BusinessException(
        'Limite de crédito não encontrado para este cliente',
        HttpStatus.NOT_FOUND,
      );
    }
    return limit;
  }

  // ─── Check availability ────────────────────────────────────────────────────

  async checkAvailability(companyId: string, customerId: string, amount: number) {
    let limit: Awaited<ReturnType<typeof this.prisma.creditLimit.findUnique>>;
    try {
      limit = await this.prisma.creditLimit.findUnique({
        where: { companyId_customerId: { companyId, customerId } },
      });
    } catch {
      limit = null;
    }

    if (!limit || limit.status !== 'ACTIVE') {
      return {
        available: false,
        maxAmount: 0,
        usedAmount: 0,
        remainingAmount: 0,
        reason: limit ? `Limite ${limit.status}` : 'Limite não cadastrado',
      };
    }

    const maxAmount = Number(limit.maxAmount);
    const usedAmount = Number(limit.usedAmount);
    const remainingAmount = maxAmount - usedAmount;
    const available = amount <= remainingAmount;

    return { available, maxAmount, usedAmount, remainingAmount };
  }

  // ─── Consume (increment used) ──────────────────────────────────────────────

  async consume(companyId: string, customerId: string, amount: number) {
    const limit = await this.prisma.creditLimit.findUnique({
      where: { companyId_customerId: { companyId, customerId } },
    });
    if (!limit) {
      throw new BusinessException(
        'Limite de crédito não cadastrado',
        HttpStatus.NOT_FOUND,
      );
    }
    if (limit.status !== 'ACTIVE') {
      throw new BusinessException(
        `Limite de crédito está ${limit.status}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const newUsed = Number(limit.usedAmount) + amount;
    if (newUsed > Number(limit.maxAmount)) {
      throw new BusinessException(
        `Limite de crédito insuficiente. Disponível: R$ ${(Number(limit.maxAmount) - Number(limit.usedAmount)).toFixed(2)}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.prisma.creditLimit.update({
      where: { id: limit.id },
      data: { usedAmount: newUsed },
    });
  }

  // ─── Release (decrement used) ──────────────────────────────────────────────

  async release(companyId: string, customerId: string, amount: number) {
    const limit = await this.prisma.creditLimit.findUnique({
      where: { companyId_customerId: { companyId, customerId } },
    });
    if (!limit) {
      throw new BusinessException(
        'Limite de crédito não cadastrado',
        HttpStatus.NOT_FOUND,
      );
    }

    const newUsed = Math.max(0, Number(limit.usedAmount) - amount);
    return this.prisma.creditLimit.update({
      where: { id: limit.id },
      data: { usedAmount: newUsed },
    });
  }

  // ─── Suspend ───────────────────────────────────────────────────────────────

  async suspend(companyId: string, customerId: string) {
    const limit = await this.prisma.creditLimit.findUnique({
      where: { companyId_customerId: { companyId, customerId } },
    });
    if (!limit) {
      throw new BusinessException(
        'Limite de crédito não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.prisma.creditLimit.update({
      where: { id: limit.id },
      data: { status: 'SUSPENDED' },
    });
  }

  // ─── Activate ──────────────────────────────────────────────────────────────

  async activate(companyId: string, customerId: string) {
    const limit = await this.prisma.creditLimit.findUnique({
      where: { companyId_customerId: { companyId, customerId } },
    });
    if (!limit) {
      throw new BusinessException(
        'Limite de crédito não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.prisma.creditLimit.update({
      where: { id: limit.id },
      data: { status: 'ACTIVE' },
    });
  }
}
