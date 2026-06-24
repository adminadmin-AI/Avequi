import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Resolve required approval levels for a document ─────────────────────

  async getRequiredLevels(companyId: string, entityType: string, amount: number) {
    const matrices = await this.prisma.approvalMatrix.findMany({
      where: { companyId, entityType },
      orderBy: { level: 'asc' },
    });

    // Filter matrices where amount matches condition
    return matrices.filter((m) => {
      if (!m.conditionField || !m.conditionOp || !m.conditionValue) return true;
      if (m.conditionField === 'amount') {
        const threshold = parseFloat(m.conditionValue);
        switch (m.conditionOp) {
          case 'gte': return amount >= threshold;
          case 'gt': return amount > threshold;
          case 'lte': return amount <= threshold;
          case 'lt': return amount < threshold;
          default: return true;
        }
      }
      return true;
    });
  }

  // ─── Approve a document (PO, PR, EXPENSE) ───────────────────────────────

  async approve(
    documentId: string,
    documentType: string,
    companyId: string,
    userId: string,
    userRole: string,
  ) {
    // Get required approval levels
    let amount = 0;
    if (documentType === 'PO') {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: documentId, companyId },
        include: { items: true },
      });
      if (!po) throw new NotFoundException(`PO ${documentId} não encontrada`);
      if (po.status !== 'DRAFT') {
        throw new BadRequestException(`PO não está em DRAFT (status: ${po.status})`);
      }
      amount = po.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitCost), 0);
    }

    const requiredLevels = await this.getRequiredLevels(companyId, documentType, amount);

    if (requiredLevels.length === 0) {
      // No matrix configured — fallback to simple MANAGER+ approval
      if (!['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'].includes(userRole)) {
        throw new ForbiddenException('Apenas Gerentes+ podem aprovar sem matriz configurada');
      }
      return this.executeApproval(documentId, documentType, companyId, userId, 1);
    }

    // Find current approval state (how many levels already approved)
    const existingApprovals = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        entity: documentType,
        action: 'LEVEL_APPROVE',
        payload: { path: ['documentId'], equals: documentId },
      },
      orderBy: { createdAt: 'desc' },
    });

    const approvedLevels = existingApprovals.map(
      (a) => (a.payload as any)?.level ?? 0,
    );
    const nextLevel = requiredLevels.find(
      (l) => !approvedLevels.includes(l.level),
    );

    if (!nextLevel) {
      throw new BadRequestException('Todas as aprovações já foram concedidas');
    }

    // Check if user has the required role for this level
    if (!nextLevel.approverRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Nível ${nextLevel.level} requer perfil: ${nextLevel.approverRoles.join(', ')}. Seu perfil: ${userRole}`,
      );
    }

    // Record approval
    await this.prisma.auditLog.create({
      data: {
        userId,
        companyId,
        entity: documentType,
        action: 'LEVEL_APPROVE',
        payload: { documentId, level: nextLevel.level, role: userRole },
      },
    });

    // Check if all levels are now approved
    const allApproved = requiredLevels.every(
      (l) => l.level === nextLevel.level || approvedLevels.includes(l.level),
    );

    if (allApproved) {
      return this.executeApproval(documentId, documentType, companyId, userId, nextLevel.level);
    }

    const remaining = requiredLevels.filter(
      (l) => l.level !== nextLevel.level && !approvedLevels.includes(l.level),
    );

    return {
      documentId,
      documentType,
      approvedLevel: nextLevel.level,
      status: 'PENDING_NEXT_LEVEL',
      remainingLevels: remaining.map((l) => ({
        level: l.level,
        requiredRoles: l.approverRoles,
      })),
    };
  }

  private async executeApproval(
    documentId: string,
    documentType: string,
    companyId: string,
    userId: string,
    finalLevel: number,
  ) {
    if (documentType === 'PO') {
      await this.prisma.purchaseOrder.update({
        where: { id: documentId },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
    }

    this.logger.log(`${documentType} ${documentId} aprovado (nível ${finalLevel}) por ${userId}`);

    return {
      documentId,
      documentType,
      approvedLevel: finalLevel,
      status: 'APPROVED',
      remainingLevels: [],
    };
  }

  // ─── Pending approvals for a user ───────────────────────────────────────

  async getPending(companyId: string, userRole: string) {
    // Find all draft POs that need approval
    const draftPOs = await this.prisma.purchaseOrder.findMany({
      where: { companyId, status: 'DRAFT' },
      include: {
        items: true,
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    const matrices = await this.prisma.approvalMatrix.findMany({
      where: { companyId, entityType: 'PO' },
      orderBy: { level: 'asc' },
    });

    const pending = draftPOs
      .map((po) => {
        const amount = po.items.reduce(
          (sum, i) => sum + Number(i.quantity) * Number(i.unitCost),
          0,
        );
        const applicable = matrices.filter((m) => {
          if (!m.conditionField || m.conditionField !== 'amount') return true;
          const threshold = parseFloat(m.conditionValue ?? '0');
          if (m.conditionOp === 'gte') return amount >= threshold;
          if (m.conditionOp === 'lte') return amount <= threshold;
          return true;
        });
        const canApprove = applicable.some((m) =>
          m.approverRoles.includes(userRole),
        );
        if (!canApprove && matrices.length > 0) return null;
        return { ...po, totalAmount: amount };
      })
      .filter(Boolean);

    return pending;
  }
}
