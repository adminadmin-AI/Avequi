import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionHandler, ActionContext, ActionResult } from '../engine/action-executor';

@Injectable()
export class SendEmailHandler implements ActionHandler {
  readonly type = 'SEND_EMAIL';
  private readonly logger = new Logger(SendEmailHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(context: ActionContext): Promise<ActionResult> {
    const { companyId, config, variables } = context;
    const { to, subject: configSubject, templateName, body, variables: templateVars } = config;

    if (!to) {
      return { success: false, error: 'send-email: "to" field is required' };
    }

    let subject = configSubject ?? '(sem assunto)';
    let bodyHtml = body ?? '';

    if (templateName) {
      const template = await this.prisma.emailTemplate.findFirst({
        where: { companyId, name: templateName, isActive: true },
      });

      if (!template) {
        return { success: false, error: `Email template "${templateName}" not found` };
      }

      subject = this.interpolate(template.subject, { ...variables, ...(templateVars ?? {}) });
      bodyHtml = this.interpolate(template.bodyHtml, { ...variables, ...(templateVars ?? {}) });
    } else if (body) {
      bodyHtml = this.interpolate(body, { ...variables, ...(templateVars ?? {}) });
    }

    // In production: emit event for email service to consume
    this.eventEmitter.emit('email.send', {
      companyId,
      to,
      subject,
      bodyHtml,
      instanceId: context.instanceId,
    });

    // Also create an in-app notification as fallback
    await this.prisma.notification.create({
      data: {
        companyId,
        title: `Email: ${subject}`,
        message: `Email enviado para: ${to}`,
        type: 'INFO',
        entityType: 'WorkflowInstance',
        entityId: context.instanceId,
      },
    });

    this.logger.log(`Email action queued: to=${to}, subject=${subject}`);

    return {
      success: true,
      data: { to, subject, bodyHtml },
    };
  }

  /**
   * Interpolate {{variable}} placeholders in a template string.
   */
  interpolate(template: string, vars: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = vars[key];
      return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
  }
}
