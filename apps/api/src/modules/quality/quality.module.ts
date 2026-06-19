import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QualityController } from './quality.controller';
import { QualityListener } from './quality.listener';
import { QualityService } from './quality.service';

@Module({
  imports: [PrismaModule],
  controllers: [QualityController],
  providers: [QualityService, QualityListener],
  exports: [QualityService],
})
export class QualityModule {}
