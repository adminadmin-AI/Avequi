import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const COMPANY = 'company-1';
const USER_A = 'user-a';
const USER_B = 'user-b';
const DASH_ID = 'dash-1';
const WIDGET_ID = 'widget-1';

const mockWidget = {
  id: WIDGET_ID,
  dashboardId: DASH_ID,
  type: 'KPI_CARD',
  title: 'Receita',
  config: { dataSource: 'sales', metric: 'revenue' },
  position: { x: 0, y: 0, w: 4, h: 2 },
  refreshInterval: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDashboard = {
  id: DASH_ID,
  companyId: COMPANY,
  userId: USER_A,
  name: 'Meu Dashboard',
  description: 'Visão geral',
  layout: null,
  isDefault: false,
  isShared: false,
  widgets: [mockWidget],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  dashboard: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  dashboardWidget: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a dashboard with correct fields', async () => {
      mockPrisma.dashboard.create.mockResolvedValue(mockDashboard);

      const result = await service.create(COMPANY, USER_A, { name: 'Meu Dashboard', description: 'Visão geral' });

      expect(mockPrisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: COMPANY, userId: USER_A, name: 'Meu Dashboard' }),
        }),
      );
      expect(result).toEqual(mockDashboard);
    });

    it('defaults isShared to false', async () => {
      mockPrisma.dashboard.create.mockResolvedValue({ ...mockDashboard, isShared: false });

      await service.create(COMPANY, USER_A, { name: 'Test' });

      const callArg = mockPrisma.dashboard.create.mock.calls[0][0];
      expect(callArg.data.isShared).toBe(false);
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns own + shared dashboards', async () => {
      const sharedDash = { ...mockDashboard, id: 'dash-2', userId: USER_B, isShared: true };
      mockPrisma.dashboard.findMany.mockResolvedValue([mockDashboard, sharedDash]);

      const result = await service.findAll(COMPANY, USER_A);

      expect(mockPrisma.dashboard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: COMPANY, OR: [{ userId: USER_A }, { isShared: true }] },
        }),
      );
      expect(result).toHaveLength(2);
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns dashboard when found', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      const result = await service.findOne(COMPANY, DASH_ID, USER_A);
      expect(result).toEqual(mockDashboard);
    });

    it('throws NOT_FOUND when dashboard does not exist', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'nonexistent', USER_A)).rejects.toThrow(
        new BusinessException('Dashboard not found', HttpStatus.NOT_FOUND),
      );
    });

    it('throws FORBIDDEN when user is not owner and dashboard is not shared', async () => {
      const privateDash = { ...mockDashboard, userId: USER_B, isShared: false };
      mockPrisma.dashboard.findFirst.mockResolvedValue(privateDash);

      await expect(service.findOne(COMPANY, DASH_ID, USER_A)).rejects.toThrow(
        new BusinessException('Access denied to this dashboard', HttpStatus.FORBIDDEN),
      );
    });

    it('allows access to shared dashboard by other user', async () => {
      const sharedDash = { ...mockDashboard, userId: USER_B, isShared: true };
      mockPrisma.dashboard.findFirst.mockResolvedValue(sharedDash);

      const result = await service.findOne(COMPANY, DASH_ID, USER_A);
      expect(result).toEqual(sharedDash);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates dashboard when user is owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboard.update.mockResolvedValue({ ...mockDashboard, name: 'Updated' });

      const result = await service.update(COMPANY, USER_A, DASH_ID, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws FORBIDDEN when non-owner tries to update', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(service.update(COMPANY, USER_B, DASH_ID, { name: 'Hack' })).rejects.toThrow(
        new BusinessException('Only the owner can update this dashboard', HttpStatus.FORBIDDEN),
      );
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes dashboard when user is owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboard.delete.mockResolvedValue(mockDashboard);

      const result = await service.delete(COMPANY, USER_A, DASH_ID);
      expect(result).toEqual({ deleted: true });
      expect(mockPrisma.dashboard.delete).toHaveBeenCalledWith({ where: { id: DASH_ID } });
    });

    it('throws FORBIDDEN when non-owner tries to delete', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(service.delete(COMPANY, USER_B, DASH_ID)).rejects.toThrow(
        new BusinessException('Only the owner can delete this dashboard', HttpStatus.FORBIDDEN),
      );
    });
  });

  // ─── setDefault ────────────────────────────────────────────────────────────

  describe('setDefault', () => {
    it('unsets previous default and sets new one', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboard.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.dashboard.update.mockResolvedValue({ ...mockDashboard, isDefault: true });

      const result = await service.setDefault(COMPANY, USER_A, DASH_ID);

      expect(mockPrisma.dashboard.updateMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY, userId: USER_A, isDefault: true },
        data: { isDefault: false },
      });
      expect(mockPrisma.dashboard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDefault: true } }),
      );
      expect(result.isDefault).toBe(true);
    });

    it('throws FORBIDDEN when non-owner tries to set default', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(service.setDefault(COMPANY, USER_B, DASH_ID)).rejects.toThrow(
        new BusinessException('Only the owner can set default dashboard', HttpStatus.FORBIDDEN),
      );
    });
  });

  // ─── share ─────────────────────────────────────────────────────────────────

  describe('share', () => {
    it('toggles isShared from false to true', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue({ ...mockDashboard, isShared: false });
      mockPrisma.dashboard.update.mockResolvedValue({ ...mockDashboard, isShared: true });

      const result = await service.share(COMPANY, USER_A, DASH_ID);

      expect(mockPrisma.dashboard.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isShared: true } }),
      );
      expect(result.isShared).toBe(true);
    });

    it('toggles isShared from true to false', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue({ ...mockDashboard, isShared: true });
      mockPrisma.dashboard.update.mockResolvedValue({ ...mockDashboard, isShared: false });

      const result = await service.share(COMPANY, USER_A, DASH_ID);
      expect(result.isShared).toBe(false);
    });

    it('throws FORBIDDEN when non-owner tries to share', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(service.share(COMPANY, USER_B, DASH_ID)).rejects.toThrow(
        new BusinessException('Only the owner can share this dashboard', HttpStatus.FORBIDDEN),
      );
    });
  });

  // ─── duplicate ─────────────────────────────────────────────────────────────

  describe('duplicate', () => {
    it('creates a copy with name suffixed "(cópia)"', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      const copyDash = {
        ...mockDashboard,
        id: 'dash-copy',
        name: 'Meu Dashboard (cópia)',
        isShared: false,
        isDefault: false,
      };
      mockPrisma.dashboard.create.mockResolvedValue(copyDash);

      const result = await service.duplicate(COMPANY, USER_A, DASH_ID);

      expect(mockPrisma.dashboard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Meu Dashboard (cópia)',
            isShared: false,
            isDefault: false,
          }),
        }),
      );
      expect(result.name).toBe('Meu Dashboard (cópia)');
    });

    it('copies all widgets from source dashboard', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboard.create.mockResolvedValue({ ...mockDashboard, id: 'dash-copy' });

      await service.duplicate(COMPANY, USER_A, DASH_ID);

      const callArg = mockPrisma.dashboard.create.mock.calls[0][0];
      expect(callArg.data.widgets.create).toHaveLength(1);
      expect(callArg.data.widgets.create[0]).toMatchObject({
        type: 'KPI_CARD',
        title: 'Receita',
      });
    });
  });

  // ─── Widget CRUD ───────────────────────────────────────────────────────────

  describe('createWidget', () => {
    it('creates widget when user is owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboardWidget.create.mockResolvedValue(mockWidget);

      const result = await service.createWidget(COMPANY, USER_A, DASH_ID, {
        type: 'KPI_CARD' as any,
        title: 'Receita',
        config: { dataSource: 'sales', metric: 'revenue' },
        position: { x: 0, y: 0, w: 4, h: 2 },
      });

      expect(result).toEqual(mockWidget);
    });

    it('throws FORBIDDEN when non-owner tries to add widget', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(
        service.createWidget(COMPANY, USER_B, DASH_ID, {
          type: 'KPI_CARD' as any,
          title: 'Test',
          config: {},
          position: { x: 0, y: 0, w: 1, h: 1 },
        }),
      ).rejects.toThrow(
        new BusinessException('Only the owner can add widgets to this dashboard', HttpStatus.FORBIDDEN),
      );
    });
  });

  describe('findWidgets', () => {
    it('returns widgets for accessible dashboard', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboardWidget.findMany.mockResolvedValue([mockWidget]);

      const result = await service.findWidgets(COMPANY, USER_A, DASH_ID);
      expect(result).toEqual([mockWidget]);
    });
  });

  describe('updateWidget', () => {
    it('updates widget when user is owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboardWidget.findFirst.mockResolvedValue(mockWidget);
      mockPrisma.dashboardWidget.update.mockResolvedValue({ ...mockWidget, title: 'Nova Receita' });

      const result = await service.updateWidget(COMPANY, USER_A, DASH_ID, WIDGET_ID, { title: 'Nova Receita' });
      expect(result.title).toBe('Nova Receita');
    });

    it('throws NOT_FOUND when widget does not belong to dashboard', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboardWidget.findFirst.mockResolvedValue(null);

      await expect(
        service.updateWidget(COMPANY, USER_A, DASH_ID, 'nonexistent', { title: 'Test' }),
      ).rejects.toThrow(new BusinessException('Widget not found', HttpStatus.NOT_FOUND));
    });
  });

  describe('deleteWidget', () => {
    it('deletes widget when user is owner', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);
      mockPrisma.dashboardWidget.findFirst.mockResolvedValue(mockWidget);
      mockPrisma.dashboardWidget.delete.mockResolvedValue(mockWidget);

      const result = await service.deleteWidget(COMPANY, USER_A, DASH_ID, WIDGET_ID);
      expect(result).toEqual({ deleted: true });
    });

    it('throws FORBIDDEN when non-owner tries to delete widget', async () => {
      mockPrisma.dashboard.findFirst.mockResolvedValue(mockDashboard);

      await expect(service.deleteWidget(COMPANY, USER_B, DASH_ID, WIDGET_ID)).rejects.toThrow(
        new BusinessException('Only the owner can delete widgets', HttpStatus.FORBIDDEN),
      );
    });
  });
});
