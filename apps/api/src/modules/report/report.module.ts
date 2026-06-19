import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';
import { ReportProcessor } from './report.processor';
import { REPORT_QUEUE } from './report.types';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const parsed = new URL(url);
        return {
          redis: {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            password: parsed.password || undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: REPORT_QUEUE }),
  ],
  controllers: [ReportController],
  providers: [ReportService, ReportProcessor],
})
export class ReportModule {}
