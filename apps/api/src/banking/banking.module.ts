import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { BoletoService } from './boleto.service';
import { CnabService } from './cnab/cnab.service';
import { ReconciliationService } from './reconciliation.service';
import { DdaService } from './dda.service';
import { PixService } from './pix.service';
import { CreditLimitService } from './credit-limit.service';
import { FraudDetectionService } from './fraud-detection.service';
import { BankingReportService } from './banking-report.service';

@Module({
  controllers: [BankingController],
  providers: [
    BankingService,
    BoletoService,
    CnabService,
    ReconciliationService,
    DdaService,
    PixService,
    CreditLimitService,
    FraudDetectionService,
    BankingReportService,
  ],
  exports: [
    BankingService,
    BoletoService,
    CnabService,
    DdaService,
    PixService,
    CreditLimitService,
    FraudDetectionService,
    BankingReportService,
  ],
})
export class BankingModule {}
