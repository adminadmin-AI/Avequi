import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryListener } from './delivery.listener';

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryListener],
  exports: [DeliveryService],
})
export class DeliveryModule {}
