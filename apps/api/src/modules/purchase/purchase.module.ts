import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PurchaseService } from './purchase.service';
import { ThreeWayMatchService } from './three-way-match.service';
import { PurchaseController } from './purchase.controller';
import { SupplierProductMapService } from './supplier-product-map.service';
import { SupplierProductMapController } from './supplier-product-map.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, EventEmitterModule],
  controllers: [PurchaseController, SupplierProductMapController],
  providers: [PurchaseService, ThreeWayMatchService, SupplierProductMapService],
  exports: [PurchaseService, ThreeWayMatchService, SupplierProductMapService],
})
export class PurchaseModule {}
