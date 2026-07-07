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

  async create(dto: CreateWarehouseDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    const existing = await this.prisma.warehouse.findUnique({
      where: { companyId_code: { companyId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`Código de depósito '${dto.code}' já existe para esta empresa`);
    }

    const warehouse = await this.prisma.warehouse.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
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

  async update(id: string, dto: UpdateWarehouseDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar depósito de outro tenant
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Depósito ${id} não encontrado`);

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    const warehouse = await this.prisma.warehouse.update({
      where: { id },
      data,
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
