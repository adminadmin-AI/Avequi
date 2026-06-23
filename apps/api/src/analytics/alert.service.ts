import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';

@Injectable()
export class AlertService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Rules ───────────────────────────────────────────────────────────────────

  async createRule(companyId: string, data: CreateAlertRuleDto) {
    return this.prisma.alertRule.create({
      data: {
        companyId,
        name: data.name,
        metric: data.metric,
        dataSource: data.dataSource,
        operator: data.operator,
        threshold: data.threshold ?? undefined,
        windowDays: data.windowDays ?? 30,
        notifyRoles: data.notifyRoles ?? [],
      },
    });
  }

  async findRules(companyId: string) {
    return this.prisma.alertRule.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRule(companyId: string, id: string, data: Partial<CreateAlertRuleDto>) {
    await this.assertRuleOwnership(companyId, id);

    return this.prisma.alertRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.metric !== undefined && { metric: data.metric }),
        ...(data.dataSource !== undefined && { dataSource: data.dataSource }),
        ...(data.operator !== undefined && { operator: data.operator }),
        ...(data.threshold !== undefined && { threshold: data.threshold }),
        ...(data.windowDays !== undefined && { windowDays: data.windowDays }),
        ...(data.notifyRoles !== undefined && { notifyRoles: data.notifyRoles }),
      },
    });
  }

  async deleteRule(companyId: string, id: string) {
    await this.assertRuleOwnership(companyId, id);
    await this.prisma.alertRule.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Triggers ────────────────────────────────────────────────────────────────

  async findTriggers(
    companyId: string,
    ruleId?: string,
    acknowledged?: boolean,
  ) {
    return this.prisma.alertTrigger.findMany({
      where: {
        companyId,
        ...(ruleId !== undefined && { alertRuleId: ruleId }),
        ...(acknowledged !== undefined && { acknowledged }),
      },
      include: { alertRule: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acknowledgeTrigger(id: string, userId: string) {
    const trigger = await this.prisma.alertTrigger.findUnique({ where: { id } });
    if (!trigger) {
      throw new BusinessException('Alert trigger not found', HttpStatus.NOT_FOUND);
    }
    if (trigger.acknowledged) {
      throw new BusinessException(
        'Alert trigger already acknowledged',
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.alertTrigger.update({
      where: { id },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async assertRuleOwnership(companyId: string, id: string) {
    const rule = await this.prisma.alertRule.findFirst({
      where: { id, companyId },
    });
    if (!rule) {
      throw new BusinessException('Alert rule not found', HttpStatus.NOT_FOUND);
    }
    return rule;
  }
}
