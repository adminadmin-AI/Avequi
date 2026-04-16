import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWarehouseDto, user?: any) {
    const existing = await this.prisma.warehouse.findUnique({
      where: { companyId_code: { companyId: dto.companyId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`Código de depósito '${dto.code}' já existe para esta empresa`);
    }

    const warehouse = await this.prisma.warehouse.create({ data: dto });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: dto.companyId,
        entity: 'Warehouse',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return warehouse;
  }

  async findAll(companyId: string) {
    return this.prisma.warehouse.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, companyId },
    });
    if (!warehouse) throw new NotFoundException(`Depósito ${id} não encontrado`);
    return warehouse;
  }

  async update(id: string, dto: UpdateWarehouseDto, user?: any) {
    const existing = await this.prisma.warehouse.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Depósito ${id} não encontrado`);

    const warehouse = await this.prisma.warehouse.update({
      where: { id },
      data: dto,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: existing.companyId,
        entity: 'Warehouse',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return warehouse;
  }
}
