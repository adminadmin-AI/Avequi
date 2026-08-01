import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChassiController } from './chassi.controller';
import { ChassiService } from './chassi.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChassiController],
  providers: [ChassiService],
  exports: [ChassiService],
})
export class ChassiModule {}
