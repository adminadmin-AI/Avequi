import { Module } from '@nestjs/common';
import { ManifestService } from './manifest.service';
import { ManifestController } from './manifest.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [PrismaModule, FiscalModule],
  controllers: [ManifestController],
  providers: [ManifestService],
  exports: [ManifestService],
})
export class ManifestModule {}
