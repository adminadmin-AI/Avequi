import { Module } from '@nestjs/common';
import { DemandService } from './demand.service';
import { DemandController } from './demand.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DemandController],
  providers: [DemandService],
  exports: [DemandService],
})
export class DemandModule {}
