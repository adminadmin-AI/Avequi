import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionHandler, ActionContext, ActionResult } from '../engine/action-executor';

@Injectable()
export class BlockCreditHandler implements ActionHandler {
  readonly type = 'BLOCK_CREDIT';
  private readonly logger = new Logger(BlockCreditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(context: ActionContext): Promise<ActionResult> {
    const { companyId, config } = context;
    const { customerId } = config;

    if (!customerId) {
      return { success: false, error: 'block-credit: "customerId" is required' };
    }

    const updated = await this.prisma.creditLimit.updateMany({
      where: { companyId, customerId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED' },
    });

    this.logger.log(
      `Credit blocked for customer ${customerId}: ${updated.count} limit(s) suspended`,
    );

    return {
      success: true,
      data: { customerId, suspendedCount: updated.count },
    };
  }
}
