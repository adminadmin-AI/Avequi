import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InspectionStatus, InspectionType, NcrStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CreateNcrDto } from './dto/create-ncr.dto';
import { UpdateNcrDto } from './dto/update-ncr.dto';

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Inspections ─────────────────────────────────────────────────────────────

  async createInspection(
    companyId: string,
    dto: CreateInspectionDto,
    userId?: string,
  ) {
    const inspection = await this.prisma.inspection.create({
      data: {
        companyId,
        type: dto.type,
        goodsReceiptId: dto.goodsReceiptId,
        productionOrderId: dto.productionOrderId,
        notes: dto.notes,
        inspectedById: userId,
        status: InspectionStatus.PENDING,
      },
    });
    this.logger.log(
      `[INSPECTION] Created ${inspection.id} type=${dto.type} company=${companyId}`,
    );
    return inspection;
  }

  async startInspection(
    id: string,
    companyId: string,
    inspectedById?: string,
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, companyId },
    });
    if (!inspection) throw new NotFoundException(`Inspeção ${id} não encontrada`);
    if (inspection.status !== InspectionStatus.PENDING) {
      throw new BadRequestException(
        `Inspeção deve estar PENDING para iniciar. Status atual: ${inspection.status}`,
      );
    }

    return this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.IN_PROGRESS,
        startedAt: new Date(),
        ...(inspectedById ? { inspectedById } : {}),
      },
    });
  }

  async passInspection(id: string, companyId: string, notes?: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, companyId },
    });
    if (!inspection) throw new NotFoundException(`Inspeção ${id} não encontrada`);
    if (inspection.status !== InspectionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Inspeção deve estar IN_PROGRESS para aprovar. Status atual: ${inspection.status}`,
      );
    }

    return this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.PASSED,
        finishedAt: new Date(),
        ...(notes ? { notes } : {}),
      },
    });
  }

  async failInspection(
    id: string,
    companyId: string,
    ncrDto: CreateNcrDto,
    userId?: string,
  ) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, companyId },
    });
    if (!inspection) throw new NotFoundException(`Inspeção ${id} não encontrada`);
    if (inspection.status !== InspectionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Inspeção deve estar IN_PROGRESS para reprovar. Status atual: ${inspection.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: {
          status: InspectionStatus.FAILED,
          finishedAt: new Date(),
        },
      });

      const ncr = await tx.nonConformance.create({
        data: {
          companyId,
          inspectionId: id,
          productId: ncrDto.productId,
          supplierId: ncrDto.supplierId,
          title: ncrDto.title,
          description: ncrDto.description,
          severity: ncrDto.severity,
          rootCause: ncrDto.rootCause,
          correctiveAction: ncrDto.correctiveAction,
          responsibleId: ncrDto.responsibleId,
          dueDate: ncrDto.dueDate ? new Date(ncrDto.dueDate) : undefined,
          createdById: userId,
        },
      });

      this.logger.warn(
        `[INSPECTION] FAILED ${id} → auto-NCR ${ncr.id} created`,
      );

      return { inspection: updated, ncr };
    });
  }

  async holdInspection(id: string, companyId: string, notes?: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, companyId },
    });
    if (!inspection) throw new NotFoundException(`Inspeção ${id} não encontrada`);

    return this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.ON_HOLD,
        ...(notes ? { notes } : {}),
      },
    });
  }

  async listInspections(
    companyId: string,
    opts: {
      status?: InspectionStatus;
      type?: InspectionType;
      goodsReceiptId?: string;
      productionOrderId?: string;
    } = {},
  ) {
    return this.prisma.inspection.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.type ? { type: opts.type } : {}),
        ...(opts.goodsReceiptId ? { goodsReceiptId: opts.goodsReceiptId } : {}),
        ...(opts.productionOrderId
          ? { productionOrderId: opts.productionOrderId }
          : {}),
      },
      include: {
        inspectedBy: { select: { id: true, name: true } },
        _count: { select: { nonConformances: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInspection(id: string, companyId: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, companyId },
      include: {
        inspectedBy: { select: { id: true, name: true } },
        goodsReceipt: { select: { id: true } },
        productionOrder: { select: { id: true } },
        nonConformances: {
          include: {
            responsible: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!inspection) throw new NotFoundException(`Inspeção ${id} não encontrada`);
    return inspection;
  }

  // ─── NCRs ─────────────────────────────────────────────────────────────────────

  async createNcr(companyId: string, dto: CreateNcrDto, userId?: string) {
    return this.prisma.nonConformance.create({
      data: {
        companyId,
        inspectionId: dto.inspectionId,
        productId: dto.productId,
        supplierId: dto.supplierId,
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        rootCause: dto.rootCause,
        correctiveAction: dto.correctiveAction,
        responsibleId: dto.responsibleId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        createdById: userId,
      },
    });
  }

  async updateNcr(id: string, companyId: string, dto: UpdateNcrDto) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);

    return this.prisma.nonConformance.update({
      where: { id },
      data: {
        rootCause: dto.rootCause,
        correctiveAction: dto.correctiveAction,
        responsibleId: dto.responsibleId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async analyzeNcr(id: string, companyId: string) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);
    if (ncr.status !== NcrStatus.OPEN) {
      throw new BadRequestException(
        `NCR deve estar OPEN para análise. Status atual: ${ncr.status}`,
      );
    }

    return this.prisma.nonConformance.update({
      where: { id },
      data: { status: NcrStatus.UNDER_ANALYSIS },
    });
  }

  async correctiveActionNcr(id: string, companyId: string) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);
    if (ncr.status !== NcrStatus.UNDER_ANALYSIS) {
      throw new BadRequestException(
        `NCR deve estar UNDER_ANALYSIS para ação corretiva. Status atual: ${ncr.status}`,
      );
    }

    return this.prisma.nonConformance.update({
      where: { id },
      data: { status: NcrStatus.CORRECTIVE_ACTION },
    });
  }

  async closeNcr(id: string, companyId: string, userId?: string) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);
    if (ncr.status === NcrStatus.CLOSED || ncr.status === NcrStatus.CANCELLED) {
      throw new BadRequestException(
        `NCR já está encerrada. Status atual: ${ncr.status}`,
      );
    }

    return this.prisma.nonConformance.update({
      where: { id },
      data: {
        status: NcrStatus.CLOSED,
        closedAt: new Date(),
        closedById: userId,
      },
    });
  }

  async cancelNcr(id: string, companyId: string) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);
    if (ncr.status === NcrStatus.CLOSED || ncr.status === NcrStatus.CANCELLED) {
      throw new BadRequestException(
        `NCR já está encerrada. Status atual: ${ncr.status}`,
      );
    }

    return this.prisma.nonConformance.update({
      where: { id },
      data: { status: NcrStatus.CANCELLED },
    });
  }

  async listNcrs(
    companyId: string,
    opts: { status?: NcrStatus; supplierId?: string; productId?: string } = {},
  ) {
    return this.prisma.nonConformance.findMany({
      where: {
        companyId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
        ...(opts.productId ? { productId: opts.productId } : {}),
      },
      include: {
        responsible: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNcr(id: string, companyId: string) {
    const ncr = await this.prisma.nonConformance.findFirst({
      where: { id, companyId },
      include: {
        inspection: { select: { id: true, type: true, status: true } },
        product: { select: { id: true, sku: true, name: true } },
        supplier: { select: { id: true, name: true } },
        responsible: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!ncr) throw new NotFoundException(`NCR ${id} não encontrada`);
    return ncr;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getQualityStats(companyId: string) {
    const [
      totalInspections,
      pendingInspections,
      passedInspections,
      failedInspections,
      onHoldInspections,
      totalNcrs,
      openNcrs,
      underAnalysisNcrs,
      closedNcrs,
      ncrsBySupplier,
      ncrsByProduct,
    ] = await Promise.all([
      this.prisma.inspection.count({ where: { companyId } }),
      this.prisma.inspection.count({
        where: { companyId, status: InspectionStatus.PENDING },
      }),
      this.prisma.inspection.count({
        where: { companyId, status: InspectionStatus.PASSED },
      }),
      this.prisma.inspection.count({
        where: { companyId, status: InspectionStatus.FAILED },
      }),
      this.prisma.inspection.count({
        where: { companyId, status: InspectionStatus.ON_HOLD },
      }),
      this.prisma.nonConformance.count({ where: { companyId } }),
      this.prisma.nonConformance.count({
        where: { companyId, status: NcrStatus.OPEN },
      }),
      this.prisma.nonConformance.count({
        where: { companyId, status: NcrStatus.UNDER_ANALYSIS },
      }),
      this.prisma.nonConformance.count({
        where: { companyId, status: NcrStatus.CLOSED },
      }),
      this.prisma.nonConformance.groupBy({
        by: ['supplierId'],
        where: { companyId, supplierId: { not: null } },
        _count: { id: true },
      }),
      this.prisma.nonConformance.groupBy({
        by: ['productId'],
        where: { companyId, productId: { not: null } },
        _count: { id: true },
      }),
    ]);

    // Enrich supplier stats
    const supplierIds = ncrsBySupplier
      .map((r) => r.supplierId)
      .filter(Boolean) as string[];
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

    const rejectionRateBySupplier = ncrsBySupplier.map((r) => ({
      supplierId: r.supplierId!,
      supplierName: supplierMap.get(r.supplierId!) ?? 'Desconhecido',
      total: r._count.id,
      failed: r._count.id,
      rate: 1,
    }));

    // Enrich product stats
    const productIds = ncrsByProduct
      .map((r) => r.productId)
      .filter(Boolean) as string[];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const rejectionRateByProduct = ncrsByProduct.map((r) => {
      const prod = productMap.get(r.productId!);
      return {
        productId: r.productId!,
        sku: prod?.sku ?? '—',
        name: prod?.name ?? 'Desconhecido',
        total: r._count.id,
        failed: r._count.id,
        rate: 1,
      };
    });

    return {
      inspections: {
        total: totalInspections,
        pending: pendingInspections,
        passed: passedInspections,
        failed: failedInspections,
        onHold: onHoldInspections,
      },
      ncrs: {
        total: totalNcrs,
        open: openNcrs,
        underAnalysis: underAnalysisNcrs,
        closed: closedNcrs,
      },
      rejectionRateBySupplier,
      rejectionRateByProduct,
    };
  }
}
