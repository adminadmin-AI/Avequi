import { Module } from '@nestjs/common';
import { FinancialForecastController } from './financial-forecast.controller';
import { FinancialForecastService } from './financial-forecast.service';

@Module({
  controllers: [FinancialForecastController],
  providers: [FinancialForecastService],
  exports: [FinancialForecastService],
})
export class FinancialForecastModule {}
