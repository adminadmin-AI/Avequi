import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';
import { MailModule } from '../mail/mail.module';
import { UserModule } from '../user/user.module';
import { BillingController } from './billing.controller';
import { BillingStatusController } from './billing-status.controller';
import { BillingService } from './billing.service';
import { InviteController } from './invite.controller';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsPanelController } from './ops-panel.controller';
import { OpsPanelService } from './ops-panel.service';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { ProvisioningService } from './provisioning.service';
import { TenantInviteService } from './tenant-invite.service';
import { UsageMeteringService } from './usage-metering.service';

/**
 * OpsModule — control plane da operadora Avecchi (épico #915).
 * WP1 #908: lifecycle + fronteira. WP2 #909: provisionamento + convite.
 *
 * FRONTEIRA CROSS-TENANT: único módulo autorizado a enxergar dados de mais de
 * um tenant. NENHUM service daqui é exportado de propósito — nenhum módulo de
 * domínio pode consumir visão cross-tenant "por conveniência"; quem precisar
 * de algo daqui passa pela API (com permissão ops.* + MFA) ou traz a
 * discussão pro épico. O InviteController é a única rota pública (aceite de
 * convite por token — escopado a um usuário, não é visão cross-tenant).
 */
@Module({
  imports: [ConfigModule, PrismaModule, IamModule, MailModule, UserModule],
  controllers: [
    OpsController,
    OpsPanelController,
    PlansController,
    BillingController,
    BillingStatusController,
    InviteController,
  ],
  providers: [
    BillingService,
    OpsService,
    OpsMfaGuard,
    OpsPanelService,
    PlansService,
    ProvisioningService,
    TenantInviteService,
    UsageMeteringService,
  ],
})
export class OpsModule {}
