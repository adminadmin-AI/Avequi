import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportProcessor } from './report.processor';
import { REPORT_QUEUE } from './report.types';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: REPORT_QUEUE }),
  ],
  controllers: [ReportController],
  providers: [ReportService, ReportProcessor],
})
export class ReportModule {}
