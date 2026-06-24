import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../../prisma/prisma.module';
import { InboundNfeController } from './inbound-nfe.controller';
import { InboundNfeService } from './inbound-nfe.service';

@Module({
  imports: [PrismaModule, EventEmitterModule],
  controllers: [InboundNfeController],
  providers: [InboundNfeService],
  exports: [InboundNfeService],
})
export class InboundNfeModule {}
