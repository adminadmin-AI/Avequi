import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { InspectionStatus, InspectionType, NcrStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CreateNcrDto } from './dto/create-ncr.dto';
import { UpdateNcrDto } from './dto/update-ncr.dto';
import { QualityService } from './quality.service';

interface AuthRequest {
  user: { companyId: string; sub: string };
}

@UseGuards(JwtAuthGuard)
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  // ─── Inspections ───────────────────────────────────────────────────────────

  @Post('inspections')
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
  getInspection(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.getInspection(id, req.user.companyId);
  }

  @Patch('inspections/:id/start')
  startInspection(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.startInspection(
      id,
      req.user.companyId,
      req.user.sub,
    );
  }

  @Patch('inspections/:id/pass')
  passInspection(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body('notes') notes?: string,
  ) {
    return this.qualityService.passInspection(id, req.user.companyId, notes);
  }

  @Patch('inspections/:id/fail')
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
  holdInspection(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body('notes') notes?: string,
  ) {
    return this.qualityService.holdInspection(id, req.user.companyId, notes);
  }

  // ─── NCRs ──────────────────────────────────────────────────────────────────

  @Post('ncr')
  createNcr(@Request() req: AuthRequest, @Body() dto: CreateNcrDto) {
    return this.qualityService.createNcr(req.user.companyId, dto, req.user.sub);
  }

  @Get('ncr')
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
  getNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.getNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id')
  updateNcr(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UpdateNcrDto,
  ) {
    return this.qualityService.updateNcr(id, req.user.companyId, dto);
  }

  @Patch('ncr/:id/analyze')
  analyzeNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.analyzeNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id/corrective-action')
  correctiveActionNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.correctiveActionNcr(id, req.user.companyId);
  }

  @Patch('ncr/:id/close')
  closeNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.closeNcr(id, req.user.companyId, req.user.sub);
  }

  @Patch('ncr/:id/cancel')
  cancelNcr(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.qualityService.cancelNcr(id, req.user.companyId);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  getStats(@Request() req: AuthRequest) {
    return this.qualityService.getQualityStats(req.user.companyId);
  }
}
