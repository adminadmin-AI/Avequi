import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

export interface CreateEmailTemplateDto {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  variables?: string[];
}

export interface UpdateEmailTemplateDto {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  variables?: string[];
  isActive?: boolean;
}

@Injectable()
export class EmailTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateEmailTemplateDto) {
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { companyId, name: dto.name },
    });
    if (existing) {
      throw new BusinessException(
        `Template com nome "${dto.name}" já existe`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.emailTemplate.create({
      data: {
        companyId,
        name: dto.name,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText ?? null,
        variables: dto.variables ?? [],
      },
    });
  }

  async findAll(companyId: string, activeOnly = false) {
    return this.prisma.emailTemplate.findMany({
      where: {
        companyId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, companyId },
    });
    if (!template) {
      throw new BusinessException('Template de email não encontrado', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  async update(companyId: string, id: string, dto: UpdateEmailTemplateDto) {
    await this.findOne(companyId, id);

    if (dto.name) {
      const conflict = await this.prisma.emailTemplate.findFirst({
        where: { companyId, name: dto.name, NOT: { id } },
      });
      if (conflict) {
        throw new BusinessException(
          `Template com nome "${dto.name}" já existe`,
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.bodyHtml !== undefined ? { bodyHtml: dto.bodyHtml } : {}),
        ...(dto.bodyText !== undefined ? { bodyText: dto.bodyText } : {}),
        ...(dto.variables !== undefined ? { variables: dto.variables } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.emailTemplate.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Render a template by name, interpolating {{variable}} placeholders.
   */
  async render(
    companyId: string,
    templateName: string,
    variables: Record<string, any>,
  ): Promise<{ subject: string; bodyHtml: string; bodyText?: string }> {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { companyId, name: templateName, isActive: true },
    });
    if (!template) {
      throw new BusinessException(
        `Template de email "${templateName}" não encontrado`,
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      subject: this.interpolate(template.subject, variables),
      bodyHtml: this.interpolate(template.bodyHtml, variables),
      bodyText: template.bodyText ? this.interpolate(template.bodyText, variables) : undefined,
    };
  }

  private interpolate(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = vars[key];
      return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
  }
}
