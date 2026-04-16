import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SupplierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSupplierDto, user?: any) {
    // Check CNPJ uniqueness per company
    if (dto.cnpj) {
      const existing = await this.prisma.supplier.findUnique({
        where: { companyId_cnpj: { companyId: dto.companyId, cnpj: dto.cnpj } },
      });
      if (existing) {
        throw new ConflictException(`CNPJ '${dto.cnpj}' já cadastrado para esta empresa`);
      }
    }

    const supplier = await this.prisma.supplier.create({ data: dto });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: dto.companyId,
        entity: 'Supplier',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return supplier;
  }

  async findAll(
    companyId: string,
    query: { search?: string; isActive?: string },
  ) {
    const where: any = { companyId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { cnpj: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, companyId },
    });
    if (!supplier) throw new NotFoundException(`Fornecedor ${id} não encontrado`);
    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, user?: any) {
    const existing = await this.prisma.supplier.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Fornecedor ${id} não encontrado`);

    const companyId = dto.companyId || existing.companyId;

    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: dto,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Supplier',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return supplier;
  }
}
