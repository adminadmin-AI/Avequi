import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

export interface CreateTaskAssignmentDto {
  userId?: string;
  role?: string;
  entityType: string;
  entityId: string;
  action: string;
  title: string;
  description?: string;
  dueDate?: Date;
  priority?: string;
  metadata?: Record<string, any>;
}

export interface TaskFilters {
  status?: string;
  entityType?: string;
  priority?: string;
}

@Injectable()
export class TaskAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, data: CreateTaskAssignmentDto) {
    return this.prisma.taskAssignment.create({
      data: {
        companyId,
        userId: data.userId,
        role: data.role,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        priority: data.priority ?? 'NORMAL',
        metadata: data.metadata as any,
      },
    });
  }

  async findMyTasks(
    companyId: string,
    userId: string,
    role: string,
    filters?: TaskFilters,
  ) {
    const statusFilter = filters?.status
      ? { status: filters.status as any }
      : {};
    const entityTypeFilter = filters?.entityType
      ? { entityType: filters.entityType }
      : {};
    const priorityFilter = filters?.priority
      ? { priority: filters.priority }
      : {};

    return this.prisma.taskAssignment.findMany({
      where: {
        companyId,
        OR: [{ userId }, { role }],
        ...statusFilter,
        ...entityTypeFilter,
        ...priorityFilter,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findAll(companyId: string, filters?: TaskFilters) {
    const statusFilter = filters?.status
      ? { status: filters.status as any }
      : {};
    const entityTypeFilter = filters?.entityType
      ? { entityType: filters.entityType }
      : {};
    const priorityFilter = filters?.priority
      ? { priority: filters.priority }
      : {};

    return this.prisma.taskAssignment.findMany({
      where: {
        companyId,
        ...statusFilter,
        ...entityTypeFilter,
        ...priorityFilter,
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async startTask(companyId: string, taskId: string, userId: string) {
    const task = await this.prisma.taskAssignment.findFirst({
      where: { id: taskId, companyId },
    });
    if (!task) {
      throw new BusinessException('Tarefa não encontrada', HttpStatus.NOT_FOUND);
    }
    if (task.status !== 'PENDING') {
      throw new BusinessException(
        'Apenas tarefas pendentes podem ser iniciadas',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.taskAssignment.update({
      where: { id: taskId },
      data: { status: 'IN_PROGRESS', userId },
    });
  }

  async completeTask(companyId: string, taskId: string, userId: string) {
    const task = await this.prisma.taskAssignment.findFirst({
      where: { id: taskId, companyId },
    });
    if (!task) {
      throw new BusinessException('Tarefa não encontrada', HttpStatus.NOT_FOUND);
    }
    if (task.status === 'COMPLETED') {
      throw new BusinessException('Tarefa já foi concluída', HttpStatus.BAD_REQUEST);
    }
    if (task.status === 'CANCELLED') {
      throw new BusinessException(
        'Tarefa cancelada não pode ser concluída',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.taskAssignment.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: userId,
      },
    });
  }

  async cancelTask(companyId: string, taskId: string) {
    const task = await this.prisma.taskAssignment.findFirst({
      where: { id: taskId, companyId },
    });
    if (!task) {
      throw new BusinessException('Tarefa não encontrada', HttpStatus.NOT_FOUND);
    }
    if (task.status === 'COMPLETED') {
      throw new BusinessException(
        'Tarefa concluída não pode ser cancelada',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.taskAssignment.update({
      where: { id: taskId },
      data: { status: 'CANCELLED' },
    });
  }

  async getInboxSummary(companyId: string, userId: string, role: string) {
    const now = new Date();

    const tasks = await this.prisma.taskAssignment.findMany({
      where: {
        companyId,
        OR: [{ userId }, { role }],
        status: { in: ['PENDING', 'IN_PROGRESS', 'OVERDUE'] },
      },
      select: {
        entityType: true,
        priority: true,
        status: true,
        dueDate: true,
      },
    });

    const total = tasks.length;

    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let overdue = 0;

    for (const task of tasks) {
      // Count by entity type
      byType[task.entityType] = (byType[task.entityType] ?? 0) + 1;

      // Count by priority
      byPriority[task.priority] = (byPriority[task.priority] ?? 0) + 1;

      // Count overdue: either status OVERDUE or dueDate in the past
      if (
        task.status === 'OVERDUE' ||
        (task.dueDate && task.dueDate < now)
      ) {
        overdue++;
      }
    }

    return { total, byType, byPriority, overdue };
  }

  async markOverdue(): Promise<number> {
    const now = new Date();

    const result = await this.prisma.taskAssignment.updateMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        dueDate: { lt: now },
      },
      data: { status: 'OVERDUE' },
    });

    return result.count;
  }
}
