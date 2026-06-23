import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { AlertService } from './alert.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

// Mirror the Prisma enum locally to avoid generated-client import issues in tests
const AlertRuleOperator = {
  GT: 'GT',
  GTE: 'GTE',
  LT: 'LT',
  LTE: 'LTE',
  ANOMALY: 'ANOMALY',
} as const;
type AlertRuleOperator = (typeof AlertRuleOperator)[keyof typeof AlertRuleOperator];

const COMPANY = 'company-1';
const RULE_ID = 'rule-1';
const TRIGGER_ID = 'trigger-1';
const USER_ID = 'user-1';

const mockRule = {
  id: RULE_ID,
  companyId: COMPANY,
  name: 'Revenue GT 50k',
  metric: 'revenue',
  dataSource: 'sales',
  operator: AlertRuleOperator.GT,
  threshold: '50000',
  windowDays: 30,
  isActive: true,
  notifyRoles: ['DIRECTOR'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockTrigger = {
  id: TRIGGER_ID,
  alertRuleId: RULE_ID,
  companyId: COMPANY,
  value: '60000',
  threshold: '50000',
  message: 'Alert: sales.revenue = 60000.00 GT 50000',
  acknowledged: false,
  acknowledgedAt: null,
  acknowledgedBy: null,
  createdAt: new Date(),
};

const mockPrisma = {
  alertRule: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  alertTrigger: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('AlertService', () => {
  let service: AlertService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlertService>(AlertService);
    jest.clearAllMocks();
  });

  // ─── createRule ────────────────────────────────────────────────────────────

  describe('createRule()', () => {
    it('creates a rule with correct data', async () => {
      mockPrisma.alertRule.create.mockResolvedValue(mockRule);

      const result = await service.createRule(COMPANY, {
        name: 'Revenue GT 50k',
        metric: 'revenue',
        dataSource: 'sales',
        operator: AlertRuleOperator.GT,
        threshold: 50000,
        windowDays: 30,
        notifyRoles: ['DIRECTOR'],
      });

      expect(mockPrisma.alertRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: COMPANY,
            name: 'Revenue GT 50k',
            metric: 'revenue',
            dataSource: 'sales',
            operator: AlertRuleOperator.GT,
          }),
        }),
      );
      expect(result.id).toBe(RULE_ID);
    });

    it('sets default windowDays when not provided', async () => {
      mockPrisma.alertRule.create.mockResolvedValue(mockRule);

      await service.createRule(COMPANY, {
        name: 'Test',
        metric: 'revenue',
        dataSource: 'sales',
        operator: AlertRuleOperator.GT,
      });

      const call = mockPrisma.alertRule.create.mock.calls[0][0];
      expect(call.data.windowDays).toBe(30);
    });

    it('sets empty notifyRoles array when not provided', async () => {
      mockPrisma.alertRule.create.mockResolvedValue(mockRule);

      await service.createRule(COMPANY, {
        name: 'Test',
        metric: 'revenue',
        dataSource: 'sales',
        operator: AlertRuleOperator.GT,
      });

      const call = mockPrisma.alertRule.create.mock.calls[0][0];
      expect(call.data.notifyRoles).toEqual([]);
    });
  });

  // ─── findRules ─────────────────────────────────────────────────────────────

  describe('findRules()', () => {
    it('returns rules for the company', async () => {
      mockPrisma.alertRule.findMany.mockResolvedValue([mockRule]);
      const result = await service.findRules(COMPANY);
      expect(mockPrisma.alertRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ─── updateRule ────────────────────────────────────────────────────────────

  describe('updateRule()', () => {
    it('updates only provided fields', async () => {
      mockPrisma.alertRule.findFirst.mockResolvedValue(mockRule);
      mockPrisma.alertRule.update.mockResolvedValue({ ...mockRule, name: 'Updated' });

      const result = await service.updateRule(COMPANY, RULE_ID, { name: 'Updated' });

      expect(mockPrisma.alertRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RULE_ID },
          data: { name: 'Updated' },
        }),
      );
      expect(result.name).toBe('Updated');
    });

    it('throws NOT_FOUND when rule does not exist', async () => {
      mockPrisma.alertRule.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRule(COMPANY, 'nonexistent', { name: 'X' }),
      ).rejects.toThrow(BusinessException);
    });

    it('does not allow cross-tenant updates', async () => {
      mockPrisma.alertRule.findFirst.mockResolvedValue(null); // company mismatch
      await expect(
        service.updateRule('other-company', RULE_ID, { name: 'X' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ─── deleteRule ────────────────────────────────────────────────────────────

  describe('deleteRule()', () => {
    it('deletes an existing rule', async () => {
      mockPrisma.alertRule.findFirst.mockResolvedValue(mockRule);
      mockPrisma.alertRule.delete.mockResolvedValue(mockRule);

      const result = await service.deleteRule(COMPANY, RULE_ID);
      expect(mockPrisma.alertRule.delete).toHaveBeenCalledWith({ where: { id: RULE_ID } });
      expect(result).toEqual({ deleted: true });
    });

    it('throws NOT_FOUND for nonexistent rule', async () => {
      mockPrisma.alertRule.findFirst.mockResolvedValue(null);
      await expect(service.deleteRule(COMPANY, 'ghost')).rejects.toThrow(BusinessException);
    });
  });

  // ─── findTriggers ──────────────────────────────────────────────────────────

  describe('findTriggers()', () => {
    it('returns triggers for company', async () => {
      mockPrisma.alertTrigger.findMany.mockResolvedValue([mockTrigger]);
      const result = await service.findTriggers(COMPANY);
      expect(result).toHaveLength(1);
      expect(mockPrisma.alertTrigger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: COMPANY } }),
      );
    });

    it('filters by ruleId when provided', async () => {
      mockPrisma.alertTrigger.findMany.mockResolvedValue([mockTrigger]);
      await service.findTriggers(COMPANY, RULE_ID);
      const call = mockPrisma.alertTrigger.findMany.mock.calls[0][0];
      expect(call.where.alertRuleId).toBe(RULE_ID);
    });

    it('filters by acknowledged when provided', async () => {
      mockPrisma.alertTrigger.findMany.mockResolvedValue([]);
      await service.findTriggers(COMPANY, undefined, false);
      const call = mockPrisma.alertTrigger.findMany.mock.calls[0][0];
      expect(call.where.acknowledged).toBe(false);
    });

    it('does not include acknowledged filter when undefined', async () => {
      mockPrisma.alertTrigger.findMany.mockResolvedValue([]);
      await service.findTriggers(COMPANY);
      const call = mockPrisma.alertTrigger.findMany.mock.calls[0][0];
      expect(call.where.acknowledged).toBeUndefined();
    });
  });

  // ─── acknowledgeTrigger ────────────────────────────────────────────────────

  describe('acknowledgeTrigger()', () => {
    it('marks trigger as acknowledged', async () => {
      mockPrisma.alertTrigger.findUnique.mockResolvedValue(mockTrigger);
      mockPrisma.alertTrigger.update.mockResolvedValue({
        ...mockTrigger,
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: USER_ID,
      });

      const result = await service.acknowledgeTrigger(TRIGGER_ID, USER_ID);

      expect(mockPrisma.alertTrigger.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TRIGGER_ID },
          data: expect.objectContaining({
            acknowledged: true,
            acknowledgedBy: USER_ID,
          }),
        }),
      );
      expect(result.acknowledged).toBe(true);
    });

    it('throws NOT_FOUND for nonexistent trigger', async () => {
      mockPrisma.alertTrigger.findUnique.mockResolvedValue(null);
      await expect(
        service.acknowledgeTrigger('ghost', USER_ID),
      ).rejects.toThrow(BusinessException);
    });

    it('throws CONFLICT when already acknowledged', async () => {
      mockPrisma.alertTrigger.findUnique.mockResolvedValue({
        ...mockTrigger,
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: USER_ID,
      });

      await expect(
        service.acknowledgeTrigger(TRIGGER_ID, USER_ID),
      ).rejects.toThrow(BusinessException);

      const error = await service
        .acknowledgeTrigger(TRIGGER_ID, USER_ID)
        .catch((e) => e);
      expect(error.status).toBe(HttpStatus.CONFLICT);
    });
  });
});
