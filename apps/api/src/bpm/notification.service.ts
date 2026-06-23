import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, userId?: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        companyId,
        ...(userId ? { userId } : {}),
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(companyId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, companyId },
    });
    if (!notification) {
      throw new BusinessException('Notificação não encontrada', HttpStatus.NOT_FOUND);
    }

    return this.prisma.notification.update({
      where: { id },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllAsRead(companyId: string, userId?: string) {
    return this.prisma.notification.updateMany({
      where: {
        companyId,
        ...(userId ? { userId } : {}),
        read: false,
      },
      data: { read: true, readAt: new Date() },
    });
  }

  async getUnreadCount(companyId: string, userId?: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        companyId,
        ...(userId ? { userId } : {}),
        read: false,
      },
    });
  }
}
