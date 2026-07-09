import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { InspectionStatus, InspectionType, NcrStatus } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CreateNcrDto } from './dto/create-ncr.dto';
import { UpdateNcrDto } from './dto/update-ncr.dto';
import { QualityService } from './quality.service';

interface AuthRequest {
  user: { companyId: string; sub: string };
}

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 * Mutações de qualidade ficam com QUALIDADE/G.INDUSTRIAL; GERENTE_GERAL
 * recebeu somente leitura (decisão Rafael no PR D).
 */
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  // ─── Inspections ───────────────────────────────────────────────────────────

  @Post('inspections')
  @RequirePermission('quality.inspections.create')
  createInspection(
    @Request() req: AuthRequest,
    @Body() dto: CreateInspectionDto,
  ) {
    return this.qualityService.createInspection(
      req.user.companyId,
      dto,
      req.user.sub,
    );
  }

  @Get('inspections')
  @RequirePermission('quality.inspections.view')
  listInspections(
    @Request() req: AuthRequest,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('goodsReceiptId') goodsReceiptId?: string,
    @Query('productionOrderId') productionOrderId?: string,
  ) {
    return this.qualityService.listInspections(req.user.companyId, {
      status: status as InspectionStatus | undefined,
      type: type as InspectionType | undefined,
      goodsReceiptId,
      productionOrderId,
    });
  }

  @Get('inspections/:id')
  @RequirePermission('quality.inspections.view')
  getInspection(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.getInspection(id, req.user.companyId);
  }

  @Patch('inspections/:id/start')
  @RequirePermission('quality.inspections.start')
  startInspection(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.startInspection(
      id,
      req.user.companyId,
      req.user.sub,
    );
  }

  @Patch('inspections/:id/pass')
  @RequirePermission('quality.inspections.approve')
  passInspection(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body('notes') notes?: string,
  ) {
    return this.qualityService.passInspection(id, req.user.companyId, notes);
  }

  @Patch('inspections/:id/fail')
  @RequirePermission('quality.inspections.reject')
  failInspection(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() ncrDto: CreateNcrDto,
  ) {
    return this.qualityService.failInspection(
      id,
      req.user.companyId,
      ncrDto,
      req.user.sub,
    );
  }

  @Patch('inspections/:id/hold')
  @RequirePermission('quality.inspections.hold')
  holdInspection(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body('notes') notes?: string,
  ) {
    return this.qualityService.holdInspection(id, req.user.companyId, notes);
  }

  // ─── NCRs ──────────────────────────────────────────────────────────────────

  @Post('ncr')
  @RequirePermission('quality.ncr.create')
  createNcr(@Request() req: AuthRequest, @Body() dto: CreateNcrDto) {
    return this.qualityService.createNcr(req.user.companyId, dto, req.user.sub);
  }

  @Get('ncr')
  @RequirePermission('quality.ncr.view')
  listNcrs(
    @Request() req: AuthRequest,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.qualityService.listNcrs(req.user.companyId, {
      status: status as NcrStatus | undefined,
      supplierId,
      productId,
    });
  }

  @Get('ncr/:id')
  @RequirePermission('quality.ncr.view')
  getNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.getNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id')
  @RequirePermission('quality.ncr.update')
  updateNcr(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateNcrDto,
  ) {
    return this.qualityService.updateNcr(id, req.user.companyId, dto);
  }

  @Patch('ncr/:id/analyze')
  @RequirePermission('quality.ncr.analyze')
  analyzeNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.analyzeNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id/corrective-action')
  @RequirePermission('quality.ncr.corrective-action')
  correctiveActionNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.correctiveActionNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id/close')
  @RequirePermission('quality.ncr.close')
  closeNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.closeNcr(id, req.user.companyId, req.user.sub);
  }

  @Patch('ncr/:id/cancel')
  @RequirePermission('quality.ncr.cancel')
  cancelNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.cancelNcr(id, req.user.companyId);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @RequirePermission('quality.reports.view')
  getStats(@Request() req: AuthRequest) {
    return this.qualityService.getQualityStats(req.user.companyId);
  }
}
