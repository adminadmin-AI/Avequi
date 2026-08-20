import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';
import { MailModule } from '../mail/mail.module';
import { UserModule } from '../user/user.module';
import { BillingController } from './billing.controller';
import { BillingStatusController } from './billing-status.controller';
import { BillingService } from './billing.service';
import {
  ImpersonationController,
  SupportAccessController,
} from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { InviteController } from './invite.controller';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsPanelController } from './ops-panel.controller';
import { OpsPanelService } from './ops-panel.service';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { ContractController } from './contract.controller';
import { ContractPdfService } from './contract-pdf.service';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { ProvisioningService } from './provisioning.service';
import { TenantInviteService } from './tenant-invite.service';
import { UsageMeteringService } from './usage-metering.service';

/**
 * OpsModule — control plane da operadora Avecchi (épico #915).
 * WP1 #908 lifecycle+fronteira · WP2 #909 provisionamento · WP3 #910 painel ·
 * WP4 #911 planos · WP5 #912 billing · WP6 #913 impersonation read-only.
 *
 * FRONTEIRA CROSS-TENANT: único módulo autorizado a enxergar dados de mais de
 * um tenant. NENHUM service daqui é exportado de propósito. Rotas públicas ou
 * self-service têm controllers próprios (Invite, BillingStatus,
 * SupportAccess) — o OpsMfaGuard não respeita @Public, by design.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    IamModule,
    MailModule,
    UserModule,
    // OPS WP6 (#913): assina o token de impersonation com o MESMO secret dos
    // access tokens (a JwtStrategy valida os dois; o scope diferencia).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get('JWT_SECRET') }),
    }),
  ],
  controllers: [
    OpsController,
    GroupsController,
    OpsPanelController,
    PlansController,
    BillingController,
    BillingStatusController,
    ImpersonationController,
    ContractController,
    ProposalsController,
    SupportAccessController,
    InviteController,
  ],
  providers: [
    BillingService,
    GroupsService,
    ImpersonationService,
    OpsService,
    OpsMfaGuard,
    OpsPanelService,
    OpsSessionGuard,
    PlansService,
    ContractPdfService,
    ProposalsService,
    ProvisioningService,
    TenantInviteService,
    UsageMeteringService,
  ],
})
export class OpsModule {}
