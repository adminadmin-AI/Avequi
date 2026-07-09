import { Module } from '@nestjs/common';
import { InvestmentController } from './investment.controller';
import { InvestmentService } from './investment.service';

@Module({
  controllers: [InvestmentController],
  providers: [InvestmentService],
  exports: [InvestmentService],
})
export class InvestmentModule {}
