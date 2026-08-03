import { Module } from '@nestjs/common';
import { LgpdService } from './lgpd.service';
import { LgpdController } from './lgpd.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [PrismaModule, IamModule],
  controllers: [LgpdController],
  providers: [LgpdService],
  exports: [LgpdService],
})
export class LgpdModule {}
