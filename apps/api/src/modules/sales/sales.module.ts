import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SalesService } from './sales.service';
import { DiscountPolicyService } from './discount-policy.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { TaxModule } from '../tax/tax.module';
import { AcquirerModule } from '../acquirer/acquirer.module';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';

@Module({
  imports: [PrismaModule, EventEmitterModule, StockModule, TaxModule, AcquirerModule, PaymentGatewayModule],
  controllers: [SalesController],
  providers: [SalesService, DiscountPolicyService],
  exports: [SalesService],
})
export class SalesModule {}
