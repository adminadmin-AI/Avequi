import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DemandService } from './demand.service';
import { UpsertDemandDto } from './dto/upsert-demand.dto';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 * Horizonte de MRP (configure) é planejamento/gestão — fora do vendedor.
 */
@Controller('demand')
export class DemandController {
  constructor(private readonly demandService: DemandService) {}

  // POST /demand — cria ou atualiza previsão de demanda (companyId vem do JWT)
  @Post()
  @RequirePermission('sales.demand.create')
  upsert(
    @Body() dto: UpsertDemandDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.demandService.upsert(dto, req.user.companyId, req.user.sub);
  }

  // GET /demand?period=2026-05&productId=xxx
  @Get()
  @RequirePermission('sales.demand.view')
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('period') period?: string,
    @Query('productId') productId?: string,
  ) {
    return this.demandService.findAll(req.user.companyId, { period, productId });
  }

  // GET /demand/consolidated?period=2026-05&productId=xxx
  // O grupo empresarial é derivado da empresa do usuário (JWT) — nunca da query.
  @Get('consolidated')
  @RequirePermission('sales.demand.view')
  getConsolidated(
    @Request() req: { user: { companyId: string } },
    @Query('period') period?: string,
    @Query('productId') productId?: string,
  ) {
    return this.demandService.getConsolidated(req.user.companyId, { period, productId });
  }

  // GET /demand/history/:productId
  @Get('history/:productId')
  @RequirePermission('sales.demand.view')
  getHistory(
    @Param('productId') productId: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.demandService.getHistory(productId, req.user.companyId);
  }

  // GET /demand/suggestions?scope=group
  // scope=group agrega o grupo do próprio usuário (derivado do JWT) — nunca da query.
  @Get('suggestions')
  @RequirePermission('sales.demand.view')
  getSuggestions(
    @Request() req: { user: { companyId: string } },
    @Query('scope') scope?: string,
  ) {
    return this.demandService.getSuggestions(
      req.user.companyId,
      scope === 'group' ? 'group' : 'company',
    );
  }

  // PATCH /demand/horizon — configura mrp_horizon_days
  @Patch('horizon')
  @RequirePermission('sales.demand.configure')
  setHorizon(
    @Request() req: { user: { companyId: string } },
    @Body('days') days: number,
  ) {
    return this.demandService.setHorizon(req.user.companyId, days);
  }

  // DELETE /demand/:id
  @Delete(':id')
  @RequirePermission('sales.demand.delete')
  remove(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.demandService.remove(id, req.user.companyId, req.user.sub);
  }
}
