import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

export const PO_CREATED_EVENT = 'purchase.order.created';

@Injectable()
export class BpmPurchaseListener {
  private readonly logger = new Logger(BpmPurchaseListener.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quando uma PO é criada, verifica se há workflow BPM configurado
   * para 'PurchaseOrder' e inicia automaticamente.
   */
  @OnEvent(PO_CREATED_EVENT)
  async handlePoCreated(payload: { companyId: string; purchaseOrderId: string; totalValue: number }) {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        companyId: payload.companyId,
        entityType: 'PurchaseOrder',
        status: 'ACTIVE',
      },
      include: { versions: { where: { isPublished: true }, take: 1 } },
    });

    if (!workflow || !workflow.versions[0]) {
      this.logger.debug(`Sem workflow BPM ativo para PurchaseOrder na company ${payload.companyId}`);
      return;
    }

    // Criar instância do workflow
    await this.prisma.workflowInstance.create({
      data: {
        companyId: payload.companyId,
        workflowId: workflow.id,
        versionId: workflow.versions[0].id,
        entityType: 'PurchaseOrder',
        entityId: payload.purchaseOrderId,
        status: 'RUNNING',
        currentNodeId: 'start',
        context: { totalValue: payload.totalValue },
      },
    });

    this.logger.log(`Workflow BPM iniciado para PO ${payload.purchaseOrderId}`);
  }
}
