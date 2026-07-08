import { Module } from '@nestjs/common';
import { BudgetPlanController } from './budget-plan.controller';
import { BudgetPlanService } from './budget-plan.service';

@Module({
  controllers: [BudgetPlanController],
  providers: [BudgetPlanService],
  exports: [BudgetPlanService],
})
export class BudgetPlanModule {}
