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
import { ProductionOrderStatus } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CreateProductionLogDto } from './dto/create-log.dto';
import { ProductionService } from './production.service';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 *
 * Ciclo da OP no desenho v2 (decisão Rafael): PCP cria/planeja (create),
 * supervisor/gerência libera e conclui (release/complete/cancel), operador
 * inicia e aponta (start/execute), qualidade aprova/reprova inspeção.
 */
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  // POST /production
  @Post()
  @RequirePermission('production.orders.create')
  create(
    @Body() dto: CreateProductionOrderDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.create(dto, req.user.companyId, req.user.sub);
  }

  // GET /production/metrics/scrap — métricas de refugo (#184)
  @Get('metrics/scrap')
  @RequirePermission('production.orders.view')
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
  @RequirePermission('production.orders.view')
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ProductionOrderStatus,
  ) {
    return this.productionService.findAll(req.user.companyId, status);
  }

  // GET /production/:id
  @Get(':id')
  @RequirePermission('production.orders.view')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.findOne(id, req.user.companyId);
  }

  // PATCH /production/:id/release
  @Patch(':id/release')
  @RequirePermission('production.orders.release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.release(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/start
  @Patch(':id/start')
  @RequirePermission('production.orders.start')
  start(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.start(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/complete
  @Patch(':id/complete')
  @RequirePermission('production.orders.complete')
  complete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('producedQty') producedQty?: number,
  ) {
    return this.productionService.complete(id, req.user.companyId, producedQty, req.user.sub);
  }

  // PATCH /production/:id/cancel
  @Patch(':id/cancel')
  @RequirePermission('production.orders.cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.cancel(id, req.user.companyId, req.user.sub);
  }

  // POST /production/:id/logs — registrar apontamento
  @Post(':id/logs')
  @RequirePermission('production.orders.execute')
  addLog(
    @Param('id') id: string,
    @Body() dto: CreateProductionLogDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.addLog(id, req.user.companyId, dto, req.user.sub);
  }

  // GET /production/:id/logs — listar apontamentos
  @Get(':id/logs')
  @RequirePermission('production.orders.view')
  getLogs(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getLogs(id, req.user.companyId);
  }

  // GET /production/:id/progress — resumo de progresso
  @Get(':id/progress')
  @RequirePermission('production.orders.view')
  getProgress(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getProgress(id, req.user.companyId);
  }

  // GET /production/:id/cost — custo real da OP (disponível após DONE)
  @Get(':id/cost')
  @RequirePermission('production.orders.view')
  getCost(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getCost(id, req.user.companyId);
  }

  // PATCH /production/:id/approve-inspection — aprovar inspeção final (#185)
  @Patch(':id/approve-inspection')
  @RequirePermission('production.orders.approve')
  approveInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.approveInspection(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/reject-inspection — rejeitar inspeção final (#185)
  @Patch(':id/reject-inspection')
  @RequirePermission('production.orders.reject')
  rejectInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('reason') reason: string,
  ) {
    return this.productionService.rejectInspection(id, req.user.companyId, reason, req.user.sub);
  }
}
