import { Module } from '@nestjs/common';
import { WmsService } from './wms.service';
import { WmsController } from './wms.controller';
import { WmsListener } from './wms.listener';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WmsController],
  providers: [WmsService, WmsListener],
  exports: [WmsService],
})
export class WmsModule {}
