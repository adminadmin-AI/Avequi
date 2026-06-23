import { Module } from '@nestjs/common';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRuleService } from './tax-rule.service';
import { TaxRuleController } from './tax-rule.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TaxRuleController],
  providers: [TaxCalculationService, TaxRuleService],
  exports: [TaxCalculationService],
})
export class TaxModule {}
