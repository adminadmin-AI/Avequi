import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';

@Module({
  imports: [PrismaModule],
  controllers: [QuotationController],
  providers: [QuotationService],
  exports: [QuotationService],
})
export class QuotationModule {}
