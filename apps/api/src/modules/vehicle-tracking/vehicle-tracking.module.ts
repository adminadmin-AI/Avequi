import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { VehicleTrackingController } from './vehicle-tracking.controller';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';

@Module({
  imports: [PrismaModule],
  controllers: [VehicleTrackingController],
  providers: [BinRegistrationService, AtpveService],
  exports: [BinRegistrationService, AtpveService],
})
export class VehicleTrackingModule {}
