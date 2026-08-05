import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BomExplosionModule } from '../../common/production/bom-explosion.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DispatchService } from './dispatch.service';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  // #817: BomExplosionModule traz a explosão de BOM compartilhada com o MRP
  // (#980) — o despacho por setor NÃO reimplementa a árvore.
  imports: [PrismaModule, EventEmitterModule, BomExplosionModule],
  controllers: [ProductionController],
  providers: [ProductionService, DispatchService],
  exports: [ProductionService, DispatchService],
})
export class ProductionModule {}
