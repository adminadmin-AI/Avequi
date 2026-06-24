import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto, user?: any) {
    // Check document uniqueness per company
    if (dto.document) {
      const existing = await this.prisma.customer.findUnique({
        where: {
          companyId_document: { companyId: dto.companyId, document: dto.document },
        },
      });
      if (existing) {
        throw new ConflictException(`Documento '${dto.document}' já cadastrado para esta empresa`);
      }
    }

    const customer = await this.prisma.customer.create({ data: dto });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: dto.companyId,
        entity: 'Customer',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return customer;
  }

  async findAll(
    companyId: string,
    query: { search?: string; type?: string; isActive?: string },
  ) {
    const where: any = { companyId };

    if (query.type) {
      where.type = query.type;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { document: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
    });
    if (!customer) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto, user?: any) {
    const existing = await this.prisma.customer.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Cliente ${id} não encontrado`);

    const companyId = dto.companyId || existing.companyId;

    const customer = await this.prisma.customer.update({
      where: { id },
      data: dto,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Customer',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return customer;
  }

  // ─── #187: Credit Summary ───────────────────────────────────────────────

  async getCreditSummary(customerId: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId },
      include: {
        creditLimits: { where: { status: 'ACTIVE' } },
      },
    });
    if (!customer) throw new NotFoundException(`Cliente ${customerId} não encontrado`);

    const creditLimit = customer.creditLimits[0];
    const maxAmount = creditLimit ? Number(creditLimit.maxAmount) : 0;

    // creditUsed = soma de receivables OPEN + OVERDUE do cliente
    const { _sum } = await this.prisma.receivable.aggregate({
      where: {
        customerId,
        companyId,
        status: { in: ['OPEN', 'OVERDUE'] },
      },
      _sum: { amount: true },
    });
    const creditUsed = Number(_sum.amount ?? 0);
    const creditAvailable = Math.max(0, maxAmount - creditUsed);

    // Contar parcelas vencidas (OVERDUE)
    const overdueCount = await this.prisma.receivable.count({
      where: {
        customerId,
        companyId,
        status: 'OVERDUE',
      },
    });

    return {
      customerId,
      customerName: customer.name,
      creditLimit: maxAmount,
      creditUsed,
      creditAvailable,
      creditLimitStatus: creditLimit?.status ?? 'NO_LIMIT',
      overdueCount,
      hasCredit: creditLimit != null,
      blocked: creditLimit?.status === 'SUSPENDED',
    };
  }

  // ─── #187: Auto-block overdue customers ──────────────────────────────────

  async autoBlockOverdue(companyId: string, overdueDays: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - overdueDays);

    // Find customers with receivables overdue for more than N days
    const overdueCustomers = await this.prisma.receivable.findMany({
      where: {
        companyId,
        status: 'OVERDUE',
        dueDate: { lt: cutoffDate },
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });

    const customerIds = overdueCustomers
      .map((r) => r.customerId)
      .filter((id): id is string => id != null);

    if (customerIds.length === 0) return { blocked: 0 };

    // Suspend active credit limits
    const result = await this.prisma.creditLimit.updateMany({
      where: {
        companyId,
        customerId: { in: customerIds },
        status: 'ACTIVE',
      },
      data: { status: 'SUSPENDED' },
    });

    this.logger.log(
      `Auto-block: ${result.count} limites de crédito suspensos (inadimplência > ${overdueDays} dias)`,
    );

    return { blocked: result.count, customerIds };
  }
}
