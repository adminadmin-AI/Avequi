import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxRuleDto } from './dto/create-tax-rule.dto';
import { UpdateTaxRuleDto } from './dto/update-tax-rule.dto';

@Injectable()
export class TaxRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateTaxRuleDto) {
    return this.prisma.taxRule.create({
      data: { companyId, ...dto },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.taxRule.findMany({
      where: { companyId },
      orderBy: [{ operationType: 'asc' }, { priority: 'desc' }],
    });
  }

  async findOne(id: string, companyId: string) {
    const rule = await this.prisma.taxRule.findFirst({
      where: { id, companyId },
    });
    if (!rule) throw new NotFoundException(`Regra tributária ${id} não encontrada`);
    return rule;
  }

  async update(id: string, companyId: string, dto: UpdateTaxRuleDto) {
    await this.findOne(id, companyId);
    return this.prisma.taxRule.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.taxRule.delete({ where: { id } });
  }
}
