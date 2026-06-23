import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionHandler, ActionContext, ActionResult } from '../engine/action-executor';

@Injectable()
export class EscalateApprovalHandler implements ActionHandler {
  readonly type = 'ESCALATE_APPROVAL';
  private readonly logger = new Logger(EscalateApprovalHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(context: ActionContext): Promise<ActionResult> {
    const { companyId, config, instanceId } = context;
    const { role, message } = config;

    if (!role) {
      return { success: false, error: 'escalate-approval: "role" is required' };
    }

    const notification = await this.prisma.notification.create({
      data: {
        companyId,
        role,
        title: 'Aprovação Necessária — Escalada',
        message: message ?? `Aprovação escalada para o papel: ${role}. Instância: ${instanceId}`,
        type: 'ACTION_REQUIRED',
        entityType: 'WorkflowInstance',
        entityId: instanceId,
      },
    });

    this.logger.log(
      `Approval escalated to role "${role}" for instance ${instanceId}`,
    );

    return {
      success: true,
      data: { notificationId: notification.id, role },
    };
  }
}
