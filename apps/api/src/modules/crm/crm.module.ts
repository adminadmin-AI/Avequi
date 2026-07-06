import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
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
    WhatsappService,
    WhatsappWebhookProcessor,
    StoreResolver,
    MetaLeadsService,
    MercadoLivreService,
    ConnectorsProcessor,
  ],
  exports: [LeadIntakeService, CrmService, WhatsappService],
})
export class CrmModule {}
