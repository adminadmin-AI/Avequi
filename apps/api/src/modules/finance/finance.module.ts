import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceKpiService } from './finance-kpi.service';
import { ReconciliationService } from './reconciliation.service';
import { CollectionRuleService } from './collection-rule.service';
import { ProvisionService } from './provision.service';
import { SupplierAdvanceService } from './supplier-advance.service';
import { FinanceController } from './finance.controller';
import { BankingController } from './banking.controller';
import { BillingController } from './billing.controller';
import { FinanceListener } from './finance.listener';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FinanceController, BankingController, BillingController],
  providers: [FinanceService, FinanceKpiService, ReconciliationService, CollectionRuleService, ProvisionService, SupplierAdvanceService, FinanceListener],
  exports: [FinanceService],
})
export class FinanceModule {}
