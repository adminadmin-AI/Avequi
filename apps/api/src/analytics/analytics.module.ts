import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { EtlService } from './etl/etl.service';
import { SalesCubeService } from './cubes/sales-cube.service';
import { InventoryCubeService } from './cubes/inventory-cube.service';
import { ProductionCubeService } from './cubes/production-cube.service';
import { FinancialCubeService } from './cubes/financial-cube.service';
import { ComparisonService } from './comparison.service';
import { DashboardService } from './dashboard.service';
import { WidgetDataService } from './widget-data.service';
import { ForecastingService } from './forecasting/forecasting.service';
import { AnomalyDetectionService } from './forecasting/anomaly-detection.service';
import { AlertService } from './alert.service';
import { SemanticLayerService } from './semantic/semantic-layer.service';
import { ExportService } from './export/export.service';
import { ReportSchedulerService } from './scheduler/report-scheduler.service';
import { QueryCacheService } from './cache/query-cache.service';
import { QueryAuditService } from './audit/query-audit.service';

@Module({
  controllers: [AnalyticsController],
  providers: [
    EtlService,
    SalesCubeService,
    InventoryCubeService,
    ProductionCubeService,
    FinancialCubeService,
    ComparisonService,
    DashboardService,
    WidgetDataService,
    ForecastingService,
    AnomalyDetectionService,
    AlertService,
    SemanticLayerService,
    ExportService,
    ReportSchedulerService,
    QueryCacheService,
    QueryAuditService,
  ],
  exports: [
    EtlService,
    SalesCubeService,
    InventoryCubeService,
    ProductionCubeService,
    FinancialCubeService,
    ComparisonService,
    DashboardService,
    WidgetDataService,
    ForecastingService,
    AnomalyDetectionService,
    AlertService,
    SemanticLayerService,
    ExportService,
    ReportSchedulerService,
    QueryCacheService,
    QueryAuditService,
  ],
})
export class AnalyticsModule {}
