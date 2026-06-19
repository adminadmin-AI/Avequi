import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { MrpModule } from '../mrp/mrp.module';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';
import { AlertScheduler } from './alert.scheduler';
import { REPORT_QUEUE } from '../report/report.types';

@Module({
  imports: [
    PrismaModule,
    MrpModule,
    BullModule.registerQueue({ name: REPORT_QUEUE }),
  ],
  controllers: [AlertController],
  providers: [AlertService, AlertScheduler],
  exports: [AlertService],
})
export class AlertModule {}
