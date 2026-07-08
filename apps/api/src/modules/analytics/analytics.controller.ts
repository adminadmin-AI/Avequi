import {
  Controller,
  Get,
  Query,
  Request,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AnalyticsService } from './analytics.service';
import { QuerySalesCubeDto } from './dto/query-sales-cube.dto';
import { QueryProductionCostsDto } from './dto/query-production-costs.dto';

/**
 * Painéis analíticos (OLAP/BI) — issue #341 parte 2.
 *
 * Antes: SEM gate (qualquer autenticado acessava). Agora: RBAC v2 via
 * @RequirePermission('analytics.dashboards.view') em toda rota (code já
 * existente no catálogo, mapeado para GET /analytics/*). Só leitura; companyId
 * SEMPRE do JWT. Backend é a autoridade.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // GET /analytics/summary
  @Get('summary')
  @RequirePermission('analytics.dashboards.view')
  getOlapSummary(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.getOlapSummary(req.user.companyId);
  }

  // GET /analytics/sales-cube?startDate=&endDate=&groupBy=
  @Get('sales-cube')
  @RequirePermission('analytics.dashboards.view')
  salesCube(
    @Request() req: { user: { companyId: string } },
    @Query() dto: QuerySalesCubeDto,
  ) {
    return this.analyticsService.salesCube(req.user.companyId, dto);
  }

  // GET /analytics/inventory-aging
  @Get('inventory-aging')
  @RequirePermission('analytics.dashboards.view')
  inventoryAging(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.inventoryAging(req.user.companyId);
  }

  // GET /analytics/production-costs?startDate=&endDate=&groupBy=
  @Get('production-costs')
  @RequirePermission('analytics.dashboards.view')
  productionCostAnalysis(
    @Request() req: { user: { companyId: string } },
    @Query() dto: QueryProductionCostsDto,
  ) {
    return this.analyticsService.productionCostAnalysis(
      req.user.companyId,
      dto,
    );
  }

  // GET /analytics/purchases?startDate=&endDate=
  @Get('purchases')
  @RequirePermission('analytics.dashboards.view')
  purchaseAnalysis(
    @Request() req: { user: { companyId: string } },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.purchaseAnalysis(
      req.user.companyId,
      startDate,
      endDate,
    );
  }

  // GET /analytics/stock-turnover?months=3
  @Get('stock-turnover')
  @RequirePermission('analytics.dashboards.view')
  stockTurnover(
    @Request() req: { user: { companyId: string } },
    @Query('months') months?: string,
  ) {
    return this.analyticsService.stockTurnover(
      req.user.companyId,
      months ? parseInt(months, 10) : 3,
    );
  }

  // GET /analytics/supplier-ranking
  @Get('supplier-ranking')
  @RequirePermission('analytics.dashboards.view')
  supplierRanking(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.supplierRanking(req.user.companyId);
  }

  // GET /analytics/nc-by-supplier
  @Get('nc-by-supplier')
  @RequirePermission('analytics.dashboards.view')
  ncRateBySupplier(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.ncRateBySupplier(req.user.companyId);
  }
}
