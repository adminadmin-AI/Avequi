import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { QuotationPdfService } from './quotation-pdf.service';

@Module({
  imports: [PrismaModule],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationPdfService],
  exports: [QuotationService, QuotationPdfService],
})
export class QuotationModule {}
