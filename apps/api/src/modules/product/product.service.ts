import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto, user?: any) {
    // Validate NCM rule
    if (dto.type === 'FINISHED_GOOD' && !dto.ncm) {
      throw new BadRequestException('Produto acabado exige NCM');
    }

    // Check SKU uniqueness per company
    const existing = await this.prisma.product.findUnique({
      where: { companyId_sku: { companyId: dto.companyId, sku: dto.sku } },
    });
    if (existing) {
      throw new ConflictException(`SKU '${dto.sku}' já existe para esta empresa`);
    }

    const product = await this.prisma.product.create({ data: dto });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId: dto.companyId,
        entity: 'Product',
        action: 'CREATE',
        payload: { ...dto },
      },
    });

    return product;
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
        { sku: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, companyId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
    });
    if (!product) throw new NotFoundException(`Produto ${id} não encontrado`);
    return product;
  }

  async update(id: string, dto: UpdateProductDto, user?: any) {
    const existing = await this.prisma.product.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Produto ${id} não encontrado`);

    const companyId = dto.companyId || existing.companyId;

    // Validate SKU uniqueness if changed
    if (dto.sku && dto.sku !== existing.sku) {
      const duplicate = await this.prisma.product.findUnique({
        where: { companyId_sku: { companyId, sku: dto.sku } },
      });
      if (duplicate) {
        throw new ConflictException(`SKU '${dto.sku}' já existe para esta empresa`);
      }
    }

    // Validate NCM rule
    const effectiveType = dto.type || existing.type;
    const effectiveNcm = dto.ncm !== undefined ? dto.ncm : existing.ncm;
    if (effectiveType === 'FINISHED_GOOD' && !effectiveNcm) {
      throw new BadRequestException('Produto acabado exige NCM');
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: dto,
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user?.id,
        companyId,
        entity: 'Product',
        action: 'UPDATE',
        payload: { ...dto },
      },
    });

    return product;
  }
}
