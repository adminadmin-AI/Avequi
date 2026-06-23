import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionHandler, ActionContext, ActionResult } from '../engine/action-executor';

@Injectable()
export class CreateNotificationHandler implements ActionHandler {
  readonly type = 'CREATE_NOTIFICATION';
  private readonly logger = new Logger(CreateNotificationHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(context: ActionContext): Promise<ActionResult> {
    const { companyId, config, instanceId } = context;
    const { userId, role, title, message, type, entityType, entityId } = config;

    if (!title || !message) {
      return { success: false, error: 'create-notification: "title" and "message" are required' };
    }

    const notification = await this.prisma.notification.create({
      data: {
        companyId,
        userId: userId ?? null,
        role: role ?? null,
        title,
        message,
        type: type ?? 'INFO',
        entityType: entityType ?? 'WorkflowInstance',
        entityId: entityId ?? instanceId,
      },
    });

    this.logger.log(`Notification created: id=${notification.id}, title="${title}"`);

    return {
      success: true,
      data: { notificationId: notification.id },
    };
  }
}
