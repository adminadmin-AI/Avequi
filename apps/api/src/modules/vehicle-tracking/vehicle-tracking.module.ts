import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { VehicleTrackingController } from './vehicle-tracking.controller';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';
import { RenaveOrchestratorService } from './renave-orchestrator.service';
import { VehicleProcessor } from './vehicle.processor';
import { VehicleListener } from './vehicle.listener';
import { SerproBinAdapter } from './adapters/serpro-bin.adapter';
import { SerproRenaveAdapter } from './adapters/serpro-renave.adapter';
import { BIN_PORT, RENAVE_PORT } from './ports/vehicle-provider.port';
import { VEHICLE_QUEUE } from './renave.types';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    BullModule.registerQueue({ name: VEHICLE_QUEUE }),
  ],
  controllers: [VehicleTrackingController],
  providers: [
    BinRegistrationService,
    AtpveService,
    RenaveOrchestratorService,
    VehicleProcessor,
    VehicleListener,
    // ports #501: trocar de provider = trocar o useClass (SERPRO hoje)
    { provide: BIN_PORT, useClass: SerproBinAdapter },
    { provide: RENAVE_PORT, useClass: SerproRenaveAdapter },
  ],
  exports: [BinRegistrationService, AtpveService, RenaveOrchestratorService],
})
export class VehicleTrackingModule {}
