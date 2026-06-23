import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReportSchedulerService } from './report-scheduler.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExportService } from '../export/export.service';
import { BusinessException } from '../../common/filters/business-exception.filter';

const COMPANY = 'company-1';
const SCHEDULE_ID = 'sched-1';
const USER_ID = 'user-1';

const mockSchedule = {
  id: SCHEDULE_ID,
  companyId: COMPANY,
  name: 'Relatório Semanal',
  dashboardId: null,
  format: 'CSV',
  cronExpr: '0 8 * * 1',
  recipients: ['gerente@empresa.com'],
  isActive: true,
  lastRunAt: null,
  nextRunAt: new Date(Date.now() - 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRun = {
  id: 'run-1',
  scheduleId: SCHEDULE_ID,
  status: 'RUNNING',
  format: 'CSV',
  fileSize: null,
  error: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
};

const mockPrisma = {
  reportSchedule: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  reportRun: {
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockExportService = {
  exportDashboardData: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('ReportSchedulerService', () => {
  let service: ReportSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportSchedulerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExportService, useValue: mockExportService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ReportSchedulerService>(ReportSchedulerService);
    jest.clearAllMocks();

    // Don't start interval in tests
    jest.spyOn(service, 'onModuleInit').mockImplementation(() => undefined);
  });

  // ─── createSchedule ────────────────────────────────────────────────────────

  describe('createSchedule()', () => {
    it('creates a schedule with nextRunAt computed', async () => {
      mockPrisma.reportSchedule.create.mockResolvedValue(mockSchedule);

      const result = await service.createSchedule(COMPANY, {
        name: 'Relatório Semanal',
        format: 'CSV',
        cronExpr: '0 8 * * 1',
        recipients: ['gerente@empresa.com'],
      });

      expect(mockPrisma.reportSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY,
            name: 'Relatório Semanal',
            isActive: true,
            nextRunAt: expect.any(Date),
          }),
        }),
      );
      expect(result.id).toBe(SCHEDULE_ID);
    });
  });

  // ─── findSchedules ─────────────────────────────────────────────────────────

  describe('findSchedules()', () => {
    it('returns schedules for company', async () => {
      mockPrisma.reportSchedule.findMany.mockResolvedValue([mockSchedule]);

      const result = await service.findSchedules(COMPANY);
      expect(result).toHaveLength(1);
      expect(mockPrisma.reportSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY } }),
      );
    });
  });

  // ─── updateSchedule ────────────────────────────────────────────────────────

  describe('updateSchedule()', () => {
    it('updates schedule and recalculates nextRunAt when cronExpr changes', async () => {
      mockPrisma.reportSchedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.reportSchedule.update.mockResolvedValue({
        ...mockSchedule,
        cronExpr: '0 9 * * 2',
      });

      await service.updateSchedule(COMPANY, SCHEDULE_ID, { cronExpr: '0 9 * * 2' });

      expect(mockPrisma.reportSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nextRunAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NOT_FOUND for nonexistent schedule', async () => {
      mockPrisma.reportSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSchedule(COMPANY, 'ghost', { name: 'X' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── deleteSchedule ────────────────────────────────────────────────────────

  describe('deleteSchedule()', () => {
    it('deletes an existing schedule', async () => {
      mockPrisma.reportSchedule.findFirst.mockResolvedValue(mockSchedule);
      mockPrisma.reportSchedule.delete.mockResolvedValue(mockSchedule);

      const result = await service.deleteSchedule(COMPANY, SCHEDULE_ID);
      expect(result).toEqual({ deleted: true });
    });

    it('throws NOT_FOUND for nonexistent schedule', async () => {
      mockPrisma.reportSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSchedule(COMPANY, 'ghost'),
      ).rejects.toThrow(BusinessException);
    });

    it('enforces tenant isolation', async () => {
      mockPrisma.reportSchedule.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSchedule('other-company', SCHEDULE_ID),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── runSchedule ───────────────────────────────────────────────────────────

  describe('runSchedule()', () => {
    it('creates run, marks COMPLETED and emits event', async () => {
      mockPrisma.reportSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockPrisma.reportRun.create.mockResolvedValue(mockRun);
      mockPrisma.reportRun.update.mockResolvedValue({
        ...mockRun,
        status: 'COMPLETED',
        fileSize: 100,
        completedAt: new Date(),
      });
      mockPrisma.reportSchedule.update.mockResolvedValue(mockSchedule);

      const result = await service.runSchedule(SCHEDULE_ID, USER_ID);

      expect(mockPrisma.reportRun.create).toHaveBeenCalled();
      expect(mockPrisma.reportRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'report.generated',
        expect.objectContaining({ scheduleId: SCHEDULE_ID }),
      );
      expect(result.status).toBe('COMPLETED');
    });

    it('throws NOT_FOUND for nonexistent schedule', async () => {
      mockPrisma.reportSchedule.findUnique.mockResolvedValue(null);

      await expect(service.runSchedule('ghost')).rejects.toThrow(BusinessException);

      const err = await service.runSchedule('ghost').catch((e) => e);
      expect(err.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('marks run as FAILED on export error', async () => {
      const schedWithDashboard = { ...mockSchedule, dashboardId: 'dash-1' };
      mockPrisma.reportSchedule.findUnique.mockResolvedValue(schedWithDashboard);
      mockPrisma.reportRun.create.mockResolvedValue(mockRun);
      mockExportService.exportDashboardData.mockRejectedValue(new Error('Export failed'));
      mockPrisma.reportRun.update.mockResolvedValue({ ...mockRun, status: 'FAILED', error: 'Export failed' });

      const result = await service.runSchedule(SCHEDULE_ID, USER_ID);
      expect(result.status).toBe('FAILED');
    });

    it('updates lastRunAt and nextRunAt on successful run', async () => {
      mockPrisma.reportSchedule.findUnique.mockResolvedValue(mockSchedule);
      mockPrisma.reportRun.create.mockResolvedValue(mockRun);
      mockPrisma.reportRun.update.mockResolvedValue({ ...mockRun, status: 'COMPLETED' });
      mockPrisma.reportSchedule.update.mockResolvedValue(mockSchedule);

      await service.runSchedule(SCHEDULE_ID, USER_ID);

      expect(mockPrisma.reportSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastRunAt: expect.any(Date),
            nextRunAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  // ─── getNextRunDate ────────────────────────────────────────────────────────

  describe('getNextRunDate()', () => {
    const base = new Date('2026-06-22T10:00:00Z'); // Monday

    it('@daily returns next midnight UTC', () => {
      const next = service.getNextRunDate('@daily', base);
      expect(next.getUTCHours()).toBe(0);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next > base).toBe(true);
    });

    it('0 0 * * * returns next midnight UTC', () => {
      const next = service.getNextRunDate('0 0 * * *', base);
      expect(next > base).toBe(true);
      expect(next.getUTCHours()).toBe(0);
    });

    it('@hourly returns next whole hour', () => {
      const next = service.getNextRunDate('@hourly', base);
      expect(next.getUTCMinutes()).toBe(0);
      expect(next > base).toBe(true);
    });

    it('@weekly returns next Sunday midnight', () => {
      const next = service.getNextRunDate('@weekly', base);
      expect(next.getUTCDay()).toBe(0); // Sunday
      expect(next > base).toBe(true);
    });

    it('@monthly returns 1st of next month', () => {
      const next = service.getNextRunDate('@monthly', base);
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCMonth()).toBeGreaterThan(base.getUTCMonth());
    });

    it('weekly cron 0 8 * * 1 returns next Monday at 08:00', () => {
      // base is already Monday — should return next Monday
      const next = service.getNextRunDate('0 8 * * 1', base);
      expect(next.getUTCDay()).toBe(1); // Monday
      expect(next.getUTCHours()).toBe(8);
      expect(next > base).toBe(true);
    });

    it('monthly cron 0 8 15 * * returns 15th of month at 08:00', () => {
      const next = service.getNextRunDate('0 8 15 * *', base);
      expect(next.getUTCDate()).toBe(15);
      expect(next.getUTCHours()).toBe(8);
    });

    it('falls back to 24h for unrecognized patterns', () => {
      const next = service.getNextRunDate('invalid cron pattern', base);
      expect(next > base).toBe(true);
    });
  });

  // ─── checkDueSchedules ────────────────────────────────────────────────────

  describe('checkDueSchedules()', () => {
    it('runs all due schedules', async () => {
      const due = [
        { ...mockSchedule, id: 'sched-1' },
        { ...mockSchedule, id: 'sched-2' },
      ];
      mockPrisma.reportSchedule.findMany.mockResolvedValue(due);
      mockPrisma.reportSchedule.findUnique
        .mockResolvedValueOnce({ ...mockSchedule, id: 'sched-1' })
        .mockResolvedValueOnce({ ...mockSchedule, id: 'sched-2' });
      mockPrisma.reportRun.create.mockResolvedValue(mockRun);
      mockPrisma.reportRun.update.mockResolvedValue({ ...mockRun, status: 'COMPLETED' });
      mockPrisma.reportSchedule.update.mockResolvedValue(mockSchedule);

      await service.checkDueSchedules();

      expect(mockPrisma.reportSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('continues running other schedules when one fails', async () => {
      mockPrisma.reportSchedule.findMany.mockResolvedValue([
        { ...mockSchedule, id: 'sched-fail' },
        { ...mockSchedule, id: 'sched-ok' },
      ]);
      mockPrisma.reportSchedule.findUnique
        .mockResolvedValueOnce(null) // sched-fail throws NOT_FOUND
        .mockResolvedValueOnce({ ...mockSchedule, id: 'sched-ok' });
      mockPrisma.reportRun.create.mockResolvedValue(mockRun);
      mockPrisma.reportRun.update.mockResolvedValue({ ...mockRun, status: 'COMPLETED' });
      mockPrisma.reportSchedule.update.mockResolvedValue(mockSchedule);

      // Should not throw
      await expect(service.checkDueSchedules()).resolves.not.toThrow();
    });
  });
});
