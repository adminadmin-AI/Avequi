import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupplierPortalController } from './supplier-portal.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { SupplierTokenGuard } from './guards/supplier-token.guard';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierPortalController],
  providers: [SupplierPortalService, SupplierTokenGuard],
  exports: [SupplierPortalService],
})
export class SupplierPortalModule {}
