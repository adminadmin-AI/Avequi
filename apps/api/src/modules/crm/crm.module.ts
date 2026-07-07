import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmListener } from './crm.listener';
import { FunnelService } from './funnel.service';
import { LeadConversionService } from './lead-conversion.service';
import { CrmDashboardService } from './crm-dashboard.service';
import { WhatsappTemplateService } from './whatsapp/template.service';
import { CrmSettingsService } from './crm-settings.service';
import { QuickReplyService } from './quick-reply.service';
import { ReminderService } from './reminder.service';
import { LeadListService } from './lead-list.service';
import { FollowupScheduler } from './followup.scheduler';
import { LeadIntakeService } from './lead-intake.service';
import { WhatsappWebhookProcessor } from './whatsapp/whatsapp-webhook.processor';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WHATSAPP_QUEUE } from './whatsapp/whatsapp.types';
import { ConnectorsController } from './connectors/connectors.controller';
import { ConnectorsProcessor } from './connectors/connectors.processor';
import { CRM_LEADS_QUEUE } from './connectors/connectors.types';
import { StoreResolver } from './connectors/connectors.util';
import { MetaLeadsController } from './connectors/meta-leads.controller';
import { MetaLeadsService } from './connectors/meta-leads.service';
import { MercadoLivreService } from './connectors/mercadolivre.service';
import { SiteLeadController } from './connectors/site.controller';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({ timeout: 15000 }),
    BullModule.registerQueue({ name: WHATSAPP_QUEUE }, { name: CRM_LEADS_QUEUE }),
  ],
  controllers: [CrmController, WhatsappController, SiteLeadController, MetaLeadsController, ConnectorsController],
  providers: [
    LeadIntakeService,
    CrmService,
    FunnelService,
    LeadConversionService,
    CrmDashboardService,
    WhatsappTemplateService,
    CrmSettingsService,
    QuickReplyService,
    ReminderService,
    LeadListService,
    FollowupScheduler,
    CrmListener,
    WhatsappService,
    WhatsappWebhookProcessor,
    StoreResolver,
    MetaLeadsService,
    MercadoLivreService,
    ConnectorsProcessor,
  ],
  exports: [
    LeadIntakeService,
    CrmService,
    FunnelService,
    LeadConversionService,
    CrmDashboardService,
    WhatsappService,
    WhatsappTemplateService,
  ],
})
export class CrmModule {}
