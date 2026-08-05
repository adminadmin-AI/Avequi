import { Module } from '@nestjs/common';
import { BomExplosionModule } from '../../common/production/bom-explosion.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MrpController } from './mrp.controller';
import { MrpService } from './mrp.service';

@Module({
  imports: [PrismaModule, BomExplosionModule],
  controllers: [MrpController],
  providers: [MrpService],
  exports: [MrpService],
})
export class MrpModule {}
