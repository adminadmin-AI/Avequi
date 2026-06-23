import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockCount = jest.fn();

const mockPrisma = {
  notification: {
    findMany: mockFindMany,
    findFirst: mockFindFirst,
    update: mockUpdate,
    updateMany: mockUpdateMany,
    count: mockCount,
  },
};

const companyId = 'company-1';
const userId = 'user-1';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  // ─── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all notifications for company', async () => {
      const notifications = [
        { id: 'n-1', title: 'Alert', read: false },
        { id: 'n-2', title: 'Info', read: true },
      ];
      mockFindMany.mockResolvedValue(notifications);

      const result = await service.findAll(companyId);

      expect(result).toEqual(notifications);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId } }),
      );
    });

    it('should filter by userId when provided', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.findAll(companyId, userId);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, userId } }),
      );
    });

    it('should filter unread only when unreadOnly is true', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.findAll(companyId, undefined, true);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, read: false } }),
      );
    });

    it('should order by createdAt desc', async () => {
      mockFindMany.mockResolvedValue([]);

      await service.findAll(companyId);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ─── markAsRead ─────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notif = { id: 'n-1', companyId, read: false };
      mockFindFirst.mockResolvedValue(notif);
      mockUpdate.mockResolvedValue({ ...notif, read: true, readAt: new Date() });

      const result = await service.markAsRead(companyId, 'n-1');

      expect(result.read).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'n-1' },
          data: expect.objectContaining({ read: true }),
        }),
      );
    });

    it('should throw NOT_FOUND when notification does not exist', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(service.markAsRead(companyId, 'nonexistent')).rejects.toThrow(
        BusinessException,
      );
    });

    it('should throw NOT_FOUND for notification belonging to different company', async () => {
      mockFindFirst.mockResolvedValue(null); // company isolation

      await expect(service.markAsRead('other-company', 'n-1')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // ─── markAllAsRead ──────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      mockUpdateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllAsRead(companyId);

      expect(result.count).toBe(5);
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, read: false },
          data: expect.objectContaining({ read: true }),
        }),
      );
    });

    it('should filter by userId when provided', async () => {
      mockUpdateMany.mockResolvedValue({ count: 2 });

      await service.markAllAsRead(companyId, userId);

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId, userId, read: false },
        }),
      );
    });
  });

  // ─── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('should return unread count for company', async () => {
      mockCount.mockResolvedValue(7);

      const count = await service.getUnreadCount(companyId);

      expect(count).toBe(7);
      expect(mockCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, read: false } }),
      );
    });

    it('should filter by userId when provided', async () => {
      mockCount.mockResolvedValue(3);

      const count = await service.getUnreadCount(companyId, userId);

      expect(count).toBe(3);
      expect(mockCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId, userId, read: false } }),
      );
    });

    it('should return 0 when no unread notifications', async () => {
      mockCount.mockResolvedValue(0);

      const count = await service.getUnreadCount(companyId);

      expect(count).toBe(0);
    });
  });
});
