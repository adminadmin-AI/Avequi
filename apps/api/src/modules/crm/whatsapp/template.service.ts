import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LeadActivityType, WaMessageDirection, WaMessageStatus, WaMessageType } from '@prisma/client';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * F3.2 (#518) — templates aprovados p/ reengajar lead fora da janela de 24h.
 * Único ponto do CRM com custo variável (mensagem template da Meta). A resposta
 * do cliente ao template reabre a janela → conversa livre de novo (o webhook
 * de inbound já cuida disso).
 */
@Injectable()
export class WhatsappTemplateService {
  private readonly logger = new Logger(WhatsappTemplateService.name);

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

  /** Templates aprovados da loja (select do inbox) */
  listApproved(companyId: string) {
    return this.prisma.whatsappTemplate.findMany({
      where: { companyId, isActive: true, status: 'APPROVED' },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Sincroniza templates do Meta Business (WABA) → tabela local. Reflete
   * status de aprovação (APPROVED/PENDING/REJECTED). Idempotente por nome+idioma.
   */
  async sync(companyId: string): Promise<{ synced: number }> {
    const wabaId = this.config.get<string>('WHATSAPP_WABA_ID');
    if (!wabaId) throw new BadRequestException('WHATSAPP_WABA_ID não configurado');

    let data: any;
    try {
      const resp = await firstValueFrom(
        this.http.get(`${this.graphBase()}/${wabaId}/message_templates`, {
          params: { access_token: this.accessToken(), limit: 100 },
        }),
      );
      data = resp.data;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      throw new BadRequestException(
        `Falha ao sincronizar templates: ${axiosErr.response?.data?.error?.message ?? axiosErr.message}`,
      );
    }

    let synced = 0;
    for (const tpl of data?.data ?? []) {
      const body = (tpl.components ?? []).find((c: any) => c.type === 'BODY');
      const bodyText: string | undefined = body?.text;
      const variableCount = bodyText ? (bodyText.match(/\{\{\d+\}\}/g) ?? []).length : 0;
      await this.prisma.whatsappTemplate.upsert({
        where: {
          companyId_name_language: {
            companyId,
            name: tpl.name,
            language: tpl.language ?? 'pt_BR',
          },
        },
        create: {
          companyId,
          name: tpl.name,
          language: tpl.language ?? 'pt_BR',
          category: tpl.category ?? null,
          status: tpl.status ?? 'PENDING',
          bodyText: bodyText ?? null,
          variableCount,
        },
        update: {
          category: tpl.category ?? null,
          status: tpl.status ?? 'PENDING',
          bodyText: bodyText ?? null,
          variableCount,
        },
      });
      synced += 1;
    }
    return { synced };
  }

  /**
   * Envia um template pro lead (usado quando a janela de 24h expirou). Custa
   * (marca isTemplate=true p/ o custo do dashboard). Variáveis preenchem os
   * placeholders {{1}}, {{2}}... na ordem.
   */
  async sendTemplate(
    companyId: string,
    leadId: string,
    templateName: string,
    variables: string[],
    senderId: string,
  ) {
    const [conversation, template, company] = await Promise.all([
      this.prisma.whatsappConversation.findFirst({ where: { leadId, companyId } }),
      this.prisma.whatsappTemplate.findFirst({
        where: { companyId, name: templateName, isActive: true, status: 'APPROVED' },
      }),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { waPhoneNumberId: true },
      }),
    ]);
    if (!conversation) throw new NotFoundException('Lead não tem conversa de WhatsApp');
    if (!template) throw new BadRequestException('Template não encontrado ou não aprovado');
    if (!company?.waPhoneNumberId) throw new BadRequestException('Loja sem número de WhatsApp');
    if ((variables?.length ?? 0) !== template.variableCount) {
      throw new BadRequestException(
        `Template exige ${template.variableCount} variável(is), recebidas ${variables?.length ?? 0}`,
      );
    }

    const components =
      template.variableCount > 0
        ? [
            {
              type: 'body',
              parameters: variables.map((v) => ({ type: 'text', text: v })),
            },
          ]
        : [];

    let waMessageId: string | null = null;
    try {
      const resp = await firstValueFrom(
        this.http.post(
          `${this.graphBase()}/${company.waPhoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: conversation.waContactId,
            type: 'template',
            template: {
              name: template.name,
              language: { code: template.language },
              ...(components.length ? { components } : {}),
            },
          },
          { headers: { Authorization: `Bearer ${this.accessToken()}` } },
        ),
      );
      waMessageId = resp.data?.messages?.[0]?.id ?? null;
    } catch (err) {
      const axiosErr = err as AxiosError<any>;
      throw new BadRequestException(
        `Meta recusou o template: ${axiosErr.response?.data?.error?.message ?? axiosErr.message}`,
      );
    }

    const now = new Date();
    const preview = this.renderPreview(template.bodyText, variables);
    const [message] = await this.prisma.$transaction([
      this.prisma.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          direction: WaMessageDirection.OUT,
          type: WaMessageType.TEXT,
          text: preview,
          waMessageId,
          status: WaMessageStatus.SENT,
          statusAt: now,
          sentById: senderId,
          isTemplate: true,
          templateName: template.name,
        },
      }),
      this.prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: {
          lastInteractionAt: now,
          activities: {
            create: {
              type: LeadActivityType.MESSAGE_OUT,
              actorId: senderId,
              properties: { template: template.name, isTemplate: true, preview: preview.slice(0, 140) },
            },
          },
        },
      }),
    ]);

    this.eventEmitter.emit('crm.whatsapp.template_sent', {
      leadId,
      companyId,
      templateName: template.name,
      messageId: message.id,
    });
    return message;
  }

  private renderPreview(bodyText: string | null, variables: string[]): string {
    if (!bodyText) return `[template com ${variables.length} variável(is)]`;
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => variables[Number(n) - 1] ?? `{{${n}}}`);
  }
}
