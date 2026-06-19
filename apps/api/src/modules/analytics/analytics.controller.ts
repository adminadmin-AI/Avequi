import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { QuerySalesCubeDto } from './dto/query-sales-cube.dto';
import { QueryProductionCostsDto } from './dto/query-production-costs.dto';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // GET /analytics/summary
  @Get('summary')
  getOlapSummary(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.getOlapSummary(req.user.companyId);
  }

  // GET /analytics/sales-cube?startDate=&endDate=&groupBy=
  @Get('sales-cube')
  salesCube(
    @Request() req: { user: { companyId: string } },
    @Query() dto: QuerySalesCubeDto,
  ) {
    return this.analyticsService.salesCube(req.user.companyId, dto);
  }

  // GET /analytics/inventory-aging
  @Get('inventory-aging')
  inventoryAging(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.inventoryAging(req.user.companyId);
  }

  // GET /analytics/production-costs?startDate=&endDate=&groupBy=
  @Get('production-costs')
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
  supplierRanking(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.supplierRanking(req.user.companyId);
  }

  // GET /analytics/nc-by-supplier
  @Get('nc-by-supplier')
  ncRateBySupplier(@Request() req: { user: { companyId: string } }) {
    return this.analyticsService.ncRateBySupplier(req.user.companyId);
  }
}
