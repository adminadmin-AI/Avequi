import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ActionContext {
  companyId: string;
  instanceId: string;
  nodeId: string;
  config: Record<string, any>;
  variables: Record<string, any>;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface ActionHandler {
  type: string;
  execute(context: ActionContext): Promise<ActionResult>;
}

@Injectable()
export class ActionExecutor {
  private readonly logger = new Logger(ActionExecutor.name);
  private readonly handlers = new Map<string, ActionHandler>();

  constructor(private readonly prisma: PrismaService) {}

  registerHandler(handler: ActionHandler): void {
    this.handlers.set(handler.type, handler);
    this.logger.log(`Registered action handler: ${handler.type}`);
  }

  async execute(context: ActionContext): Promise<ActionResult> {
    const actionType = context.config?.actionType as string;
    if (!actionType) {
      return { success: false, error: 'actionType not specified in config' };
    }

    const handler = this.handlers.get(actionType);
    if (!handler) {
      const err = `No handler registered for action type: ${actionType}`;
      this.logger.warn(err);

      await this.saveActionRecord(context, actionType, 'FAILED', null, err);
      return { success: false, error: err };
    }

    // Record as EXECUTING
    const record = await this.saveActionRecord(context, actionType, 'EXECUTING', null, null);

    let result: ActionResult;
    try {
      result = await handler.execute(context);
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      this.logger.error(`Action ${actionType} failed: ${errorMsg}`);

      await this.prisma.workflowAction.update({
        where: { id: record.id },
        data: {
          status: 'FAILED',
          error: errorMsg,
          executedAt: new Date(),
        },
      });

      return { success: false, error: errorMsg };
    }

    await this.prisma.workflowAction.update({
      where: { id: record.id },
      data: {
        status: result.success ? 'COMPLETED' : 'FAILED',
        result: result.data ? result.data : undefined,
        error: result.error ?? null,
        executedAt: new Date(),
      },
    });

    return result;
  }

  private async saveActionRecord(
    context: ActionContext,
    actionType: string,
    status: string,
    result: any,
    error: string | null,
  ) {
    return this.prisma.workflowAction.create({
      data: {
        instanceId: context.instanceId,
        nodeId: context.nodeId,
        actionType,
        config: context.config ?? undefined,
        status: status as any,
        result: result ?? undefined,
        error: error ?? undefined,
        executedAt: ['COMPLETED', 'FAILED'].includes(status) ? new Date() : undefined,
      },
    });
  }
}
