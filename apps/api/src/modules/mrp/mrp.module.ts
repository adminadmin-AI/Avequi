import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MrpController } from './mrp.controller';
import { MrpService } from './mrp.service';

@Module({
  imports: [PrismaModule],
  controllers: [MrpController],
  providers: [MrpService],
  exports: [MrpService],
})
export class MrpModule {}
