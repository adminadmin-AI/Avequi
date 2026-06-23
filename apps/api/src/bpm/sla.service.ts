import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateSlaDefinitionDto } from './dto/create-sla-definition.dto';

@Injectable()
export class SlaService {
  constructor(private readonly prisma: PrismaService) {}

  async createDefinition(companyId: string, dto: CreateSlaDefinitionDto) {
    return this.prisma.slaDefinition.create({
      data: {
        companyId,
        entityType: dto.entityType,
        statusFrom: dto.statusFrom,
        statusTo: dto.statusTo,
        maxDurationHours: dto.maxDurationHours,
        escalateToRole: dto.escalateToRole,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findDefinitions(companyId: string, entityType?: string) {
    return this.prisma.slaDefinition.findMany({
      where: {
        companyId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: [{ entityType: 'asc' }, { statusFrom: 'asc' }],
    });
  }

  async updateDefinition(
    companyId: string,
    id: string,
    data: Partial<CreateSlaDefinitionDto>,
  ) {
    const definition = await this.prisma.slaDefinition.findFirst({
      where: { id, companyId },
    });
    if (!definition) {
      throw new BusinessException('Definição de SLA não encontrada', HttpStatus.NOT_FOUND);
    }
    return this.prisma.slaDefinition.update({ where: { id }, data });
  }

  async deleteDefinition(companyId: string, id: string) {
    const definition = await this.prisma.slaDefinition.findFirst({
      where: { id, companyId },
    });
    if (!definition) {
      throw new BusinessException('Definição de SLA não encontrada', HttpStatus.NOT_FOUND);
    }
    return this.prisma.slaDefinition.delete({ where: { id } });
  }

  async checkSla(
    companyId: string,
    entityType: string,
    entityId: string,
    statusFrom: string,
    statusTo: string,
    startedAt: Date,
  ): Promise<{ breached: boolean; expectedAt: Date | null; definition: any | null }> {
    const definition = await this.prisma.slaDefinition.findFirst({
      where: { companyId, entityType, statusFrom, statusTo, isActive: true },
    });

    if (!definition) {
      return { breached: false, expectedAt: null, definition: null };
    }

    const expectedAt = new Date(startedAt);
    expectedAt.setHours(expectedAt.getHours() + definition.maxDurationHours);

    const now = new Date();
    const breached = now > expectedAt;

    if (breached) {
      await this.recordBreach(definition.id, entityType, entityId, expectedAt);
    }

    return { breached, expectedAt, definition };
  }

  async recordBreach(
    slaDefinitionId: string,
    entityType: string,
    entityId: string,
    expectedAt: Date,
  ) {
    // Avoid duplicate breach records for same entity
    const existing = await this.prisma.slaBreach.findFirst({
      where: { slaDefinitionId, entityType, entityId, resolved: false },
    });
    if (existing) return existing;

    return this.prisma.slaBreach.create({
      data: {
        slaDefinitionId,
        entityType,
        entityId,
        expectedAt,
        breachedAt: new Date(),
      },
    });
  }

  async findBreaches(
    companyId: string,
    filters?: { entityType?: string; resolved?: boolean },
  ) {
    return this.prisma.slaBreach.findMany({
      where: {
        slaDefinition: { companyId },
        ...(filters?.entityType ? { entityType: filters.entityType } : {}),
        ...(filters?.resolved !== undefined ? { resolved: filters.resolved } : {}),
      },
      include: { slaDefinition: true },
      orderBy: { breachedAt: 'desc' },
    });
  }

  async resolveBreach(id: string) {
    const breach = await this.prisma.slaBreach.findUnique({ where: { id } });
    if (!breach) {
      throw new BusinessException('Violação de SLA não encontrada', HttpStatus.NOT_FOUND);
    }
    return this.prisma.slaBreach.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
}
