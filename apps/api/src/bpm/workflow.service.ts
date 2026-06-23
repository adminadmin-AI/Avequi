import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { CreateWorkflowVersionDto } from './dto/create-workflow-version.dto';

@Injectable()
export class WorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateWorkflowDto) {
    const existing = await this.prisma.workflow.findFirst({
      where: { companyId, name: dto.name },
    });
    if (existing) {
      throw new BusinessException(
        `Workflow com nome "${dto.name}" já existe`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.workflow.create({
      data: {
        companyId,
        name: dto.name,
        entityType: dto.entityType,
        description: dto.description,
        triggerEvent: dto.triggerEvent,
      },
    });
  }

  async findAll(companyId: string, entityType?: string) {
    return this.prisma.workflow.findMany({
      where: {
        companyId,
        ...(entityType ? { entityType } : {}),
      },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, companyId },
      include: {
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!workflow) {
      throw new BusinessException('Workflow não encontrado', HttpStatus.NOT_FOUND);
    }
    return workflow;
  }

  async update(companyId: string, id: string, data: Partial<CreateWorkflowDto>) {
    await this.findOne(companyId, id);
    return this.prisma.workflow.update({
      where: { id },
      data,
    });
  }

  async archive(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.workflow.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async createVersion(
    companyId: string,
    workflowId: string,
    dto: CreateWorkflowVersionDto,
  ) {
    await this.findOne(companyId, workflowId);

    const lastVersion = await this.prisma.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { version: 'desc' },
    });

    const nextVersion = lastVersion ? lastVersion.version + 1 : 1;

    return this.prisma.workflowVersion.create({
      data: {
        workflowId,
        version: nextVersion,
        definition: dto.definition,
        isActive: false,
      },
    });
  }

  async publishVersion(companyId: string, workflowId: string, versionId: string) {
    await this.findOne(companyId, workflowId);

    const version = await this.prisma.workflowVersion.findFirst({
      where: { id: versionId, workflowId },
    });
    if (!version) {
      throw new BusinessException('Versão não encontrada', HttpStatus.NOT_FOUND);
    }

    // Deactivate all other versions
    await this.prisma.workflowVersion.updateMany({
      where: { workflowId, id: { not: versionId } },
      data: { isActive: false },
    });

    // Activate this version
    return this.prisma.workflowVersion.update({
      where: { id: versionId },
      data: { isActive: true, publishedAt: new Date() },
    });
  }

  async getActiveVersion(workflowId: string) {
    const version = await this.prisma.workflowVersion.findFirst({
      where: { workflowId, isActive: true },
    });
    if (!version) {
      throw new BusinessException(
        'Nenhuma versão ativa encontrada para este workflow',
        HttpStatus.NOT_FOUND,
      );
    }
    return version;
  }
}
