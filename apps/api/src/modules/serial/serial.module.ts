import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../../prisma/prisma.module';
import { SerialController } from './serial.controller';
import { SerialListener } from './serial.listener';
import { SerialService } from './serial.service';

@Module({
  imports: [PrismaModule, EventEmitterModule],
  controllers: [SerialController],
  providers: [SerialService, SerialListener],
  exports: [SerialService],
})
export class SerialModule {}
