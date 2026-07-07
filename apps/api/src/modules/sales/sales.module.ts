import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SalesService } from './sales.service';
import { DiscountPolicyService } from './discount-policy.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { StockModule } from '../stock/stock.module';
import { TaxModule } from '../tax/tax.module';

@Module({
  imports: [PrismaModule, EventEmitterModule, StockModule, TaxModule],
  controllers: [SalesController],
  providers: [SalesService, DiscountPolicyService],
  exports: [SalesService],
})
export class SalesModule {}
