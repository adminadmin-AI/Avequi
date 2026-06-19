import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertSeverity,
  AlertType,
  EquipmentStatus,
  MaintenanceOrderStatus,
  MaintenanceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { CreateMaintenanceOrderDto } from './dto/create-maintenance-order.dto';
import { CompleteMaintenanceOrderDto } from './dto/complete-maintenance-order.dto';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── helpers ──────────────────────────────────────────────────────────────

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  private async upsertAlert(params: {
    companyId: string;
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    body: string;
    entityId?: string;
    entityType?: string;
  }): Promise<void> {
    const existing = await this.prisma.alert.findFirst({
      where: {
        companyId: params.companyId,
        type: params.type,
        entityId: params.entityId ?? null,
        resolvedAt: null,
      },
    });
    if (existing) return;

    await this.prisma.alert.create({ data: params });
    this.logger.warn(`[ALERT] ${params.type} — ${params.title}`);
  }

  // ─── Equipment ─────────────────────────────────────────────────────────────

  async createEquipment(
    companyId: string,
    dto: CreateEquipmentDto,
    userId?: string,
  ) {
    const now = new Date();
    const intervalDays = dto.maintenanceIntervalDays ?? 30;
    const nextMaintenanceAt = dto.nextMaintenanceAt
      ? new Date(dto.nextMaintenanceAt)
      : this.addDays(now, intervalDays);

    return this.prisma.equipment.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        location: dto.location,
        acquisitionDate: dto.acquisitionDate
          ? new Date(dto.acquisitionDate)
          : undefined,
        maintenanceIntervalDays: intervalDays,
        nextMaintenanceAt,
      },
    });
  }

  async listEquipment(
    companyId: string,
    opts: { status?: EquipmentStatus } = {},
  ) {
    return this.prisma.equipment.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      include: {
        _count: { select: { maintenanceOrders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEquipment(id: string, companyId: string) {
    const eq = await this.prisma.equipment.findFirst({
      where: { id, companyId },
      include: {
        maintenanceOrders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!eq) throw new NotFoundException(`Equipamento ${id} não encontrado`);
    return eq;
  }

  async updateEquipment(
    id: string,
    companyId: string,
    dto: UpdateEquipmentDto,
  ) {
    await this.getEquipment(id, companyId);
    return this.prisma.equipment.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.maintenanceIntervalDays !== undefined
          ? { maintenanceIntervalDays: dto.maintenanceIntervalDays }
          : {}),
        ...(dto.nextMaintenanceAt !== undefined
          ? { nextMaintenanceAt: new Date(dto.nextMaintenanceAt) }
          : {}),
      },
    });
  }

  async deactivateEquipment(id: string, companyId: string) {
    await this.getEquipment(id, companyId);
    return this.prisma.equipment.update({
      where: { id },
      data: { status: EquipmentStatus.INACTIVE },
    });
  }

  // ─── Maintenance Orders ────────────────────────────────────────────────────

  async createOrder(
    companyId: string,
    dto: CreateMaintenanceOrderDto,
    userId?: string,
  ) {
    // Verify equipment belongs to company
    const equipment = await this.prisma.equipment.findFirst({
      where: { id: dto.equipmentId, companyId },
    });
    if (!equipment)
      throw new NotFoundException(
        `Equipamento ${dto.equipmentId} não encontrado`,
      );

    const orderType = dto.type ?? MaintenanceType.PREVENTIVE;

    const order = await this.prisma.maintenanceOrder.create({
      data: {
        companyId,
        equipmentId: dto.equipmentId,
        type: orderType,
        title: dto.title,
        description: dto.description,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        technicianId: dto.technicianId,
        createdById: userId,
      },
    });

    // CORRECTIVE orders immediately mark equipment as UNDER_MAINTENANCE
    if (orderType === MaintenanceType.CORRECTIVE) {
      await this.prisma.equipment.update({
        where: { id: dto.equipmentId },
        data: { status: EquipmentStatus.UNDER_MAINTENANCE },
      });
    }

    return order;
  }

  async listOrders(
    companyId: string,
    opts: {
      status?: MaintenanceOrderStatus;
      equipmentId?: string;
      type?: MaintenanceType;
    } = {},
  ) {
    return this.prisma.maintenanceOrder.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.equipmentId ? { equipmentId: opts.equipmentId } : {}),
        ...(opts.type ? { type: opts.type } : {}),
      },
      include: {
        equipment: { select: { id: true, code: true, name: true, location: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(id: string, companyId: string) {
    const order = await this.prisma.maintenanceOrder.findFirst({
      where: { id, companyId },
      include: {
        equipment: true,
        technician: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!order)
      throw new NotFoundException(`Ordem de manutenção ${id} não encontrada`);
    return order;
  }

  async startOrder(id: string, companyId: string) {
    const order = await this.getOrder(id, companyId);
    if (order.status !== MaintenanceOrderStatus.OPEN) {
      throw new BadRequestException(
        `Ordem não está OPEN (status atual: ${order.status})`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.maintenanceOrder.update({
        where: { id },
        data: {
          status: MaintenanceOrderStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      }),
      this.prisma.equipment.update({
        where: { id: order.equipmentId },
        data: { status: EquipmentStatus.UNDER_MAINTENANCE },
      }),
    ]);

    return updated;
  }

  async completeOrder(
    id: string,
    companyId: string,
    dto: CompleteMaintenanceOrderDto,
    userId?: string,
  ) {
    const order = await this.getOrder(id, companyId);
    if (order.status !== MaintenanceOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Ordem não está IN_PROGRESS (status atual: ${order.status})`,
      );
    }

    const now = new Date();
    const nextMaintenanceAt = this.addDays(
      now,
      order.equipment.maintenanceIntervalDays,
    );

    const [updated] = await this.prisma.$transaction([
      this.prisma.maintenanceOrder.update({
        where: { id },
        data: {
          status: MaintenanceOrderStatus.DONE,
          completedAt: now,
          resolution: dto.resolution,
          cost: dto.cost !== undefined ? dto.cost : undefined,
        },
      }),
      this.prisma.equipment.update({
        where: { id: order.equipmentId },
        data: {
          status: EquipmentStatus.ACTIVE,
          nextMaintenanceAt,
        },
      }),
    ]);

    return updated;
  }

  async cancelOrder(id: string, companyId: string) {
    const order = await this.getOrder(id, companyId);
    if (order.status === MaintenanceOrderStatus.DONE) {
      throw new BadRequestException('Ordem já concluída não pode ser cancelada');
    }
    if (order.status === MaintenanceOrderStatus.CANCELLED) {
      throw new BadRequestException('Ordem já está cancelada');
    }

    const wasUnderMaintenance =
      order.equipment.status === EquipmentStatus.UNDER_MAINTENANCE;

    if (wasUnderMaintenance) {
      const [updated] = await this.prisma.$transaction([
        this.prisma.maintenanceOrder.update({
          where: { id },
          data: { status: MaintenanceOrderStatus.CANCELLED },
        }),
        this.prisma.equipment.update({
          where: { id: order.equipmentId },
          data: { status: EquipmentStatus.ACTIVE },
        }),
      ]);
      return updated;
    }

    return this.prisma.maintenanceOrder.update({
      where: { id },
      data: { status: MaintenanceOrderStatus.CANCELLED },
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getMaintenanceStats(companyId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalEquipment,
      activeEquipment,
      underMaintenanceEquipment,
      openOrders,
      inProgressOrders,
      doneThisMonth,
      overdueEquipment,
    ] = await Promise.all([
      this.prisma.equipment.count({ where: { companyId } }),
      this.prisma.equipment.count({
        where: { companyId, status: EquipmentStatus.ACTIVE },
      }),
      this.prisma.equipment.count({
        where: { companyId, status: EquipmentStatus.UNDER_MAINTENANCE },
      }),
      this.prisma.maintenanceOrder.count({
        where: { companyId, status: MaintenanceOrderStatus.OPEN },
      }),
      this.prisma.maintenanceOrder.count({
        where: { companyId, status: MaintenanceOrderStatus.IN_PROGRESS },
      }),
      this.prisma.maintenanceOrder.count({
        where: {
          companyId,
          status: MaintenanceOrderStatus.DONE,
          completedAt: { gte: startOfMonth },
        },
      }),
      this.prisma.equipment.count({
        where: {
          companyId,
          status: EquipmentStatus.ACTIVE,
          nextMaintenanceAt: { lt: now },
        },
      }),
    ]);

    return {
      equipment: {
        total: totalEquipment,
        active: activeEquipment,
        underMaintenance: underMaintenanceEquipment,
      },
      orders: {
        open: openOrders,
        inProgress: inProgressOrders,
        doneThisMonth,
      },
      overdueCount: overdueEquipment,
    };
  }

  // ─── Alert check ──────────────────────────────────────────────────────────

  async checkMaintenanceDue(companyId: string): Promise<number> {
    const now = new Date();
    const in7days = this.addDays(now, 7);

    const equipment = await this.prisma.equipment.findMany({
      where: {
        companyId,
        status: EquipmentStatus.ACTIVE,
        nextMaintenanceAt: { lte: in7days },
      },
    });

    let triggered = 0;
    for (const eq of equipment) {
      if (!eq.nextMaintenanceAt) continue;

      const isOverdue = eq.nextMaintenanceAt < now;
      const severity = isOverdue ? AlertSeverity.CRITICAL : AlertSeverity.WARNING;
      const daysLabel = isOverdue
        ? `vencida em ${eq.nextMaintenanceAt.toISOString().split('T')[0]}`
        : `vence em ${eq.nextMaintenanceAt.toISOString().split('T')[0]}`;

      await this.upsertAlert({
        companyId,
        type: AlertType.MAINTENANCE_DUE,
        severity,
        title: `Manutenção ${isOverdue ? 'atrasada' : 'próxima'}: ${eq.code} — ${eq.name}`,
        body: `Próxima manutenção ${daysLabel}${eq.location ? ` | Local: ${eq.location}` : ''}`,
        entityId: eq.id,
        entityType: 'Equipment',
      });
      triggered++;
    }

    return triggered;
  }
}
