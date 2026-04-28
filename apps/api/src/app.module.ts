import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),
    EventEmitterModule.forRoot(),
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
  ],
})
export class AppModule {}
