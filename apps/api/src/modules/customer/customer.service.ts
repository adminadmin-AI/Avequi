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

}
