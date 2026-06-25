import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import * as Joi from 'joi';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CompanyGuard } from './common/guards/company.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
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
import { SerialModule } from './modules/serial/serial.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { SupplierPortalModule } from './modules/supplier-portal/supplier-portal.module';
import { QuotationModule } from './modules/quotation/quotation.module';
import { InboundNfeModule } from './modules/inbound-nfe/inbound-nfe.module';
import { CapacityModule } from './modules/capacity/capacity.module';
import { BatchModule } from './modules/batch/batch.module';
import { TaxModule } from './modules/tax/tax.module';
import { PriceModule } from './modules/price/price.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { CommissionModule } from './modules/commission/commission.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { ManifestModule } from './modules/manifest/manifest.module';
import { BankingModule } from './banking/banking.module';
import { BpmModule } from './bpm/bpm.module';
import { AnalyticsModule as AnalyticsBiModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().uri().required(),
        DIRECT_URL: Joi.string().uri().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRY: Joi.string().default('1h'),
        REDIS_URL: Joi.string().uri().required(),
        API_PORT: Joi.number().default(3001),
        API_PREFIX: Joi.string().default('api'),
        WEB_URL: Joi.string().uri().default('http://localhost:3000'),
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        FOCUS_NFE_TOKEN: Joi.string().optional(),
        FOCUS_NFE_WEBHOOK_SECRET: Joi.string().optional(),
        BANK_ENCRYPTION_KEY: Joi.string().optional(),
        PIX_WEBHOOK_SECRET: Joi.string().optional(),
      }),
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
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
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),
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
    SerialModule,
    MaintenanceModule,
    SupplierPortalModule,
    QuotationModule,
    InboundNfeModule,
    CapacityModule,
    BatchModule,
    TaxModule,
    PriceModule,
    ApprovalModule,
    CommissionModule,
    RfqModule,
    ManifestModule,
    BankingModule,
    BpmModule,
    AnalyticsBiModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CompanyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
