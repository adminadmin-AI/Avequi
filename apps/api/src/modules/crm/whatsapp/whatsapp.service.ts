import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LeadActivityType,
  WaMessageDirection,
  WaMessageStatus,
  WaMessageType,
} from '@prisma/client';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { webmOpusToOgg } from './audio.util';

/** Janela de atendimento da Meta: 24h após a última mensagem do cliente */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SendMessageInput {
  text?: string;
  /** URL pública da mídia (imagem/áudio/documento) — enviada como link */
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'document';
  caption?: string;
  filename?: string;
}

/**
 * F1.2 (#508) — envio livre pela WhatsApp Cloud API (número da loja).
 * Regra de ouro: dentro da janela de 24h a resposta é 100% livre e gratuita;
 * fora dela a Meta exige template (F3.2) — aqui devolvemos erro orientado.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private graphBase(): string {
    const version = this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v21.0';
    const base = this.config.get<string>('WHATSAPP_GRAPH_BASE_URL') ?? 'https://graph.facebook.com';
    return `${base}/${version}`;
  }

  private accessToken(): string {
    const token = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    if (!token) throw new BadRequestException('WHATSAPP_ACCESS_TOKEN não configurado');
    return token;
  }

  /** Envio livre na conversa do lead. Exige janela de 24h aberta. */
  async send(companyId: string, leadId: string, input: SendMessageInput, senderId: string) {
    if (!input.text && !input.mediaUrl) {
      throw new BadRequestException('Informe text ou mediaUrl');
    }
    const conversation = await this.prisma.whatsappConversation.findFirst({
      where: { leadId, companyId },
      include: { lead: { select: { id: true, firstRespondedAt: true } } },
    });
    if (!conversation) throw new NotFoundException('Lead não tem conversa de WhatsApp');

    if (!conversation.windowExpiresAt || conversation.windowExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Janela de 24h expirada — use uma mensagem template p/ retomar o contato (F3.2 #518)',
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { waPhoneNumberId: true },
    });
    if (!company?.waPhoneNumberId) {
      throw new BadRequestException('Loja sem número de WhatsApp configurado (waPhoneNumberId)');
    }

    const payload = this.buildOutboundPayload(conversation.waContactId, input);
    let waMessageId: string | null = null;
    try {
      const resp = await firstValueFrom(
        this.http.post(
          `${this.graphBase()}/${company.waPhoneNumberId}/messages`,
          payload,
          { headers: { Authorization: `Bearer ${this.accessToken()}` } },
        ),
      );
      waMessageId = resp.data?.messages?.[0]?.id ?? null;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      const detail = axiosErr.response?.data?.error?.message ?? axiosErr.message;
      this.logger.error(`Falha no envio WhatsApp (lead ${leadId}): ${detail}`);
      throw new BadRequestException(`Meta recusou o envio: ${detail}`);
    }

    const now = new Date();
    const [message] = await this.prisma.$transaction([
      this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WaMessageDirection.OUT,
          type: this.outboundType(input),
          text: input.text ?? input.caption ?? null,
          mediaUrl: input.mediaUrl ?? null,
          waMessageId,
          status: WaMessageStatus.SENT,
          statusAt: now,
          sentById: senderId,
        },
      }),
      this.prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, unreadCount: 0 },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastInteractionAt: now,
          // primeira resposta humana/IA — métrica de SLA (F2.3)
          ...(conversation.lead.firstRespondedAt ? {} : { firstRespondedAt: now }),
          activities: {
            create: {
              type: LeadActivityType.MESSAGE_OUT,
              actorId: senderId,
              properties: { waMessageId, preview: (input.text ?? input.caption ?? '[mídia]').slice(0, 140) },
            },
          },
        },
      }),
    ]);

    this.eventEmitter.emit('crm.whatsapp.message_sent', {
      leadId,
      companyId,
      messageId: message.id,
    });
    return message;
  }

  /** Mensagens da conversa (inbox F1.3) — zera não-lidas */
  async listMessages(companyId: string, leadId: string, take = 50, before?: string) {
    const conversation = await this.prisma.whatsappConversation.findFirst({
      where: { leadId, companyId },
    });
    if (!conversation) throw new NotFoundException('Lead não tem conversa de WhatsApp');
    const messages = await this.prisma.whatsappMessage.findMany({
      where: {
        conversationId: conversation.id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    await this.prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
    });
    return { conversation, messages: messages.reverse() };
  }

  /**
   * Proxy de mídia: baixa da Meta sob demanda (padrão do export de XML fiscal).
   * Meta expira URLs de mídia — por isso guardamos o media id e buscamos na hora.
   */
  async fetchMedia(companyId: string, messageId: string) {
    const message = await this.prisma.whatsappMessage.findFirst({
      where: { id: messageId, conversation: { companyId } },
    });
    if (!message?.waMediaId) throw new NotFoundException('Mensagem sem mídia');

    const meta = await firstValueFrom(
      this.http.get(`${this.graphBase()}/${message.waMediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken()}` },
      }),
    );
    const binary = await firstValueFrom(
      this.http.get(meta.data.url, {
        headers: { Authorization: `Bearer ${this.accessToken()}` },
        responseType: 'arraybuffer',
      }),
    );
    return {
      data: Buffer.from(binary.data),
      mimeType: message.mediaMimeType ?? meta.data.mime_type ?? 'application/octet-stream',
    };
  }

  /**
   * F3.5-C2 (#552) — envio de mídia pelo vendedor. Sobe o arquivo pra Media API
   * da Meta (devolve media id) e envia por id — sem precisar de storage público.
   * O media id fica guardado; o proxy fetchMedia baixa de volta pra exibir.
   */
  async sendUploadedMedia(
    companyId: string,
    leadId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    caption: string | undefined,
    senderId: string,
  ) {
    file = await this.normalizeOutboundAudio(file);
    const kind = this.mediaKind(file.mimetype);
    this.assertMediaLimits(kind, file.size);

    const conversation = await this.prisma.whatsappConversation.findFirst({
      where: { leadId, companyId },
      include: { lead: { select: { id: true, firstRespondedAt: true } } },
    });
    if (!conversation) throw new NotFoundException('Lead não tem conversa de WhatsApp');
    if (!conversation.windowExpiresAt || conversation.windowExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Janela de 24h expirada — só é possível enviar template');
    }
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { waPhoneNumberId: true },
    });
    if (!company?.waPhoneNumberId) throw new BadRequestException('Loja sem número de WhatsApp');

    // 1. upload pra Media API da Meta → media id
    let mediaId: string;
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', file.mimetype);
      // Uint8Array satisfaz BlobPart — Buffer não (tipagem SharedArrayBuffer do Node 22)
      form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
      const up = await firstValueFrom(
        this.http.post(`${this.graphBase()}/${company.waPhoneNumberId}/media`, form, {
          headers: { Authorization: `Bearer ${this.accessToken()}` },
        }),
      );
      mediaId = up.data?.id;
      if (!mediaId) throw new Error('Meta não devolveu media id');
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      this.logger.error(`Falha no upload de mídia (lead ${leadId}): ${axiosErr.message}`);
      throw new BadRequestException(
        `Falha no upload: ${axiosErr.response?.data?.error?.message ?? axiosErr.message}`,
      );
    }

    // 2. envia a mensagem referenciando o media id
    const media: Record<string, unknown> = { id: mediaId };
    if (caption && kind !== 'audio') media.caption = caption;
    if (kind === 'document') media.filename = file.originalname;

    let waMessageId: string | null = null;
    try {
      const resp = await firstValueFrom(
        this.http.post(
          `${this.graphBase()}/${company.waPhoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to: conversation.waContactId, type: kind, [kind]: media },
          { headers: { Authorization: `Bearer ${this.accessToken()}` } },
        ),
      );
      waMessageId = resp.data?.messages?.[0]?.id ?? null;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      throw new BadRequestException(
        `Meta recusou o envio: ${axiosErr.response?.data?.error?.message ?? axiosErr.message}`,
      );
    }

    const now = new Date();
    const typeEnum = this.outboundType({ mediaUrl: 'x', mediaType: kind });
    const [message] = await this.prisma.$transaction([
      this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WaMessageDirection.OUT,
          type: typeEnum,
          text: caption ?? null,
          waMediaId: mediaId,
          mediaMimeType: file.mimetype,
          waMessageId,
          status: WaMessageStatus.SENT,
          statusAt: now,
          sentById: senderId,
        },
      }),
      this.prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, unreadCount: 0 },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastInteractionAt: now,
          ...(conversation.lead.firstRespondedAt ? {} : { firstRespondedAt: now }),
          activities: {
            create: {
              type: LeadActivityType.MESSAGE_OUT,
              actorId: senderId,
              properties: { waMessageId, media: kind, preview: caption?.slice(0, 140) ?? `[${kind}]` },
            },
          },
        },
      }),
    ]);
    this.eventEmitter.emit('crm.whatsapp.message_sent', { leadId, companyId, messageId: message.id });
    return message;
  }

  /**
   * F3.5-C6 (#556) — áudio gravado no Chrome vem como audio/webm, que a Meta
   * recusa. Remux p/ ogg (mesmo codec opus, só troca o container); os demais
   * formatos de gravação (mp4/aac do Safari, ogg do Firefox) passam direto.
   */
  private async normalizeOutboundAudio(file: {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
  }) {
    if (!file.mimetype.toLowerCase().startsWith('audio/webm')) return file;
    try {
      const ogg = await webmOpusToOgg(file.buffer);
      return {
        buffer: ogg,
        mimetype: 'audio/ogg',
        originalname: file.originalname.replace(/\.webm$/i, '') + '.ogg',
        size: ogg.length,
      };
    } catch (err) {
      this.logger.error(`Conversão webm→ogg falhou: ${(err as Error).message}`);
      throw new BadRequestException(
        'Não foi possível converter o áudio — tente anexar um arquivo mp3/m4a',
      );
    }
  }

  /** image | audio | document a partir do mime; vídeo entra como document p/ simplificar */
  private mediaKind(mime: string): 'image' | 'audio' | 'document' {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }

  /** limites da Meta: imagem 5MB, áudio 16MB, documento 100MB */
  private assertMediaLimits(kind: 'image' | 'audio' | 'document', size: number) {
    const limits = { image: 5, audio: 16, document: 100 };
    const maxMb = limits[kind];
    if (size > maxMb * 1024 * 1024) {
      throw new BadRequestException(`Arquivo excede o limite de ${maxMb}MB para ${kind}`);
    }
  }

  private buildOutboundPayload(to: string, input: SendMessageInput): Record<string, unknown> {
    if (input.mediaUrl) {
      const kind = input.mediaType ?? 'image';
      const media: Record<string, unknown> = { link: input.mediaUrl };
      if (input.caption && kind !== 'audio') media.caption = input.caption;
      if (input.filename && kind === 'document') media.filename = input.filename;
      return { messaging_product: 'whatsapp', to, type: kind, [kind]: media };
    }
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: input.text, preview_url: true },
    };
  }

  private outboundType(input: SendMessageInput): WaMessageType {
    if (!input.mediaUrl) return WaMessageType.TEXT;
    switch (input.mediaType) {
      case 'audio':
        return WaMessageType.AUDIO;
      case 'document':
        return WaMessageType.DOCUMENT;
      default:
        return WaMessageType.IMAGE;
    }
  }
}
