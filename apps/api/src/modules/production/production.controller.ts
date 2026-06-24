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
import { ProductionOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CreateProductionLogDto } from './dto/create-log.dto';
import { ProductionService } from './production.service';

@UseGuards(JwtAuthGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  // POST /production
  @Post()
  create(
    @Body() dto: CreateProductionOrderDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.productionService.create(dto, req.user.sub);
  }

  // GET /production/metrics/scrap — métricas de refugo (#184)
  @Get('metrics/scrap')
  getScrapMetrics(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workCenterId') workCenterId?: string,
  ) {
    return this.productionService.getScrapMetrics(req.user.companyId, { from, to, workCenterId });
  }

  // GET /production?status=DRAFT
  @Get()
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ProductionOrderStatus,
  ) {
    return this.productionService.findAll(req.user.companyId, status);
  }

  // GET /production/:id
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.findOne(id, req.user.companyId);
  }

  // PATCH /production/:id/release
  @Patch(':id/release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.release(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/start
  @Patch(':id/start')
  start(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.start(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/complete
  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('producedQty') producedQty?: number,
  ) {
    return this.productionService.complete(id, req.user.companyId, producedQty, req.user.sub);
  }

  // PATCH /production/:id/cancel
  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.cancel(id, req.user.companyId, req.user.sub);
  }

  // POST /production/:id/logs — registrar apontamento
  @Post(':id/logs')
  addLog(
    @Param('id') id: string,
    @Body() dto: CreateProductionLogDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.addLog(id, req.user.companyId, dto, req.user.sub);
  }

  // GET /production/:id/logs — listar apontamentos
  @Get(':id/logs')
  getLogs(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getLogs(id, req.user.companyId);
  }

  // GET /production/:id/progress — resumo de progresso
  @Get(':id/progress')
  getProgress(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getProgress(id, req.user.companyId);
  }

  // GET /production/:id/cost — custo real da OP (disponível após DONE)
  @Get(':id/cost')
  getCost(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getCost(id, req.user.companyId);
  }

  // PATCH /production/:id/approve-inspection — aprovar inspeção final (#185)
  @Patch(':id/approve-inspection')
  approveInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.approveInspection(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/reject-inspection — rejeitar inspeção final (#185)
  @Patch(':id/reject-inspection')
  rejectInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('reason') reason: string,
  ) {
    return this.productionService.rejectInspection(id, req.user.companyId, reason, req.user.sub);
  }
}
