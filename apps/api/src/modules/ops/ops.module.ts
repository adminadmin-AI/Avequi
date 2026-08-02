import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

/**
 * OpsModule — control plane da operadora Avecchi (épico #915, WP1 #908).
 *
 * FRONTEIRA CROSS-TENANT: único módulo autorizado a enxergar dados de mais de
 * um tenant. O OpsService NÃO é exportado de propósito — nenhum módulo de
 * domínio pode consumir visão cross-tenant "por conveniência"; quem precisar
 * de algo daqui passa pela API (com permissão ops.* + MFA) ou traz a
 * discussão pro épico.
 */
@Module({
  imports: [PrismaModule, IamModule],
  controllers: [OpsController],
  providers: [OpsService, OpsMfaGuard],
})
export class OpsModule {}
