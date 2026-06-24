import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WmsService } from './wms.service';
import { WmsController } from './wms.controller';
import { WmsListener } from './wms.listener';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [PrismaModule, EventEmitterModule, SalesModule],
  controllers: [WmsController],
  providers: [WmsService, WmsListener],
  exports: [WmsService],
})
export class WmsModule {}
