import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

// SLA check runs every 15 minutes (900_000 ms)
const SLA_CHECK_INTERVAL_MS = 15 * 60 * 1000;

@Injectable()
export class SlaTrackerService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.intervalHandle = setInterval(
      () => void this.checkAllSlas(),
      SLA_CHECK_INTERVAL_MS,
    );
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async checkAllSlas(): Promise<void> {
    const definitions = await this.prisma.slaDefinition.findMany({
      where: { isActive: true },
    });

    for (const def of definitions) {
      await this.checkDefinition(def);
    }
  }

  private async checkDefinition(def: {
    id: string;
    companyId: string;
    entityType: string;
    statusFrom: string;
    maxDurationHours: number;
    escalateToRole: string | null;
  }): Promise<void> {
    // Find active workflow instances in the statusFrom state for this entity type
    const instances = await this.prisma.workflowInstance.findMany({
      where: {
        companyId: def.companyId,
        entityType: def.entityType,
        status: def.statusFrom as any,
      },
    });

    const now = new Date();

    for (const instance of instances) {
      // Find when this instance entered the current status via WorkflowHistory
      const historyEntry = await this.prisma.workflowHistory.findFirst({
        where: {
          instanceId: instance.id,
          toNodeId: def.statusFrom,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Use the history entry timestamp, or fall back to instance start time
      const enteredStatusAt: Date = historyEntry?.createdAt ?? instance.startedAt;

      const elapsedHours =
        (now.getTime() - enteredStatusAt.getTime()) / (1000 * 60 * 60);

      const maxHours = def.maxDurationHours;
      const warningThreshold = maxHours * 0.8;

      if (elapsedHours >= maxHours) {
        // Record breach (idempotent — SlaService.recordBreach already checks)
        const existing = await this.prisma.slaBreach.findFirst({
          where: {
            slaDefinitionId: def.id,
            entityType: def.entityType,
            entityId: instance.entityId,
            resolved: false,
          },
        });

        if (!existing) {
          const expectedAt = new Date(enteredStatusAt);
          expectedAt.setHours(expectedAt.getHours() + maxHours);

          await this.prisma.slaBreach.create({
            data: {
              slaDefinitionId: def.id,
              entityType: def.entityType,
              entityId: instance.entityId,
              expectedAt,
              breachedAt: now,
            },
          });

          // Notify
          await this.notificationService.findAll(def.companyId); // ensure service is active
          await this.prisma.notification.create({
            data: {
              companyId: def.companyId,
              role: def.escalateToRole ?? undefined,
              title: 'SLA Violado',
              message: `SLA violado para ${def.entityType} (ID: ${instance.entityId}). Tempo máximo de ${maxHours}h excedido.`,
              type: 'ALERT',
              entityType: def.entityType,
              entityId: instance.entityId,
            },
          });

          this.eventEmitter.emit('sla.breach', {
            definitionId: def.id,
            entityType: def.entityType,
            entityId: instance.entityId,
            instanceId: instance.id,
            elapsedHours,
            maxHours,
          });
        }
      } else if (elapsedHours >= warningThreshold) {
        // Warning at 80% — only once (check if warning notification already exists)
        const alreadyWarned = await this.prisma.notification.findFirst({
          where: {
            companyId: def.companyId,
            type: 'WARNING',
            entityType: def.entityType,
            entityId: instance.entityId,
          },
        });

        if (!alreadyWarned) {
          const remainingHours = (maxHours - elapsedHours).toFixed(1);

          await this.prisma.notification.create({
            data: {
              companyId: def.companyId,
              role: def.escalateToRole ?? undefined,
              title: 'Aviso SLA',
              message: `SLA em risco para ${def.entityType} (ID: ${instance.entityId}). Restam ${remainingHours}h de ${maxHours}h permitidas.`,
              type: 'WARNING',
              entityType: def.entityType,
              entityId: instance.entityId,
            },
          });

          this.eventEmitter.emit('sla.warning', {
            definitionId: def.id,
            entityType: def.entityType,
            entityId: instance.entityId,
            instanceId: instance.id,
            elapsedHours,
            maxHours,
            percentUsed: (elapsedHours / maxHours) * 100,
          });
        }
      }
    }
  }
}
