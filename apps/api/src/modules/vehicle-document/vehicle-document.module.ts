import { Module } from '@nestjs/common';
import { VehicleDocumentController } from './vehicle-document.controller';
import { VehicleDocumentService } from './vehicle-document.service';

@Module({
  controllers: [VehicleDocumentController],
  providers: [VehicleDocumentService],
  exports: [VehicleDocumentService],
})
export class VehicleDocumentModule {}
