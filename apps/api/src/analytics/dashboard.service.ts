import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { UpdateDashboardDto } from './dto/update-dashboard.dto';
import { CreateWidgetDto } from './dto/create-widget.dto';
import { UpdateWidgetDto } from './dto/update-widget.dto';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Dashboard CRUD ──────────────────────────────────────────────────────────

  async create(companyId: string, userId: string, data: CreateDashboardDto) {
    return this.prisma.dashboard.create({
      data: {
        companyId,
        userId,
        name: data.name,
        description: data.description,
        isShared: data.isShared ?? false,
        layout: data.layout ?? undefined,
      },
      include: { widgets: true },
    });
  }

  /** Returns user's own dashboards + shared dashboards within the company. */
  async findAll(companyId: string, userId: string) {
    return this.prisma.dashboard.findMany({
      where: {
        companyId,
        OR: [{ userId }, { isShared: true }],
      },
      include: { widgets: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async findOne(companyId: string, id: string, userId?: string) {
    const dashboard = await this.prisma.dashboard.findFirst({
      where: { id, companyId },
      include: { widgets: true },
    });

    if (!dashboard) {
      throw new BusinessException('Dashboard not found', HttpStatus.NOT_FOUND);
    }

    // Access check: must be owner or dashboard must be shared
    if (userId && dashboard.userId !== userId && !dashboard.isShared) {
      throw new BusinessException('Access denied to this dashboard', HttpStatus.FORBIDDEN);
    }

    return dashboard;
  }

  async update(companyId: string, userId: string, id: string, data: UpdateDashboardDto) {
    const dashboard = await this.findOne(companyId, id);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can update this dashboard', HttpStatus.FORBIDDEN);
    }

    return this.prisma.dashboard.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isShared !== undefined && { isShared: data.isShared }),
        ...(data.layout !== undefined && { layout: data.layout }),
      },
      include: { widgets: true },
    });
  }

  async delete(companyId: string, userId: string, id: string) {
    const dashboard = await this.findOne(companyId, id);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can delete this dashboard', HttpStatus.FORBIDDEN);
    }

    await this.prisma.dashboard.delete({ where: { id } });
    return { deleted: true };
  }

  /** Sets the dashboard as the user's default; unsets previous default. */
  async setDefault(companyId: string, userId: string, id: string) {
    const dashboard = await this.findOne(companyId, id);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can set default dashboard', HttpStatus.FORBIDDEN);
    }

    // Unset previous default
    await this.prisma.dashboard.updateMany({
      where: { companyId, userId, isDefault: true },
      data: { isDefault: false },
    });

    return this.prisma.dashboard.update({
      where: { id },
      data: { isDefault: true },
      include: { widgets: true },
    });
  }

  /** Toggles isShared. Only owner can toggle. */
  async share(companyId: string, userId: string, id: string) {
    const dashboard = await this.findOne(companyId, id);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can share this dashboard', HttpStatus.FORBIDDEN);
    }

    return this.prisma.dashboard.update({
      where: { id },
      data: { isShared: !dashboard.isShared },
      include: { widgets: true },
    });
  }

  /** Duplicates a dashboard and all its widgets for the requesting user. */
  async duplicate(companyId: string, userId: string, id: string) {
    const source = await this.findOne(companyId, id, userId);

    const copy = await this.prisma.dashboard.create({
      data: {
        companyId,
        userId,
        name: `${source.name} (cópia)`,
        description: source.description,
        isShared: false,
        isDefault: false,
        layout: source.layout ?? undefined,
        widgets: {
          create: source.widgets.map((w) => ({
            type: w.type,
            title: w.title,
            config: w.config as Record<string, any>,
            position: w.position as Record<string, any>,
            refreshInterval: w.refreshInterval,
          })),
        },
      },
      include: { widgets: true },
    });

    return copy;
  }

  // ─── Widget CRUD ─────────────────────────────────────────────────────────────

  async createWidget(companyId: string, userId: string, dashboardId: string, data: CreateWidgetDto) {
    const dashboard = await this.findOne(companyId, dashboardId);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can add widgets to this dashboard', HttpStatus.FORBIDDEN);
    }

    return this.prisma.dashboardWidget.create({
      data: {
        dashboardId,
        type: data.type,
        title: data.title,
        config: data.config,
        position: data.position,
        refreshInterval: data.refreshInterval,
      },
    });
  }

  async findWidgets(companyId: string, userId: string, dashboardId: string) {
    // findOne validates access
    await this.findOne(companyId, dashboardId, userId);

    return this.prisma.dashboardWidget.findMany({
      where: { dashboardId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateWidget(
    companyId: string,
    userId: string,
    dashboardId: string,
    widgetId: string,
    data: UpdateWidgetDto,
  ) {
    const dashboard = await this.findOne(companyId, dashboardId);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can update widgets', HttpStatus.FORBIDDEN);
    }

    const widget = await this.prisma.dashboardWidget.findFirst({
      where: { id: widgetId, dashboardId },
    });

    if (!widget) {
      throw new BusinessException('Widget not found', HttpStatus.NOT_FOUND);
    }

    return this.prisma.dashboardWidget.update({
      where: { id: widgetId },
      data: {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.position !== undefined && { position: data.position }),
        ...(data.refreshInterval !== undefined && { refreshInterval: data.refreshInterval }),
      },
    });
  }

  async deleteWidget(companyId: string, userId: string, dashboardId: string, widgetId: string) {
    const dashboard = await this.findOne(companyId, dashboardId);

    if (dashboard.userId !== userId) {
      throw new BusinessException('Only the owner can delete widgets', HttpStatus.FORBIDDEN);
    }

    const widget = await this.prisma.dashboardWidget.findFirst({
      where: { id: widgetId, dashboardId },
    });

    if (!widget) {
      throw new BusinessException('Widget not found', HttpStatus.NOT_FOUND);
    }

    await this.prisma.dashboardWidget.delete({ where: { id: widgetId } });
    return { deleted: true };
  }
}
