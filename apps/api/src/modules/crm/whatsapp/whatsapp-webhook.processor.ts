import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LeadActivityType,
  LeadSource,
  Prisma,
  WaMessageDirection,
  WaMessageStatus,
  WaMessageType,
} from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeadIntakeService } from '../lead-intake.service';
import { WA_WINDOW_MS, WhatsappService } from './whatsapp.service';
import { TranscriptionService } from './transcription.service';
import {
  WHATSAPP_QUEUE,
  WhatsappChangeValue,
  WhatsappInboundMessage,
  WhatsappWebhookJobData,
} from './whatsapp.types';

/** prefixo que marca, na conversa e no histórico do SDR, um áudio transcrito */
export const AUDIO_TRANSCRIPT_PREFIX = '[áudio transcrito]';

const STATUS_MAP: Record<string, WaMessageStatus> = {
  sent: WaMessageStatus.SENT,
  delivered: WaMessageStatus.DELIVERED,
  read: WaMessageStatus.READ,
  failed: WaMessageStatus.FAILED,
};

// read > delivered > sent — a Meta pode entregar status fora de ordem
const STATUS_RANK: Record<WaMessageStatus, number> = {
  [WaMessageStatus.PENDING]: 0,
  [WaMessageStatus.SENT]: 1,
  [WaMessageStatus.DELIVERED]: 2,
  [WaMessageStatus.READ]: 3,
  [WaMessageStatus.FAILED]: 4,
};

const TYPE_MAP: Record<string, WaMessageType> = {
  text: WaMessageType.TEXT,
  audio: WaMessageType.AUDIO,
  image: WaMessageType.IMAGE,
  video: WaMessageType.VIDEO,
  document: WaMessageType.DOCUMENT,
  sticker: WaMessageType.STICKER,
  location: WaMessageType.LOCATION,
  contacts: WaMessageType.CONTACTS,
};

/**
 * F1.2 (#508) — processamento assíncrono do webhook da Cloud API.
 * O controller responde 200 imediato à Meta; aqui roda o trabalho de verdade:
 * mensagem de número desconhecido vira lead (via LeadIntakeService, origem
 * WHATSAPP, loja resolvida pelo phone_number_id), janela de 24h renovada,
 * status de entrega atualizado. Idempotente por waMessageId.
 */
@Injectable()
@Processor(WHATSAPP_QUEUE)
export class WhatsappWebhookProcessor {
  private readonly logger = new Logger(WhatsappWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadIntake: LeadIntakeService,
    private readonly eventEmitter: EventEmitter2,
    private readonly whatsapp: WhatsappService,
    private readonly transcription: TranscriptionService,
  ) {}

  @Process('inbound')
  async handleInbound(job: Job<WhatsappWebhookJobData>): Promise<void> {
    const entries = job.data.body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages' || !change.value) continue;
        await this.processChange(change.value);
      }
    }
  }

  private async processChange(value: WhatsappChangeValue): Promise<void> {
    for (const status of value.statuses ?? []) {
      await this.applyStatus(status);
    }

    const messages = value.messages ?? [];
    if (messages.length === 0) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const company = phoneNumberId
      ? await this.prisma.company.findUnique({
          where: { waPhoneNumberId: phoneNumberId },
          select: { id: true },
        })
      : null;
    if (!company) {
      this.logger.warn(
        `Mensagem recebida p/ phone_number_id desconhecido (${phoneNumberId}) — ignorando`,
      );
      return;
    }

    for (const message of messages) {
      await this.processMessage(company.id, value, message);
    }
  }

  private async processMessage(
    companyId: string,
    value: WhatsappChangeValue,
    message: WhatsappInboundMessage,
  ): Promise<void> {
    const from = message.from;
    if (!from || !message.id) return;

    const profileName = value.contacts?.find((c) => c.wa_id === from)?.profile?.name;

    // lead + conversa (intake cuida do dedup/rodízio; repetido só registra atividade)
    const { lead } = await this.leadIntake.intake(companyId, {
      phone: from,
      name: profileName,
      source: LeadSource.WHATSAPP,
    });

    const receivedAt = message.timestamp
      ? new Date(parseInt(message.timestamp, 10) * 1000)
      : new Date();
    const windowExpiresAt = new Date(receivedAt.getTime() + WA_WINDOW_MS);

    const conversation = await this.prisma.whatsappConversation.upsert({
      where: { leadId: lead.id },
      create: {
        companyId,
        leadId: lead.id,
        waContactId: from,
        lastCustomerMessageAt: receivedAt,
        lastMessageAt: receivedAt,
        windowExpiresAt,
        unreadCount: 1,
      },
      update: {
        lastCustomerMessageAt: receivedAt,
        lastMessageAt: receivedAt,
        windowExpiresAt,
        unreadCount: { increment: 1 },
      },
    });

    const media = message.audio ?? message.image ?? message.video ?? message.document ?? message.sticker;
    let text =
      message.text?.body ??
      message.image?.caption ??
      message.video?.caption ??
      message.document?.caption ??
      (message.location
        ? `[localização] ${message.location.name ?? ''} ${message.location.latitude},${message.location.longitude}`
        : null);

    // F1 voz (#506/#567): voice note do lead → transcreve e persiste no texto
    // da mensagem, marcado com o prefixo. Assim o histórico que o SDR monta
    // (sdr-agent.service) já enxerga o áudio como texto e responde normalmente.
    // Sem OPENAI_API_KEY, limite estourado ou falha → text segue null e o SDR
    // mantém o comportamento atual (avisa que vai passar pro vendedor).
    if (TYPE_MAP[message.type ?? ''] === WaMessageType.AUDIO && message.audio?.id) {
      const transcript = await this.transcribeInboundAudio(
        message.audio.id,
        message.audio.mime_type,
      );
      if (transcript) text = `${AUDIO_TRANSCRIPT_PREFIX} ${transcript}`;
    }

    try {
      await this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WaMessageDirection.IN,
          type: TYPE_MAP[message.type ?? 'text'] ?? WaMessageType.UNSUPPORTED,
          text,
          waMessageId: message.id,
          waMediaId: media?.id ?? null,
          mediaMimeType: media?.mime_type ?? null,
          status: WaMessageStatus.DELIVERED,
        },
      });
    } catch (e) {
      // retry da Meta reenvia o mesmo wamid — constraint garante 1 registro só
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.log(`wamid ${message.id} já processado — retry da Meta ignorado`);
        return;
      }
      throw e;
    }

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        lastInteractionAt: receivedAt,
        activities: {
          create: {
            type: LeadActivityType.MESSAGE_IN,
            happensAt: receivedAt,
            properties: { waMessageId: message.id, preview: (text ?? '[mídia]').slice(0, 140) },
          },
        },
      },
    });

    this.eventEmitter.emit('crm.whatsapp.message_received', {
      leadId: lead.id,
      companyId,
      waMessageId: message.id,
    });
  }

  /**
   * Baixa a mídia de áudio da Meta e transcreve (F1 voz). Blindado: qualquer
   * erro (download, rede, STT) vira null — o processamento do webhook nunca
   * pode falhar por causa da transcrição.
   */
  private async transcribeInboundAudio(
    mediaId: string,
    mimeType?: string,
  ): Promise<string | null> {
    if (!this.transcription.isEnabled()) return null; // sem key: nem baixa a mídia
    try {
      const { data, mimeType: fetchedMime } = await this.whatsapp.downloadMediaById(mediaId);
      return await this.transcription.transcribe(data, mimeType ?? fetchedMime);
    } catch (err) {
      this.logger.warn(
        `Transcrição de áudio inbound falhou (media ${mediaId}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async applyStatus(status: {
    id?: string;
    status?: string;
    timestamp?: string;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }): Promise<void> {
    if (!status.id || !status.status) return;
    const mapped = STATUS_MAP[status.status];
    if (!mapped) return;

    const existing = await this.prisma.whatsappMessage.findUnique({
      where: { waMessageId: status.id },
      select: { id: true, status: true },
    });
    if (!existing) return; // status de mensagem que não conhecemos (ex: enviada fora do ERP)
    if (STATUS_RANK[mapped] <= STATUS_RANK[existing.status]) return; // fora de ordem

    await this.prisma.whatsappMessage.update({
      where: { id: existing.id },
      data: {
        status: mapped,
        statusAt: status.timestamp
          ? new Date(parseInt(status.timestamp, 10) * 1000)
          : new Date(),
        ...(mapped === WaMessageStatus.FAILED && status.errors?.length
          ? { errorDetail: JSON.stringify(status.errors).slice(0, 1000) }
          : {}),
      },
    });
  }
}
