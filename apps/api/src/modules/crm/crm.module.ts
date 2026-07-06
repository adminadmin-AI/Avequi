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

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({ timeout: 15000 }),
    BullModule.registerQueue({ name: WHATSAPP_QUEUE }),
  ],
  controllers: [CrmController, WhatsappController],
  providers: [LeadIntakeService, CrmService, WhatsappService, WhatsappWebhookProcessor],
  exports: [LeadIntakeService, CrmService, WhatsappService],
})
export class CrmModule {}
