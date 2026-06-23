import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PurchaseService } from './purchase.service';
import { ThreeWayMatchService } from './three-way-match.service';
import { PurchaseController } from './purchase.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, EventEmitterModule],
  controllers: [PurchaseController],
  providers: [PurchaseService, ThreeWayMatchService],
  exports: [PurchaseService, ThreeWayMatchService],
})
export class PurchaseModule {}
