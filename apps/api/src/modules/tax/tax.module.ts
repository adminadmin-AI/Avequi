import { Module } from '@nestjs/common';
import { TaxCalculationService } from './tax-calculation.service';
import { TaxRuleService } from './tax-rule.service';
import { TaxRuleController } from './tax-rule.controller';
import { TributaryClassificationService } from './tributary-classification.service';
import { TributaryClassificationController } from './tributary-classification.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TaxRuleController, TributaryClassificationController],
  providers: [TaxCalculationService, TaxRuleService, TributaryClassificationService],
  exports: [TaxCalculationService, TributaryClassificationService],
})
export class TaxModule {}
