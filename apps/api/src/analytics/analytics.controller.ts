import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EtlService } from './etl/etl.service';
import { SalesCubeService, SalesFilters } from './cubes/sales-cube.service';
import { InventoryCubeService, InventoryFilters } from './cubes/inventory-cube.service';
import { ProductionCubeService, ProductionFilters } from './cubes/production-cube.service';
import { FinancialCubeService, FinancialFilters } from './cubes/financial-cube.service';
import { ComparisonService, Metric, MetricFilters } from './comparison.service';
import { DashboardService } from './dashboard.service';
import { WidgetDataService } from './widget-data.service';
import { ForecastingService } from './forecasting/forecasting.service';
import { AnomalyDetectionService } from './forecasting/anomaly-detection.service';
import { AlertService } from './alert.service';
import { SemanticLayerService } from './semantic/semantic-layer.service';
import { ExportService } from './export/export.service';
import { ReportSchedulerService } from './scheduler/report-scheduler.service';
import { QueryAuditService } from './audit/query-audit.service';
import { CreateDashboardDto } from './dto/create-dashboard.dto';
import { UpdateDashboardDto } from './dto/update-dashboard.dto';
import { CreateWidgetDto } from './dto/create-widget.dto';
import { UpdateWidgetDto } from './dto/update-widget.dto';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { CreateMetricDto } from './dto/create-metric.dto';
import { CreateDimensionDto } from './dto/create-dimension.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ExportQueryDto } from './dto/export-query.dto';

// Decorator stubs — provided by common/decorators
declare const CurrentUser: () => ParameterDecorator;

interface AuthUser {
  userId: string;
  companyId: string;
  role: string;
}

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly etl: EtlService,
    private readonly salesCube: SalesCubeService,
    private readonly inventoryCube: InventoryCubeService,
    private readonly productionCube: ProductionCubeService,
    private readonly financialCube: FinancialCubeService,
    private readonly comparison: ComparisonService,
    private readonly dashboardService: DashboardService,
    private readonly widgetDataService: WidgetDataService,
    private readonly forecasting: ForecastingService,
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly alertService: AlertService,
    private readonly semanticLayer: SemanticLayerService,
    private readonly exportService: ExportService,
    private readonly scheduler: ReportSchedulerService,
    private readonly queryAudit: QueryAuditService,
  ) {}

  // ─── ETL ────────────────────────────────────────────────────────────────────

  @Post('etl/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger ETL snapshot for one company' })
  async runEtl(
    @CurrentUser() user: AuthUser,
    @Body() body: { date?: string },
  ) {
    await this.etl.runDailySnapshot(user.companyId, body.date);
    return { ok: true };
  }

  @Post('etl/run-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger ETL snapshot for all companies' })
  async runEtlAll(@Body() body: { date?: string }) {
    await this.etl.runAllCompanies(body.date);
    return { ok: true };
  }

  // ─── Sales cube ─────────────────────────────────────────────────────────────

  @Get('sales-cube')
  @ApiOperation({ summary: 'Query sales fact table' })
  async querySales(
    @CurrentUser() user: AuthUser,
    @Query() query: SalesFilters & { dimension?: string; dimensionId?: string },
  ) {
    if (query.dimension && query.dimensionId) {
      return this.salesCube.drillDown(
        user.companyId,
        query.dimension as 'product' | 'customer' | 'region' | 'state',
        query.dimensionId,
        query,
      );
    }
    return this.salesCube.query(user.companyId, query);
  }

  @Get('sales-cube/top')
  @ApiOperation({ summary: 'Top N by revenue' })
  async topSales(
    @CurrentUser() user: AuthUser,
    @Query() query: SalesFilters & { dimension?: string; n?: string },
  ) {
    const dimension = (query.dimension ?? 'product') as 'product' | 'customer' | 'region';
    const n = query.n ? parseInt(query.n, 10) : 10;
    return this.salesCube.topN(user.companyId, dimension, n, query);
  }

  // ─── Inventory cube ─────────────────────────────────────────────────────────

  @Get('inventory-cube')
  @ApiOperation({ summary: 'Query inventory fact table' })
  async queryInventory(
    @CurrentUser() user: AuthUser,
    @Query() query: InventoryFilters & { dimension?: string; dimensionId?: string },
  ) {
    if (query.dimension && query.dimensionId) {
      return this.inventoryCube.drillDown(
        user.companyId,
        query.dimension as 'warehouse' | 'product' | 'category',
        query.dimensionId,
        query,
      );
    }
    return this.inventoryCube.query(user.companyId, query);
  }

  @Get('inventory-cube/aging')
  @ApiOperation({ summary: 'Inventory aging analysis' })
  async inventoryAging(
    @CurrentUser() user: AuthUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.inventoryCube.aging(user.companyId, warehouseId, categoryId);
  }

  // ─── Production cube ────────────────────────────────────────────────────────

  @Get('production-cube')
  @ApiOperation({ summary: 'Query production fact table' })
  async queryProduction(
    @CurrentUser() user: AuthUser,
    @Query() query: ProductionFilters & { dimension?: string; dimensionId?: string },
  ) {
    if (query.dimension && query.dimensionId) {
      return this.productionCube.drillDown(
        user.companyId,
        query.dimension as 'product' | 'workCenter',
        query.dimensionId,
        query,
      );
    }
    return this.productionCube.query(user.companyId, query);
  }

  @Get('production-cube/costs')
  @ApiOperation({ summary: 'Material vs labor cost analysis' })
  async productionCosts(
    @CurrentUser() user: AuthUser,
    @Query() query: ProductionFilters,
  ) {
    return this.productionCube.costAnalysis(user.companyId, query);
  }

  // ─── Financial cube ─────────────────────────────────────────────────────────

  @Get('financial-cube')
  @ApiOperation({ summary: 'Query financial fact table' })
  async queryFinancial(
    @CurrentUser() user: AuthUser,
    @Query() query: FinancialFilters & { dimension?: string; dimensionId?: string },
  ) {
    if (query.dimension && query.dimensionId) {
      return this.financialCube.drillDown(
        user.companyId,
        query.dimension as 'bankAccount' | 'category' | 'type',
        query.dimensionId,
        query,
      );
    }
    return this.financialCube.query(user.companyId, query);
  }

  @Get('financial-cube/cash-flow')
  @ApiOperation({ summary: 'Revenue vs expense by period' })
  async cashFlow(
    @CurrentUser() user: AuthUser,
    @Query() query: FinancialFilters,
  ) {
    return this.financialCube.cashFlow(user.companyId, query);
  }

  // ─── Comparison ─────────────────────────────────────────────────────────────

  @Get('comparison')
  @ApiOperation({ summary: 'Generic period comparison' })
  async compare(
    @CurrentUser() user: AuthUser,
    @Query('metric') metric: Metric,
    @Query('currentPeriod') currentPeriod: string,
    @Query('comparisonPeriod') comparisonPeriod: string,
    @Query('productId') productId?: string,
    @Query('customerId') customerId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    const filters: MetricFilters = { productId, customerId, warehouseId };
    return this.comparison.compare(user.companyId, metric, currentPeriod, comparisonPeriod, filters);
  }

  @Get('comparison/yoy')
  @ApiOperation({ summary: 'Year-over-year comparison by month' })
  async yoy(
    @CurrentUser() user: AuthUser,
    @Query('metric') metric: Metric,
    @Query('year') year: string,
    @Query('productId') productId?: string,
  ) {
    return this.comparison.yoy(user.companyId, metric, parseInt(year, 10), { productId });
  }

  @Get('comparison/mom')
  @ApiOperation({ summary: 'Month-over-month comparison' })
  async mom(
    @CurrentUser() user: AuthUser,
    @Query('metric') metric: Metric,
    @Query('month') month: string,
  ) {
    return this.comparison.mom(user.companyId, metric, month);
  }

  // ─── Dashboards ─────────────────────────────────────────────────────────────

  @Post('dashboards')
  @ApiOperation({ summary: 'Create a new dashboard' })
  async createDashboard(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboardService.create(user.companyId, user.userId, dto);
  }

  @Get('dashboards')
  @ApiOperation({ summary: "List user's own + shared dashboards" })
  async listDashboards(@CurrentUser() user: AuthUser) {
    return this.dashboardService.findAll(user.companyId, user.userId);
  }

  @Get('dashboards/:id')
  @ApiOperation({ summary: 'Get a single dashboard' })
  async getDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboardService.findOne(user.companyId, id, user.userId);
  }

  @Patch('dashboards/:id')
  @ApiOperation({ summary: 'Update a dashboard' })
  async updateDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboardService.update(user.companyId, user.userId, id, dto);
  }

  @Delete('dashboards/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a dashboard (owner only)' })
  async deleteDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboardService.delete(user.companyId, user.userId, id);
  }

  @Post('dashboards/:id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set dashboard as default for the user' })
  async setDefaultDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboardService.setDefault(user.companyId, user.userId, id);
  }

  @Post('dashboards/:id/share')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle sharing of a dashboard' })
  async shareDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboardService.share(user.companyId, user.userId, id);
  }

  @Post('dashboards/:id/duplicate')
  @ApiOperation({ summary: 'Duplicate a dashboard (including widgets)' })
  async duplicateDashboard(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.dashboardService.duplicate(user.companyId, user.userId, id);
  }

  @Get('dashboards/:id/data')
  @ApiOperation({ summary: 'Resolve all widgets in a dashboard' })
  async getDashboardData(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.widgetDataService.resolveDashboard(user.companyId, id, user.userId);
  }

  // ─── Widgets ─────────────────────────────────────────────────────────────────

  @Post('dashboards/:dashboardId/widgets')
  @ApiOperation({ summary: 'Add a widget to a dashboard' })
  async createWidget(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateWidgetDto,
  ) {
    return this.dashboardService.createWidget(user.companyId, user.userId, dashboardId, dto);
  }

  @Get('dashboards/:dashboardId/widgets')
  @ApiOperation({ summary: 'List widgets in a dashboard' })
  async listWidgets(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboardService.findWidgets(user.companyId, user.userId, dashboardId);
  }

  @Patch('dashboards/:dashboardId/widgets/:widgetId')
  @ApiOperation({ summary: 'Update a widget' })
  async updateWidget(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.dashboardService.updateWidget(user.companyId, user.userId, dashboardId, widgetId, dto);
  }

  @Delete('dashboards/:dashboardId/widgets/:widgetId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a widget' })
  async deleteWidget(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboardService.deleteWidget(user.companyId, user.userId, dashboardId, widgetId);
  }

  @Get('dashboards/:dashboardId/widgets/:widgetId/data')
  @ApiOperation({ summary: 'Resolve a single widget data' })
  async getWidgetData(
    @CurrentUser() user: AuthUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    // Validate access and get widget
    const widgets = await this.dashboardService.findWidgets(user.companyId, user.userId, dashboardId);
    const widget = widgets.find((w) => w.id === widgetId);
    if (!widget) {
      return { error: 'Widget not found' };
    }
    return this.widgetDataService.resolveWidget(user.companyId, {
      type: widget.type,
      config: widget.config as Record<string, any>,
    });
  }

  // ─── Forecasting ─────────────────────────────────────────────────────────────

  @Post('forecast')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate time-series forecast using Holt-Winters' })
  async generateForecast(
    @CurrentUser() user: AuthUser,
    @Body() dto: ForecastQueryDto,
  ) {
    return this.forecasting.forecastMetric(
      user.companyId,
      dto.dataSource,
      dto.metric,
      dto.periods,
      dto.filters,
    );
  }

  @Post('forecast/decompose')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decompose time series into trend, seasonal, residual' })
  async decomposeSeries(
    @CurrentUser() user: AuthUser,
    @Body() dto: ForecastQueryDto,
  ) {
    return this.forecasting.decomposeMetric(
      user.companyId,
      dto.dataSource,
      dto.metric,
      dto.seasonLength ?? 12,
      dto.filters,
    );
  }

  // ─── Anomaly Detection ───────────────────────────────────────────────────────

  @Get('anomalies')
  @ApiOperation({ summary: 'Detect anomalies in a time series metric' })
  async detectAnomalies(
    @CurrentUser() user: AuthUser,
    @Query('dataSource') dataSource: string,
    @Query('metric') metric: string,
    @Query('windowDays') windowDays?: string,
    @Query('periodFrom') periodFrom?: string,
    @Query('periodTo') periodTo?: string,
  ) {
    return this.anomalyDetection.detectInTimeSeries(
      user.companyId,
      dataSource,
      metric,
      windowDays ? parseInt(windowDays, 10) : 90,
      { periodFrom, periodTo },
    );
  }

  // ─── Alert Rules ─────────────────────────────────────────────────────────────

  @Post('alert-rules')
  @ApiOperation({ summary: 'Create an alert rule' })
  async createAlertRule(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAlertRuleDto,
  ) {
    return this.alertService.createRule(user.companyId, dto);
  }

  @Get('alert-rules')
  @ApiOperation({ summary: 'List alert rules for the company' })
  async listAlertRules(@CurrentUser() user: AuthUser) {
    return this.alertService.findRules(user.companyId);
  }

  @Patch('alert-rules/:id')
  @ApiOperation({ summary: 'Update an alert rule' })
  async updateAlertRule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateAlertRuleDto>,
  ) {
    return this.alertService.updateRule(user.companyId, id, dto);
  }

  @Delete('alert-rules/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an alert rule' })
  async deleteAlertRule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.alertService.deleteRule(user.companyId, id);
  }

  // ─── Alert Triggers ──────────────────────────────────────────────────────────

  @Get('alert-triggers')
  @ApiOperation({ summary: 'List alert triggers' })
  async listAlertTriggers(
    @CurrentUser() user: AuthUser,
    @Query('ruleId') ruleId?: string,
    @Query('acknowledged') acknowledged?: string,
  ) {
    const ack =
      acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined;
    return this.alertService.findTriggers(user.companyId, ruleId, ack);
  }

  @Patch('alert-triggers/:id/acknowledge')
  @ApiOperation({ summary: 'Acknowledge an alert trigger' })
  async acknowledgeTrigger(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.alertService.acknowledgeTrigger(id, user.userId);
  }

  // ─── Semantic Layer ──────────────────────────────────────────────────────────

  @Get('semantic/metrics')
  @ApiOperation({ summary: 'List all metrics (built-in + custom)' })
  async listMetrics(@CurrentUser() user: AuthUser) {
    return this.semanticLayer.findMetrics(user.companyId);
  }

  @Post('semantic/metrics')
  @ApiOperation({ summary: 'Create a custom metric' })
  async createMetric(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMetricDto,
  ) {
    return this.semanticLayer.createMetric(user.companyId, dto);
  }

  @Get('semantic/dimensions')
  @ApiOperation({ summary: 'List all dimensions (built-in + custom)' })
  async listDimensions(@CurrentUser() user: AuthUser) {
    return this.semanticLayer.findDimensions(user.companyId);
  }

  @Post('semantic/dimensions')
  @ApiOperation({ summary: 'Create a custom dimension' })
  async createDimension(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDimensionDto,
  ) {
    return this.semanticLayer.createDimension(user.companyId, dto);
  }

  @Get('semantic/dictionary')
  @ApiOperation({ summary: 'Full data dictionary (all metrics + dimensions)' })
  async getDataDictionary(@CurrentUser() user: AuthUser) {
    return this.semanticLayer.getDataDictionary(user.companyId);
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export dashboard data in CSV, XLSX or HTML' })
  async exportData(
    @CurrentUser() user: AuthUser,
    @Body() dto: ExportQueryDto,
  ) {
    if (!dto.dashboardId) {
      return { message: 'dashboardId is required for export' };
    }
    return this.exportService.exportDashboardData(
      user.companyId,
      dto.dashboardId,
      dto.format as 'CSV' | 'XLSX' | 'HTML',
      user.userId,
    );
  }

  // ─── Report Schedules ────────────────────────────────────────────────────────

  @Post('schedules')
  @ApiOperation({ summary: 'Create a report schedule' })
  async createSchedule(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.scheduler.createSchedule(user.companyId, dto);
  }

  @Get('schedules')
  @ApiOperation({ summary: 'List report schedules for the company' })
  async listSchedules(@CurrentUser() user: AuthUser) {
    return this.scheduler.findSchedules(user.companyId);
  }

  @Patch('schedules/:id')
  @ApiOperation({ summary: 'Update a report schedule' })
  async updateSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateScheduleDto>,
  ) {
    return this.scheduler.updateSchedule(user.companyId, id, dto);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a report schedule' })
  async deleteSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.scheduler.deleteSchedule(user.companyId, id);
  }

  @Post('schedules/:id/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger a report schedule' })
  async runSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.scheduler.runSchedule(id, user.userId);
  }

  // ─── Query Analytics ─────────────────────────────────────────────────────────

  @Get('query-stats')
  @ApiOperation({ summary: 'Query usage statistics and cache hit rate' })
  async getQueryStats(
    @CurrentUser() user: AuthUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.queryAudit.getQueryStats(
      user.companyId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('query-stats/slow')
  @ApiOperation({ summary: 'List slow queries above threshold (default 1000ms)' })
  async getSlowQueries(
    @CurrentUser() user: AuthUser,
    @Query('thresholdMs') thresholdMs?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.queryAudit.getSlowQueries(
      user.companyId,
      thresholdMs ? parseInt(thresholdMs, 10) : undefined,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }
}
