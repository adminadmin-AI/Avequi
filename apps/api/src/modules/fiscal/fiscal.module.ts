import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FiscalService } from './fiscal.service';
import { ComplianceService } from './compliance.service';
import { FiscalController } from './fiscal.controller';
import { FiscalClientService } from './fiscal-client.service';
import { EMISSOR_PORT } from './emissor.port';
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
  providers: [
    FiscalService,
    ComplianceService,
    FiscalClientService,
    FiscalListener,
    // #501: o domínio depende do contrato; a Focus é o adapter atual
    { provide: EMISSOR_PORT, useExisting: FiscalClientService },
  ],
  exports: [FiscalService, FiscalClientService, EMISSOR_PORT],
})
export class FiscalModule {}
