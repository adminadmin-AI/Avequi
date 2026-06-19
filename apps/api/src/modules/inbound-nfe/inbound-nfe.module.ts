import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InboundNfeController } from './inbound-nfe.controller';
import { InboundNfeService } from './inbound-nfe.service';

@Module({
  imports: [PrismaModule],
  controllers: [InboundNfeController],
  providers: [InboundNfeService],
  exports: [InboundNfeService],
})
export class InboundNfeModule {}
