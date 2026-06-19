import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BatchController } from './batch.controller';
import { BatchService } from './batch.service';

@Module({
  imports: [PrismaModule],
  controllers: [BatchController],
  providers: [BatchService],
  exports: [BatchService],
})
export class BatchModule {}
