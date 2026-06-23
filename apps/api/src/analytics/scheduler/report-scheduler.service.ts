import { Injectable, HttpStatus, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { CreateScheduleDto } from '../dto/create-schedule.dto';
import { ExportService } from '../export/export.service';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ReportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: ExportService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.intervalHandle = setInterval(() => {
      void this.checkDueSchedules();
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  async createSchedule(companyId: string, data: CreateScheduleDto) {
    const nextRunAt = this.getNextRunDate(data.cronExpr);
    return this.prisma.reportSchedule.create({
      data: {
        companyId,
        name: data.name,
        dashboardId: data.dashboardId,
        format: data.format,
        cronExpr: data.cronExpr,
        recipients: data.recipients,
        isActive: true,
        nextRunAt,
      },
    });
  }

  async findSchedules(companyId: string) {
    return this.prisma.reportSchedule.findMany({
      where: { companyId },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateSchedule(companyId: string, id: string, data: Partial<CreateScheduleDto>) {
    await this.assertOwnership(companyId, id);

    const nextRunAt = data.cronExpr ? this.getNextRunDate(data.cronExpr) : undefined;

    return this.prisma.reportSchedule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.dashboardId !== undefined && { dashboardId: data.dashboardId }),
        ...(data.format !== undefined && { format: data.format }),
        ...(data.cronExpr !== undefined && { cronExpr: data.cronExpr }),
        ...(data.recipients !== undefined && { recipients: data.recipients }),
        ...(nextRunAt !== undefined && { nextRunAt }),
      },
    });
  }

  async deleteSchedule(companyId: string, id: string) {
    await this.assertOwnership(companyId, id);
    await this.prisma.reportSchedule.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Run ──────────────────────────────────────────────────────────────────────

  async runSchedule(scheduleId: string, userId = 'system') {
    const schedule = await this.prisma.reportSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule) {
      throw new BusinessException('Report schedule not found', HttpStatus.NOT_FOUND);
    }

    const run = await this.prisma.reportRun.create({
      data: {
        scheduleId,
        status: 'RUNNING',
        format: schedule.format,
        startedAt: new Date(),
      },
    });

    try {
      let content = '';
      let fileSize = 0;

      if (schedule.dashboardId) {
        const exported = await this.exportService.exportDashboardData(
          schedule.companyId,
          schedule.dashboardId,
          schedule.format as 'CSV' | 'XLSX' | 'HTML',
          userId,
        );
        content = exported.content;
        fileSize = Buffer.byteLength(content, 'utf8');
      } else {
        content = `Report: ${schedule.name} — ${new Date().toISOString()}`;
        fileSize = Buffer.byteLength(content, 'utf8');
      }

      const completed = await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          fileSize,
          completedAt: new Date(),
        },
      });

      await this.prisma.reportSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          nextRunAt: this.getNextRunDate(schedule.cronExpr),
        },
      });

      this.events.emit('report.generated', {
        scheduleId,
        runId: run.id,
        companyId: schedule.companyId,
        format: schedule.format,
        recipients: schedule.recipients,
        fileSize,
      });

      return completed;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error,
          completedAt: new Date(),
        },
      });
    }
  }

  // ─── Cron ─────────────────────────────────────────────────────────────────────

  async checkDueSchedules() {
    const now = new Date();
    const due = await this.prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
    });

    for (const schedule of due) {
      await this.runSchedule(schedule.id).catch(() => {
        // Individual failures should not break the loop
      });
    }
  }

  // ─── Cron Parser ──────────────────────────────────────────────────────────────

  /**
   * Simple cron parser for common patterns.
   * Supports: daily (@daily, 0 0 * * *), weekly (0 0 * * 0), monthly (0 0 1 * *),
   * and basic 5-field expressions.
   */
  getNextRunDate(cronExpr: string, from?: Date): Date {
    const base = from ?? new Date();
    const next = new Date(base);

    const normalized = cronExpr.trim().toLowerCase();

    // Handle @shortcuts
    if (normalized === '@daily' || normalized === '0 0 * * *') {
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(0, 0, 0, 0);
      return next;
    }

    if (normalized === '@hourly' || normalized === '0 * * * *') {
      next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
      return next;
    }

    if (normalized === '@weekly' || normalized === '0 0 * * 0') {
      const daysUntilSunday = (7 - next.getUTCDay()) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + daysUntilSunday);
      next.setUTCHours(0, 0, 0, 0);
      return next;
    }

    if (normalized === '@monthly' || normalized === '0 0 1 * *') {
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      next.setUTCHours(0, 0, 0, 0);
      return next;
    }

    // Parse 5-field cron: minute hour dom month dow
    const parts = normalized.split(/\s+/);
    if (parts.length !== 5) {
      // Fallback: 24h from now
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }

    const [minuteStr, hourStr, domStr, , dowStr] = parts;

    const minute = minuteStr === '*' ? 0 : parseInt(minuteStr, 10);
    const hour = hourStr === '*' ? 0 : parseInt(hourStr, 10);

    // Specific day of week (e.g., "0 8 * * 1" = every Monday at 08:00)
    if (dowStr !== '*' && domStr === '*') {
      const targetDow = parseInt(dowStr, 10) % 7;
      let daysAhead = (targetDow - next.getUTCDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // Always next occurrence
      next.setUTCDate(next.getUTCDate() + daysAhead);
      next.setUTCHours(isNaN(hour) ? 0 : hour, isNaN(minute) ? 0 : minute, 0, 0);
      return next;
    }

    // Specific day of month (e.g., "0 8 15 * *" = every 15th at 08:00)
    if (domStr !== '*') {
      const dom = parseInt(domStr, 10);
      next.setUTCDate(dom);
      next.setUTCHours(isNaN(hour) ? 0 : hour, isNaN(minute) ? 0 : minute, 0, 0);
      if (next <= base) {
        next.setUTCMonth(next.getUTCMonth() + 1);
      }
      return next;
    }

    // Default: next day at specified hour:minute
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(isNaN(hour) ? 0 : hour, isNaN(minute) ? 0 : minute, 0, 0);
    return next;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async assertOwnership(companyId: string, id: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id, companyId },
    });
    if (!schedule) {
      throw new BusinessException('Report schedule not found', HttpStatus.NOT_FOUND);
    }
    return schedule;
  }
}
