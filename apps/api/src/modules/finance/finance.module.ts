import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { BankingController } from './banking.controller';
import { BillingController } from './billing.controller';
import { FinanceListener } from './finance.listener';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceController, BankingController, BillingController],
  providers: [FinanceService, FinanceListener],
  exports: [FinanceService],
})
export class FinanceModule {}
