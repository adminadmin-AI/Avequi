import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { AuthModule } from './modules/auth/auth.module';
import { CompanyModule } from './modules/company/company.module';
import { UserModule } from './modules/user/user.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './modules/product/product.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { CustomerModule } from './modules/customer/customer.module';
import { BomModule } from './modules/bom/bom.module';
import { RoutingModule } from './modules/routing/routing.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { StockModule } from './modules/stock/stock.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SalesModule } from './modules/sales/sales.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { FinanceModule } from './modules/finance/finance.module';
import { TransferModule } from './modules/transfer/transfer.module';
import { DemandModule } from './modules/demand/demand.module';
import { MrpModule } from './modules/mrp/mrp.module';
import { ProductionModule } from './modules/production/production.module';
import { WmsModule } from './modules/wms/wms.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportModule } from './modules/report/report.module';
import { ForecastModule } from './modules/forecast/forecast.module';
import { AlertModule } from './modules/alert/alert.module';
import { QualityModule } from './modules/quality/quality.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const parsed = new URL(url);
        return {
          redis: {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            password: parsed.password || undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    CompanyModule,
    UserModule,
    ProductModule,
    SupplierModule,
    CustomerModule,
    BomModule,
    RoutingModule,
    WarehouseModule,
    StockModule,
    PurchaseModule,
    SalesModule,
    FiscalModule,
    FinanceModule,
    TransferModule,
    DemandModule,
    MrpModule,
    ProductionModule,
    WmsModule,
    DashboardModule,
    ReportModule,
    ForecastModule,
    AlertModule,
    QualityModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
