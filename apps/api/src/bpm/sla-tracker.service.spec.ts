import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaTrackerService } from './sla-tracker.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

const COMPANY_ID = 'company-1';

const makeDef = (maxDurationHours: number) => ({
  id: 'def-1',
  companyId: COMPANY_ID,
  entityType: 'PURCHASE_ORDER',
  statusFrom: 'WAITING_APPROVAL',
  maxDurationHours,
  escalateToRole: 'DIRECTOR',
  isActive: true,
});

const makeInstance = (entityId = 'entity-1') => ({
  id: 'inst-1',
  companyId: COMPANY_ID,
  entityType: 'PURCHASE_ORDER',
  entityId,
  status: 'WAITING_APPROVAL',
  startedAt: new Date(),
  currentNodeId: 'node-1',
});

const mockPrisma = {
  slaDefinition: { findMany: jest.fn() },
  workflowInstance: { findMany: jest.fn() },
  workflowHistory: { findFirst: jest.fn() },
  slaBreach: { findFirst: jest.fn(), create: jest.fn() },
  notification: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
};

const mockNotificationService = {
  findAll: jest.fn().mockResolvedValue([]),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('SlaTrackerService', () => {
  let service: SlaTrackerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaTrackerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SlaTrackerService>(SlaTrackerService);
  });

  // ─── onModuleInit / onModuleDestroy ──────────────────────────────────────────

  describe('lifecycle hooks', () => {
    it('should start interval on init and clear on destroy', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(123 as any);
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalled();

      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });

  // ─── checkAllSlas — no instances ──────────────────────────────────────────────

  describe('checkAllSlas', () => {
    it('should do nothing when there are no active SLA definitions', async () => {
      mockPrisma.slaDefinition.findMany.mockResolvedValue([]);

      await service.checkAllSlas();

      expect(mockPrisma.workflowInstance.findMany).not.toHaveBeenCalled();
    });

    it('should do nothing when there are no matching instances', async () => {
      mockPrisma.slaDefinition.findMany.mockResolvedValue([makeDef(8)]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([]);

      await service.checkAllSlas();

      expect(mockPrisma.slaBreach.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── SLA breach ──────────────────────────────────────────────────────────────

  describe('breach detection', () => {
    it('should record a breach and create ALERT notification when elapsed >= max', async () => {
      const def = makeDef(4); // 4 hours max
      const instance = makeInstance();

      // Simulate: history shows instance entered status 5 hours ago
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      instance.startedAt = fiveHoursAgo;

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue(null); // use startedAt
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null); // no existing breach
      mockPrisma.slaBreach.create.mockResolvedValue({ id: 'breach-1' });
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await service.checkAllSlas();

      expect(mockPrisma.slaBreach.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ALERT',
            companyId: COMPANY_ID,
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'sla.breach',
        expect.objectContaining({
          definitionId: def.id,
          entityId: instance.entityId,
        }),
      );
    });

    it('should be idempotent — not create a second breach if one already exists', async () => {
      const def = makeDef(4);
      const instance = makeInstance();
      instance.startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000);

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue(null);
      // Existing breach found — should skip creation
      mockPrisma.slaBreach.findFirst.mockResolvedValue({ id: 'existing-breach' });

      await service.checkAllSlas();

      expect(mockPrisma.slaBreach.create).not.toHaveBeenCalled();
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // ─── SLA warning at 80% ──────────────────────────────────────────────────────

  describe('warning at 80%', () => {
    it('should create WARNING notification when elapsed >= 80% of max', async () => {
      const def = makeDef(10); // 10 hours max → warning at 8 hours
      const instance = makeInstance();

      // 9 hours elapsed = 90% → should trigger warning (not breach since < 100%)
      // Wait — 9h >= 10h is false, so no breach. 9h >= 8h is true → warning
      const nineHoursAgo = new Date(Date.now() - 9 * 60 * 60 * 1000);
      instance.startedAt = nineHoursAgo;

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue(null);
      // No existing breach
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null);
      // No existing warning
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif-warn' });

      await service.checkAllSlas();

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WARNING',
            companyId: COMPANY_ID,
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'sla.warning',
        expect.objectContaining({
          definitionId: def.id,
          entityId: instance.entityId,
        }),
      );
    });

    it('should NOT create warning when elapsed < 80% of max', async () => {
      const def = makeDef(10); // 10 hours max
      const instance = makeInstance();

      // 5 hours = 50% → below 80% threshold
      instance.startedAt = new Date(Date.now() - 5 * 60 * 60 * 1000);

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue(null);
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null);

      await service.checkAllSlas();

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should NOT send warning twice for same instance (idempotent)', async () => {
      const def = makeDef(10);
      const instance = makeInstance();
      instance.startedAt = new Date(Date.now() - 9 * 60 * 60 * 1000);

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue(null);
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null);
      // Already warned
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'existing-warning' });

      await service.checkAllSlas();

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // ─── WorkflowHistory timestamp preference ────────────────────────────────────

  describe('history timestamp', () => {
    it('should prefer WorkflowHistory timestamp over instance.startedAt', async () => {
      const def = makeDef(4);
      const instance = makeInstance();

      // instance.startedAt is 1 hour ago (well within SLA)
      instance.startedAt = new Date(Date.now() - 1 * 60 * 60 * 1000);

      // But history shows the status was entered 5 hours ago (breach!)
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);

      mockPrisma.slaDefinition.findMany.mockResolvedValue([def]);
      mockPrisma.workflowInstance.findMany.mockResolvedValue([instance]);
      mockPrisma.workflowHistory.findFirst.mockResolvedValue({
        id: 'hist-1',
        createdAt: fiveHoursAgo,
      });
      mockPrisma.slaBreach.findFirst.mockResolvedValue(null);
      mockPrisma.slaBreach.create.mockResolvedValue({ id: 'breach-1' });
      mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await service.checkAllSlas();

      // Should detect breach because history says 5h elapsed > 4h max
      expect(mockPrisma.slaBreach.create).toHaveBeenCalledTimes(1);
    });
  });
});
