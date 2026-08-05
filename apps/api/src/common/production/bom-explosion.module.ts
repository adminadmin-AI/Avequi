/**
 * #980 — Módulo da explosão de BOM.
 *
 * Existe para que MRP (hoje) e despacho por setor (#817) consumam a MESMA
 * explosão, em vez de cada um manter a sua cópia e divergirem com o tempo em
 * seleção de BOM, ciclo, profundidade, refugo e arredondamento.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BomExplosionService } from './bom-explosion.service';

@Module({
  imports: [PrismaModule],
  providers: [BomExplosionService],
  exports: [BomExplosionService],
})
export class BomExplosionModule {}
