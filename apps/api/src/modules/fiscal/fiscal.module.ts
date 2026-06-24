import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FiscalService } from './fiscal.service';
import { FiscalController } from './fiscal.controller';
import { FiscalClientService } from './fiscal-client.service';
import { FiscalListener } from './fiscal.listener';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxModule } from '../tax/tax.module';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({ timeout: 15000 }),
    TaxModule,
  ],
  controllers: [FiscalController],
  providers: [FiscalService, FiscalClientService, FiscalListener],
  exports: [FiscalService, FiscalClientService],
})
export class FiscalModule {}
