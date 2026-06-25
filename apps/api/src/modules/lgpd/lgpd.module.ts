import { Module } from '@nestjs/common';
import { LgpdService } from './lgpd.service';
import { LgpdController } from './lgpd.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LgpdController],
  providers: [LgpdService],
  exports: [LgpdService],
})
export class LgpdModule {}
