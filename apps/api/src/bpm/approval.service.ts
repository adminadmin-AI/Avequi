import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { CreateApprovalMatrixDto } from './dto/create-approval-matrix.dto';
import { TaskAssignmentService } from './task-assignment.service';

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskAssignmentService: TaskAssignmentService,
  ) {}

  async createMatrix(companyId: string, dto: CreateApprovalMatrixDto) {
    return this.prisma.approvalMatrix.create({
      data: {
        companyId,
        entityType: dto.entityType,
        conditionField: dto.conditionField,
        conditionOp: dto.conditionOp,
        conditionValue: dto.conditionValue,
        level: dto.level,
        requiredApprovals: dto.requiredApprovals,
        approverRoles: dto.approverRoles,
      },
    });
  }

  async findMatrices(companyId: string, entityType?: string) {
    return this.prisma.approvalMatrix.findMany({
      where: {
        companyId,
        ...(entityType ? { entityType } : {}),
      },
      orderBy: [{ entityType: 'asc' }, { level: 'asc' }],
    });
  }

  async updateMatrix(
    companyId: string,
    id: string,
    data: Partial<CreateApprovalMatrixDto>,
  ) {
    const matrix = await this.prisma.approvalMatrix.findFirst({
      where: { id, companyId },
    });
    if (!matrix) {
      throw new BusinessException('Matriz de aprovação não encontrada', HttpStatus.NOT_FOUND);
    }
    return this.prisma.approvalMatrix.update({ where: { id }, data });
  }

  async deleteMatrix(companyId: string, id: string) {
    const matrix = await this.prisma.approvalMatrix.findFirst({
      where: { id, companyId },
    });
    if (!matrix) {
      throw new BusinessException('Matriz de aprovação não encontrada', HttpStatus.NOT_FOUND);
    }
    return this.prisma.approvalMatrix.delete({ where: { id } });
  }

  /**
   * Creates a TaskAssignment for each approverRole in an approval request.
   * Called by WorkflowEngine after creating ApprovalRequest rows.
   */
  async createTasksForApprovalRequests(
    companyId: string,
    instanceId: string,
    entityType: string,
    entityId: string,
    approverRoles: string[],
    level: number,
  ): Promise<void> {
    for (const role of approverRoles) {
      await this.taskAssignmentService.create(companyId, {
        role,
        entityType,
        entityId,
        action: 'APPROVE',
        title: `Aprovação nível ${level} — ${entityType}`,
        description: `Aprovação pendente para instância de workflow ${instanceId}`,
        priority: 'HIGH',
        metadata: { instanceId, level, approverRole: role },
      });
    }
  }

  async getRequiredApprovals(
    companyId: string,
    entityType: string,
    context?: Record<string, any>,
  ) {
    const matrices = await this.prisma.approvalMatrix.findMany({
      where: { companyId, entityType },
      orderBy: { level: 'asc' },
    });

    if (!context) return matrices;

    // Filter by condition if provided
    return matrices.filter((matrix) => {
      if (!matrix.conditionField || !matrix.conditionOp || !matrix.conditionValue) {
        return true;
      }
      const fieldValue = context[matrix.conditionField];
      const conditionValue = parseFloat(matrix.conditionValue);
      const val = parseFloat(String(fieldValue));
      switch (matrix.conditionOp) {
        case 'GT':  return val > conditionValue;
        case 'GTE': return val >= conditionValue;
        case 'LT':  return val < conditionValue;
        case 'LTE': return val <= conditionValue;
        case 'EQ':  return val === conditionValue;
        case 'NEQ': return val !== conditionValue;
        default:    return true;
      }
    });
  }

  async approve(
    instanceId: string,
    approverId: string,
    approverRole: string,
    comments?: string,
  ) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) {
      throw new BusinessException('Instância não encontrada', HttpStatus.NOT_FOUND);
    }
    if (instance.status !== 'WAITING_APPROVAL') {
      throw new BusinessException(
        'Instância não está aguardando aprovação',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Find the pending approval at the current level for this role
    const pendingApprovals = await this.prisma.approvalRequest.findMany({
      where: { instanceId, status: 'PENDING' },
      orderBy: { level: 'asc' },
    });

    if (pendingApprovals.length === 0) {
      throw new BusinessException('Não há aprovações pendentes', HttpStatus.BAD_REQUEST);
    }

    const currentLevel = pendingApprovals[0].level;
    const currentLevelApprovals = pendingApprovals.filter(
      (a) => a.level === currentLevel,
    );

    const matchingApproval = currentLevelApprovals.find(
      (a) => a.approverRole === approverRole && a.status === 'PENDING',
    );
    if (!matchingApproval) {
      throw new BusinessException(
        `Usuário com role ${approverRole} não tem aprovação pendente neste nível`,
        HttpStatus.FORBIDDEN,
      );
    }

    // Mark as approved
    await this.prisma.approvalRequest.update({
      where: { id: matchingApproval.id },
      data: {
        status: 'APPROVED',
        approverId,
        comments,
        respondedAt: new Date(),
      },
    });

    // Complete the corresponding task assignment for this approver role
    const taskToComplete = await this.prisma.taskAssignment.findFirst({
      where: {
        companyId: instance.companyId,
        role: approverRole,
        entityType: instance.entityType,
        entityId: instance.entityId,
        action: 'APPROVE',
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
    });
    if (taskToComplete) {
      await this.taskAssignmentService.completeTask(
        instance.companyId,
        taskToComplete.id,
        approverId,
      );
    }

    // Check if all required approvals at this level are done
    const approvedAtLevel = await this.prisma.approvalRequest.count({
      where: { instanceId, level: currentLevel, status: 'APPROVED' },
    });

    // Get the matrix for this level to know how many are required
    const matrix = await this.prisma.approvalMatrix.findFirst({
      where: {
        companyId: instance.companyId,
        entityType: instance.entityType,
        level: currentLevel,
      },
    });

    const requiredApprovals = matrix?.requiredApprovals ?? currentLevelApprovals.length;

    if (approvedAtLevel >= requiredApprovals) {
      // Check if there's a next level
      const nextLevelPending = await this.prisma.approvalRequest.findFirst({
        where: { instanceId, level: { gt: currentLevel }, status: 'PENDING' },
        orderBy: { level: 'asc' },
      });

      if (!nextLevelPending) {
        // All levels approved — advance workflow
        await this.prisma.workflowInstance.update({
          where: { id: instanceId },
          data: { status: 'RUNNING' },
        });
      }
      // If next level exists, it stays WAITING_APPROVAL for the next level
    }

    return { approved: true, level: currentLevel };
  }

  async reject(
    instanceId: string,
    approverId: string,
    approverRole: string,
    comments?: string,
  ) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
    });
    if (!instance) {
      throw new BusinessException('Instância não encontrada', HttpStatus.NOT_FOUND);
    }

    const pendingApproval = await this.prisma.approvalRequest.findFirst({
      where: { instanceId, approverRole, status: 'PENDING' },
    });
    if (!pendingApproval) {
      throw new BusinessException(
        `Usuário com role ${approverRole} não tem aprovação pendente`,
        HttpStatus.FORBIDDEN,
      );
    }

    await this.prisma.approvalRequest.update({
      where: { id: pendingApproval.id },
      data: {
        status: 'REJECTED',
        approverId,
        comments,
        respondedAt: new Date(),
      },
    });

    // Cancel the instance
    await this.prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: 'CANCELLED' },
    });

    // Add history entry
    await this.prisma.workflowHistory.create({
      data: {
        instanceId,
        fromNodeId: instance.currentNodeId ?? undefined,
        toNodeId: instance.currentNodeId ?? 'CANCELLED',
        action: 'REJECT',
        metadata: { approverId, approverRole, comments },
        performedBy: approverId,
      },
    });

    return { rejected: true };
  }
}
