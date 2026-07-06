import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, CustomerAddressDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/** Produtor rural e contribuinte exigem IE numérica (#474) — evita rejeição SEFAZ 728/234 */
function validateFiscalConsistency(dto: { indIeDest?: string | null; isRuralProducer?: boolean; ie?: string | null }) {
  const ieNumerica = dto.ie && /^\d+$/.test(dto.ie.replace(/[.\-\/ ]/g, ''));
  if (dto.isRuralProducer && !ieNumerica) {
    throw new BadRequestException('Produtor rural exige IE de produtor preenchida (numérica)');
  }
  if (dto.indIeDest === 'CONTRIBUINTE' && !ieNumerica) {
    throw new BadRequestException('Cliente contribuinte de ICMS exige IE válida (numérica)');
  }
}

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    // Check document uniqueness per company
    if (dto.document) {
      const existing = await this.prisma.customer.findUnique({
        where: {
          companyId_document: { companyId, document: dto.document },
        },
      });
      if (existing) {
        throw new ConflictException(`Documento '${dto.document}' já cadastrado para esta empresa`);
      }
    }

    validateFiscalConsistency(dto);

    const customer = await this.prisma.customer.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
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
      include: { addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] } },
    });
    if (!customer) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return customer;
  }

  // ─── Endereços de entrega 1:N (#474) ────────────────────────────────────────

  async addAddress(customerId: string, dto: CustomerAddressDto, companyId: string) {
    await this.findOne(customerId, companyId); // valida tenant
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.customerAddress.create({ data: { ...dto, customerId } });
  }

  async updateAddress(customerId: string, addressId: string, dto: Partial<CustomerAddressDto>, companyId: string) {
    await this.findOne(customerId, companyId);
    const addr = await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!addr) throw new NotFoundException(`Endereço ${addressId} não encontrado`);
    if (dto.isDefault) {
      await this.prisma.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return this.prisma.customerAddress.update({ where: { id: addressId }, data: dto });
  }

  async removeAddress(customerId: string, addressId: string, companyId: string) {
    await this.findOne(customerId, companyId);
    const addr = await this.prisma.customerAddress.findFirst({ where: { id: addressId, customerId } });
    if (!addr) throw new NotFoundException(`Endereço ${addressId} não encontrado`);
    const inUse = await this.prisma.salesOrder.count({ where: { deliveryAddressId: addressId } });
    if (inUse > 0) {
      throw new ConflictException('Endereço usado em vendas — não pode ser excluído');
    }
    return this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  async update(id: string, dto: UpdateCustomerDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar cliente de outro tenant
    const existing = await this.prisma.customer.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Cliente ${id} não encontrado`);

    // companyId é imutável: registro nunca muda de empresa via update
    const companyId = existing.companyId;

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    validateFiscalConsistency({
      indIeDest: data.indIeDest ?? existing.indIeDest,
      isRuralProducer: data.isRuralProducer ?? existing.isRuralProducer,
      ie: data.ie !== undefined ? data.ie : existing.ie,
    });

    const customer = await this.prisma.customer.update({
      where: { id },
      data,
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

  /** #475 — situação de crédito: limite, em aberto (Receivable OPEN/OVERDUE) e disponível */
  async creditStatus(id: string, companyId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        creditLimit: true,
        billingBlocked: true,
        billingBlockReason: true,
      },
    });
    if (!customer) throw new NotFoundException(`Cliente ${id} não encontrado`);
    const open = await this.prisma.receivable.aggregate({
      where: { companyId, customerId: id, status: { in: ['OPEN', 'OVERDUE'] as any } },
      _sum: { amount: true },
    });
    const openReceivables = Number(open._sum.amount ?? 0);
    const creditLimit = customer.creditLimit ? Number(customer.creditLimit) : null;
    return {
      customerId: customer.id,
      name: customer.name,
      creditLimit,
      openReceivables,
      available: creditLimit != null ? Math.max(0, creditLimit - openReceivables) : null,
      overLimit: creditLimit != null && openReceivables > creditLimit,
      billingBlocked: (customer as any).billingBlocked,
      billingBlockReason: (customer as any).billingBlockReason,
    };
  }

}
