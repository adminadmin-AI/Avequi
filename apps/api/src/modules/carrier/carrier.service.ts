import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';

/** Transportadoras — grupo transp da NF-e (#481) */
@Injectable()
export class CarrierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCarrierDto, user: { id?: string; companyId: string }) {
    // companyId SEMPRE vem do JWT do usuário autenticado (nunca do body)
    const companyId = user.companyId;

    if (dto.document) {
      const existing = await this.prisma.carrier.findUnique({
        where: { companyId_document: { companyId, document: dto.document } },
      });
      if (existing) {
        throw new ConflictException(`Documento '${dto.document}' já cadastrado para esta empresa`);
      }
    }

    const carrier = await this.prisma.carrier.create({
      data: { ...dto, companyId },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Carrier',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return carrier;
  }

  async findAll(companyId: string, query: { search?: string; isActive?: string }) {
    const where: any = { companyId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { razaoSocial: { contains: query.search, mode: 'insensitive' } },
        { document: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.carrier.findMany({ where, orderBy: { name: 'asc' } });
  }

  async findOne(id: string, companyId: string) {
    const carrier = await this.prisma.carrier.findFirst({ where: { id, companyId } });
    if (!carrier) throw new NotFoundException(`Transportadora ${id} não encontrada`);
    return carrier;
  }

  async update(id: string, dto: UpdateCarrierDto, user: { id?: string; companyId: string }) {
    // Busca escopada pela empresa do usuário — impede editar registro de outro tenant
    const existing = await this.prisma.carrier.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!existing) throw new NotFoundException(`Transportadora ${id} não encontrada`);

    // Defesa em profundidade: descarta qualquer companyId injetado no payload
    const { companyId: _ignored, ...data } = dto as any;

    const carrier = await this.prisma.carrier.update({ where: { id }, data });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: existing.companyId,
        entity: 'Carrier',
        action: 'UPDATE',
        payload: { carrierId: id, ...data },
      },
    });

    return carrier;
  }
}
