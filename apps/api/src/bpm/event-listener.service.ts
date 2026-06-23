import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngine } from './engine/workflow-engine';

@Injectable()
export class EventListenerService {
  private readonly logger = new Logger(EventListenerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngine,
  ) {}

  @OnEvent('**')
  async handleAnyEvent(payload: any) {
    // The event name is not directly available in @OnEvent('**') handler body,
    // so we use a wrapper approach. This method is called with the payload.
    // We need the event name — NestJS EventEmitter passes it via the emitter context.
    // We handle this by subscribing per-event via the eventEmitter in startWorkflow.
    // This handler is intentionally left as a no-op placeholder for documentation.
    // Real auto-trigger is done in handleNamedEvent below.
  }

  @OnEvent('**', { async: true })
  async handleNamedEvent(payload: any, context?: { event?: string }) {
    const eventName = context?.event;
    if (!eventName) return;

    // Skip internal workflow events to avoid recursion
    if (eventName.startsWith('workflow.')) return;

    try {
      const workflows = await this.prisma.workflow.findMany({
        where: { triggerEvent: eventName, status: 'ACTIVE' },
        include: { versions: { where: { isActive: true } } },
      });

      for (const workflow of workflows) {
        if (workflow.versions.length === 0) continue;

        const entityType = payload?.entityType ?? workflow.entityType;
        const entityId = payload?.entityId ?? payload?.id ?? 'unknown';
        const variables = payload?.variables ?? payload ?? {};

        this.logger.log(
          `Auto-triggering workflow "${workflow.name}" for event "${eventName}" entity ${entityType}:${entityId}`,
        );

        await this.workflowEngine
          .startWorkflow(workflow.companyId, workflow.id, entityType, entityId, variables)
          .catch((err) => {
            this.logger.error(
              `Failed to auto-trigger workflow ${workflow.id}: ${err.message}`,
            );
          });
      }
    } catch (err: any) {
      this.logger.error(`EventListenerService error: ${err.message}`);
    }
  }
}
