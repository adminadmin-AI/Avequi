import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * SoD (#160/#350): trava de segregação de funções nas aprovações.
   * DESLIGADA por padrão (SOD_ENFORCE=false) — regra de negócio vigente da
   * empresa permite que a mesma pessoa crie e aprove. A auditoria
   * (LEVEL_APPROVE) registra sempre, independente da flag.
   */
  private get sodEnforce(): boolean {
    const value = this.config.get('SOD_ENFORCE');
    return value === true || value === 'true';
  }

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
    // #227: Validate document exists, is in approvable status, and compute amount
    let amount = 0;
    let creatorId: string | null = null;
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
      creatorId = po.createdById;
    } else if (documentType === 'PR') {
      const pr = await this.prisma.purchaseRequest.findFirst({
        where: { id: documentId, companyId },
        include: { product: true },
      });
      if (!pr) throw new NotFoundException(`PR ${documentId} não encontrada`);
      if (pr.status !== 'OPEN') {
        throw new BadRequestException(`PR não está em OPEN (status: ${pr.status})`);
      }
      amount = Number(pr.quantity) * Number(pr.product.costPrice ?? 0);
      creatorId = pr.requestedById;
    } else {
      throw new BadRequestException(`Tipo de documento não suportado: ${documentType}`);
    }

    // SoD (#160): quem criou o documento não pode aprová-lo — em NENHUM nível.
    // Aplica-se inclusive a SUPER_ADMIN (segregação de funções vale para todos os perfis).
    // Só vale com SOD_ENFORCE=true — por padrão a regra da empresa permite criar e aprovar.
    if (this.sodEnforce && creatorId && creatorId === userId) {
      throw new ForbiddenException(
        'Segregação de funções: o criador do documento não pode aprová-lo. Solicite a aprovação a outro usuário com alçada.',
      );
    }

    const requiredLevels = await this.getRequiredLevels(companyId, documentType, amount);

    if (requiredLevels.length === 0) {
      // Sem matriz de alçada configurada: aprova em nível único.
      //
      // #948-C1: aqui havia um portão por enum (SUPER_ADMIN/DIRECTOR/MANAGER),
      // redundante com a permissão `approvals.requests.approve` que a rota já
      // exige — e mais restritivo que ela. Quem chega até este ponto já passou
      // pelo PermissionGuard; barrar de novo pelo enum congelado só impedia
      // perfis v2 legítimos de aprovar.
      //
      // Isto é o portão GLOBAL. A matriz de alçada continua intacta logo
      // abaixo: quando existe, ela manda, e pode negar (ver `nextLevel`).
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

    // SoD (#160): um usuário que já aprovou um nível não pode aprovar outro nível
    // do mesmo documento — cada nível exige um aprovador distinto.
    // Só vale com SOD_ENFORCE=true — por padrão o mesmo usuário pode aprovar níveis distintos.
    if (this.sodEnforce && existingApprovals.some((a) => a.userId === userId)) {
      throw new ForbiddenException(
        'Segregação de funções: você já aprovou um nível deste documento. Cada nível de alçada exige um aprovador distinto.',
      );
    }

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
    // #227: Execute approval for each supported document type
    if (documentType === 'PO') {
      await this.prisma.purchaseOrder.update({
        where: { id: documentId },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
    } else if (documentType === 'PR') {
      await this.prisma.purchaseRequest.update({
        where: { id: documentId },
        data: { status: 'APPROVED' },
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
    // #227: Fetch pending items for all supported document types
    const [draftPOs, openPRs, allMatrices] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { companyId, status: 'DRAFT' },
        include: {
          items: true,
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.purchaseRequest.findMany({
        where: { companyId, status: 'OPEN' },
        include: {
          product: { select: { id: true, sku: true, name: true, costPrice: true } },
          requestedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.approvalMatrix.findMany({
        where: { companyId },
        orderBy: { level: 'asc' },
      }),
    ]);

    const filterByMatrix = (
      items: any[],
      entityType: string,
      getAmount: (item: any) => number,
    ) => {
      const matrices = allMatrices.filter((m) => m.entityType === entityType);
      return items
        .map((item) => {
          const amount = getAmount(item);
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
          return { ...item, documentType: entityType, totalAmount: amount };
        })
        .filter(Boolean);
    };

    const pendingPOs = filterByMatrix(draftPOs, 'PO', (po) =>
      po.items.reduce((sum: number, i: any) => sum + Number(i.quantity) * Number(i.unitCost), 0),
    );
    const pendingPRs = filterByMatrix(openPRs, 'PR', (pr) =>
      Number(pr.quantity) * Number(pr.product?.costPrice ?? 0),
    );

    return [...pendingPOs, ...pendingPRs];
  }
}
