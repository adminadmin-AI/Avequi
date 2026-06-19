import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SerialController } from './serial.controller';
import { SerialService } from './serial.service';

@Module({
  imports: [PrismaModule],
  controllers: [SerialController],
  providers: [SerialService],
  exports: [SerialService],
})
export class SerialModule {}
