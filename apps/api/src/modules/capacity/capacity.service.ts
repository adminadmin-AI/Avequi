import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { QueryCapacityDto } from './dto/query-capacity.dto';

@Injectable()
export class CapacityService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Work Center CRUD ──────────────────────────────────────────────────────

  async createWorkCenter(companyId: string, dto: CreateWorkCenterDto) {
    const existing = await this.prisma.workCenter.findFirst({
      where: { companyId, code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Centro de trabalho com código '${dto.code}' já existe`);
    }
    return this.prisma.workCenter.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        ...(dto.capacityHoursPerDay !== undefined ? { capacityHoursPerDay: dto.capacityHoursPerDay } : {}),
        ...(dto.operatorsCount !== undefined ? { operatorsCount: dto.operatorsCount } : {}),
        ...(dto.efficiencyPct !== undefined ? { efficiencyPct: dto.efficiencyPct } : {}),
      },
    });
  }

  async listWorkCenters(companyId: string, includeInactive = false) {
    return this.prisma.workCenter.findMany({
      where: {
        companyId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  async getWorkCenter(id: string, companyId: string) {
    const wc = await this.prisma.workCenter.findFirst({
      where: { id, companyId },
    });
    if (!wc) throw new NotFoundException(`Centro de trabalho ${id} não encontrado`);
    return wc;
  }

  async updateWorkCenter(id: string, companyId: string, dto: UpdateWorkCenterDto) {
    await this.getWorkCenter(id, companyId);
    if (dto.code) {
      const conflict = await this.prisma.workCenter.findFirst({
        where: { companyId, code: dto.code, NOT: { id } },
      });
      if (conflict) {
        throw new BadRequestException(`Código '${dto.code}' já em uso`);
      }
    }
    return this.prisma.workCenter.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.capacityHoursPerDay !== undefined ? { capacityHoursPerDay: dto.capacityHoursPerDay } : {}),
        ...(dto.operatorsCount !== undefined ? { operatorsCount: dto.operatorsCount } : {}),
        ...(dto.efficiencyPct !== undefined ? { efficiencyPct: dto.efficiencyPct } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteWorkCenter(id: string, companyId: string) {
    const wc = await this.getWorkCenter(id, companyId);
    // Check if any active production orders reference this work center code
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: { in: ['RELEASED', 'IN_PROGRESS'] },
        product: {
          routingSteps: { some: { companyId, workCenter: wc.code } },
        },
      },
      take: 1,
    });
    if (orders.length > 0) {
      throw new BadRequestException(
        `Centro de trabalho '${wc.code}' está em uso por ordens de produção ativas`,
      );
    }
    return this.prisma.workCenter.delete({ where: { id } });
  }

  // ─── Capacity Analysis ──────────────────────────────────────────────────────

  async getCapacityPlan(companyId: string, dto: QueryCapacityDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const periodDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;

    const workCenters = await this.prisma.workCenter.findMany({
      where: {
        companyId,
        isActive: true,
        ...(dto.workCenterCode ? { code: dto.workCenterCode } : {}),
      },
    });

    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: { in: ['RELEASED', 'IN_PROGRESS'] },
        OR: [
          { scheduledStart: { lte: end } },
          { scheduledEnd: { gte: start } },
        ],
      },
      include: {
        product: {
          include: {
            routingSteps: { where: { companyId }, orderBy: { stepOrder: 'asc' } },
          },
        },
      },
    });

    const result = workCenters.map((wc) => {
      const availableHours =
        Number(wc.capacityHoursPerDay) *
        wc.operatorsCount *
        (Number(wc.efficiencyPct) / 100) *
        periodDays;

      let loadHours = 0;
      const contributingOrders: { orderId: string; productSku: string; loadHours: number }[] = [];

      for (const order of orders) {
        const steps = order.product.routingSteps.filter((s) => s.workCenter === wc.code);
        for (const step of steps) {
          const hours = (step.setupTimeMin + step.runTimeMin * Number(order.plannedQty)) / 60;
          loadHours += hours;
          contributingOrders.push({
            orderId: order.id,
            productSku: order.product.sku,
            loadHours: Math.round(hours * 100) / 100,
          });
        }
      }

      return {
        workCenterId: wc.id,
        code: wc.code,
        name: wc.name,
        availableHours: Math.round(availableHours * 100) / 100,
        loadHours: Math.round(loadHours * 100) / 100,
        utilizationPct:
          availableHours > 0
            ? Math.round((loadHours / availableHours) * 10000) / 100
            : 0,
        isBottleneck: loadHours > availableHours,
        contributingOrders,
      };
    });

    result.sort((a, b) => b.utilizationPct - a.utilizationPct);

    return {
      period: { startDate: dto.startDate, endDate: dto.endDate, days: periodDays },
      workCenters: result,
      bottlenecks: result.filter((r) => r.isBottleneck).map((r) => r.code),
      summary: {
        totalWorkCenters: result.length,
        bottleneckCount: result.filter((r) => r.isBottleneck).length,
        avgUtilizationPct:
          result.length > 0
            ? Math.round(
                (result.reduce((s, r) => s + r.utilizationPct, 0) / result.length) * 100,
              ) / 100
            : 0,
      },
    };
  }

  async getLoadByProduct(companyId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const orders = await this.prisma.productionOrder.findMany({
      where: {
        companyId,
        status: { in: ['RELEASED', 'IN_PROGRESS'] },
        OR: [
          { scheduledStart: { lte: end } },
          { scheduledEnd: { gte: start } },
        ],
      },
      include: {
        product: {
          include: {
            routingSteps: { where: { companyId }, orderBy: { stepOrder: 'asc' } },
          },
        },
      },
    });

    const byProduct: Record<
      string,
      { productSku: string; productId: string; loadByWorkCenter: Record<string, number> }
    > = {};

    for (const order of orders) {
      const key = order.product.id;
      if (!byProduct[key]) {
        byProduct[key] = {
          productSku: order.product.sku,
          productId: order.product.id,
          loadByWorkCenter: {},
        };
      }
      for (const step of order.product.routingSteps) {
        const wc = step.workCenter ?? 'UNKNOWN';
        const hours = (step.setupTimeMin + step.runTimeMin * Number(order.plannedQty)) / 60;
        byProduct[key].loadByWorkCenter[wc] =
          Math.round(((byProduct[key].loadByWorkCenter[wc] ?? 0) + hours) * 100) / 100;
      }
    }

    return Object.values(byProduct);
  }

  async getWorkCenterStats(companyId: string) {
    const all = await this.prisma.workCenter.findMany({ where: { companyId } });
    const active = all.filter((w) => w.isActive);
    const inactive = all.filter((w) => !w.isActive);
    const avgEfficiency =
      active.length > 0
        ? Math.round(
            (active.reduce((s, w) => s + Number(w.efficiencyPct), 0) / active.length) * 100,
          ) / 100
        : 0;
    const avgCapacity =
      active.length > 0
        ? Math.round(
            (active.reduce((s, w) => s + Number(w.capacityHoursPerDay), 0) / active.length) * 100,
          ) / 100
        : 0;
    return {
      total: all.length,
      active: active.length,
      inactive: inactive.length,
      avgEfficiencyPct: avgEfficiency,
      avgCapacityHoursPerDay: avgCapacity,
    };
  }
}
