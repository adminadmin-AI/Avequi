import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import Anthropic from '@anthropic-ai/sdk';
import { LeadActivityType, Prisma, SdrLeadStatus, WaMessageDirection } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CrmSettingsService } from '../crm-settings.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SDR_SYSTEM_PROMPT } from './sdr-prompt';
import { SDR_TOOLS, SdrToolsService } from './sdr-tools';
import { isWithinSdrWindow, validatePriceGrounding } from './sdr-guardrails';
import {
  SDR_ACTOR,
  SDR_CACHE_TTL,
  addUsage,
  emptyUsage,
  estimateCostUsd,
  totalCacheWrite,
} from './sdr.types';

/** iterações máximas do loop de tools num único turno (proteção de runaway) */
const MAX_TOOL_ITERATIONS = 6;
/** circuit breaker (#523): N falhas consecutivas → abre por M minutos */
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 5 * 60_000;
/** histórico enviado pro modelo (mensagens mais recentes) */
const HISTORY_LIMIT = 40;

/**
 * F4.1 (#521) — núcleo do SDR IA: agente conversacional Claude que atende
 * lead novo no WhatsApp em segundos. Listener de crm.lead.created (origem
 * WHATSAPP) e de crm.whatsapp.message_received (demais origens quando o
 * cliente chamar). Vendedor digitar na conversa = takeover implícito.
 *
 * Degradação graciosa (#523): o rodízio humano da captação (F1.7) SEMPRE
 * atribui vendedor — a IA atua por cima. API fora → handoff silencioso,
 * nenhuma mensagem quebrada chega ao cliente.
 */
@Injectable()
export class SdrAgentService {
  private readonly logger = new Logger(SdrAgentService.name);
  private client: Anthropic | null = null;
  private breaker = { failures: 0, openUntil: 0 };
  /** lock por lead — evita turnos concorrentes na mesma conversa */
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: CrmSettingsService,
    private readonly whatsapp: WhatsappService,
    private readonly tools: SdrToolsService,
  ) {}

  // ── Listeners ───────────────────────────────────────────────────────────────

  /** Lead novo de WhatsApp: a 1ª mensagem do cliente já está na conversa */
  @OnEvent('crm.lead.created', { async: true })
  async onLeadCreated(payload: { leadId: string; companyId: string; source: string }) {
    if (payload.source !== 'WHATSAPP') return; // outras origens: IA entra quando o cliente chamar
    await this.attend(payload.companyId, payload.leadId);
  }

  /** Mensagem do cliente chegou (webhook F1.2) → turno da IA se em modo SDR */
  @OnEvent('crm.whatsapp.message_received', { async: true })
  async onMessageReceived(payload: { leadId: string; companyId: string }) {
    await this.attend(payload.companyId, payload.leadId);
  }

  /** Takeover implícito (#521/#524): humano digitou → IA silencia NA HORA */
  @OnEvent('crm.whatsapp.message_sent', { async: true })
  async onMessageSent(payload: { leadId: string; senderId?: string | null }) {
    if (!payload.senderId || payload.senderId === SDR_ACTOR) return;
    await this.takeover(payload.leadId, payload.senderId);
  }

  /** Silencia a IA na conversa (implícito ao digitar ou explícito no painel #524) */
  async takeover(leadId: string, actorId: string): Promise<boolean> {
    // tenant-lint: ok (leadId vem de evento interno (webhook do conector), nunca de input do usuário)
    const updated = await this.prisma.lead.updateMany({
      where: { id: leadId, sdrStatus: { in: [SdrLeadStatus.ACTIVE, SdrLeadStatus.QUALIFIED] } },
      data: { sdrStatus: SdrLeadStatus.HANDOFF },
    });
    if (updated.count > 0) {
      this.logger.log(`Takeover do lead ${leadId} por ${actorId} — SDR silenciado`);
      await this.prisma.leadActivity
        .create({
          data: {
            leadId,
            type: LeadActivityType.NOTE,
            actorId,
            properties: { kind: 'sdr_takeover', preview: '👤 assumiu a conversa — IA silenciada' },
          },
        })
        .catch(() => undefined);
    }
    return updated.count > 0;
  }

  // ── Turno de conversa ───────────────────────────────────────────────────────

  private async attend(companyId: string, leadId: string): Promise<void> {
    if (this.busy.has(leadId)) return; // turno em andamento nessa conversa
    this.busy.add(leadId);
    try {
      await this.runTurn(companyId, leadId);
    } catch (err) {
      this.logger.error(`Turno SDR do lead ${leadId} falhou: ${(err as Error).message}`);
    } finally {
      this.busy.delete(leadId);
    }
  }

  private async runTurn(companyId: string, leadId: string): Promise<void> {
    // kill switch por company (#523) + demais elegibilidades
    const cfg = await this.settings.get(companyId);
    if (!cfg.sdrEnabled) return;
    if (!this.apiKey()) return; // sem key = fluxo humano intocado
    if (Date.now() < this.breaker.openUntil) return; // circuit breaker aberto
    if (!isWithinSdrWindow(cfg.sdrSchedule)) return;

    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: {
        id: true,
        name: true,
        source: true,
        sdrStatus: true,
        anonymizedAt: true,
        conversation: {
          select: {
            id: true,
            windowExpiresAt: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: HISTORY_LIMIT,
              select: { direction: true, type: true, text: true, sentById: true },
            },
          },
        },
      },
    });
    if (!lead || lead.anonymizedAt || !lead.conversation) return;
    if (
      lead.sdrStatus === SdrLeadStatus.HANDOFF ||
      lead.sdrStatus === SdrLeadStatus.DISCARDED
    )
      return; // humano assumiu ou descartado — IA fica quieta
    if (!lead.conversation.windowExpiresAt || lead.conversation.windowExpiresAt.getTime() < Date.now()) return;

    const history = [...lead.conversation.messages].reverse();
    if (history.length === 0 || history[history.length - 1].direction !== WaMessageDirection.IN) {
      return; // só responde a mensagem do CLIENTE
    }

    // primeira vez? marca modo SDR_ATIVO
    if (lead.sdrStatus == null) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { sdrStatus: SdrLeadStatus.ACTIVE },
      });
    }

    // handoff garantido por nº de trocas (#523)
    const aiTurns = history.filter(
      (m) => m.direction === WaMessageDirection.OUT && m.sentById === SDR_ACTOR,
    ).length;
    if (aiTurns >= cfg.sdrMaxTurns) {
      await this.forcedHandoff(companyId, leadId, `limite de ${cfg.sdrMaxTurns} trocas da IA atingido`, true);
      return;
    }

    const messages = this.buildMessages(lead.name, lead.source, history);

    let finalText: string;
    let toolPrices: string[];
    let terminal: boolean;
    try {
      ({ finalText, toolPrices, terminal } = await this.converse(companyId, leadId, cfg.sdrModel, messages));
      this.breaker.failures = 0; // sucesso fecha o breaker
    } catch (err) {
      this.registerApiFailure(err);
      // degradação graciosa (#523): handoff silencioso, cliente não vê erro
      await this.forcedHandoff(companyId, leadId, 'IA indisponível (falha na API)', false);
      return;
    }

    if (!finalText.trim()) return; // descarte/handoff sem despedida — nada a enviar

    // guardrail de preço em código (#523): preço sem tool → bloqueia e transfere
    const priceCheck = validatePriceGrounding(finalText, toolPrices);
    if (!priceCheck.ok) {
      await this.logIncident(leadId, finalText, priceCheck.offending);
      await this.forcedHandoff(companyId, leadId, 'guardrail: preço não fundamentado em tool', true);
      return;
    }

    try {
      await this.whatsapp.send(companyId, leadId, { text: finalText }, SDR_ACTOR);
    } catch (err) {
      this.logger.warn(`Envio da resposta SDR falhou (lead ${leadId}): ${(err as Error).message}`);
      return;
    }

    // handoff/descarte aconteceu via tool: status já persistido pelo SdrToolsService
    if (terminal) this.logger.log(`SDR encerrou atuação no lead ${leadId}`);
  }

  // ── Loop com a API do Claude ────────────────────────────────────────────────

  private async converse(
    companyId: string,
    leadId: string,
    model: string,
    messages: Anthropic.Messages.MessageParam[],
  ): Promise<{ finalText: string; toolPrices: string[]; terminal: boolean }> {
    const client = this.getClient();
    const usage = emptyUsage();
    const toolPrices: string[] = [];
    let terminal = false;

    let response: Anthropic.Messages.Message | null = null;
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        // system CONGELADO + cache_control → prefix cache (tools+system juntos).
        // TTL de 1h: este prefixo é o mesmo para TODA conversa de TODO lead, então
        // uma escrita serve várias conversas seguidas. Ver SDR_CACHE_TTL.
        system: [
          {
            type: 'text',
            text: SDR_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral', ttl: SDR_CACHE_TTL },
          },
        ],
        tools: SDR_TOOLS,
        messages,
      });

      addUsage(usage, response.usage);

      if (response.stop_reason !== 'tool_use') break;

      // executa TODAS as tool calls e devolve os resultados num ÚNICO user
      // message (dividir quebra o paralelismo do modelo)
      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      const outcomes = await Promise.all(
        toolUses.map((t) => this.tools.execute(companyId, leadId, t.name, t.input)),
      );
      for (const o of outcomes) {
        toolPrices.push(...o.prices);
        terminal = terminal || o.terminal;
      }
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: toolUses.map((t, idx) => ({
          type: 'tool_result' as const,
          tool_use_id: t.id,
          content: outcomes[idx].result,
        })),
      });
    }

    // custo por conversa (#521/#524)
    await this.prisma.sdrUsage
      .create({
        data: {
          companyId,
          leadId,
          model,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          cacheCreationTokens: totalCacheWrite(usage),
          costUsd: new Prisma.Decimal(estimateCostUsd(model, usage).toFixed(6)),
        },
      })
      .catch((err) => this.logger.warn(`Log de usage falhou: ${(err as Error).message}`));

    const finalText = (response?.content ?? [])
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { finalText, toolPrices, terminal };
  }

  /**
   * Monta o histórico pro modelo. O bloco [CONTEXTO] é DETERMINÍSTICO por
   * conversa (sem timestamp!) — prefixo estável = cache aproveitado.
   */
  private buildMessages(
    leadName: string | null,
    source: string,
    history: Array<{ direction: WaMessageDirection; type: string; text: string | null; sentById: string | null }>,
  ): Anthropic.Messages.MessageParam[] {
    const context = `[CONTEXTO DO ATENDIMENTO]\nCliente: ${leadName ?? 'não informado'}\nOrigem do lead: ${source}\nAs mensagens a seguir são a conversa de WhatsApp com o cliente.`;

    const messages: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: context }] },
    ];
    for (const m of history) {
      const text = m.text?.trim() || `[cliente enviou ${m.type.toLowerCase()}]`;
      messages.push({
        role: m.direction === WaMessageDirection.IN ? 'user' : 'assistant',
        content: text,
      });
    }
    // breakpoint no fim do histórico: a conversa inteira vira prefixo cacheado.
    // TTL de 1h porque o cliente some por mais de 5min no meio da conversa.
    const last = messages[messages.length - 1];
    last.content = [
      {
        type: 'text',
        text: last.content as string,
        cache_control: { type: 'ephemeral', ttl: SDR_CACHE_TTL },
      },
    ];
    return messages;
  }

  // ── Degradação, incidentes e breaker (#523) ────────────────────────────────

  /** Handoff forçado (timeout de trocas, guardrail ou API fora) */
  private async forcedHandoff(
    companyId: string,
    leadId: string,
    motivo: string,
    sendTransition: boolean,
  ): Promise<void> {
    try {
      await this.tools.execute(companyId, leadId, 'transferir_para_vendedor', {
        motivo,
        resumoConversa: 'Transferência automática — veja a conversa no inbox.',
      });
      if (sendTransition) {
        await this.whatsapp
          .send(
            companyId,
            leadId,
            { text: 'Vou te passar pra um vendedor da nossa equipe continuar por aqui, já te atende! 👍' },
            SDR_ACTOR,
          )
          .catch(() => undefined); // janela pode ter fechado — silencioso
      }
    } catch (err) {
      this.logger.error(`Handoff forçado do lead ${leadId} falhou: ${(err as Error).message}`);
    }
  }

  /** Incidente de guardrail (#523/#524): resposta bloqueada ANTES do envio */
  private async logIncident(leadId: string, blockedText: string, offending: number[]): Promise<void> {
    this.logger.warn(`Guardrail de preço bloqueou resposta ao lead ${leadId}: ${offending.join(', ')}`);
    await this.prisma.leadActivity
      .create({
        data: {
          leadId,
          type: LeadActivityType.NOTE,
          actorId: SDR_ACTOR,
          properties: {
            kind: 'sdr_guardrail_incident',
            rule: 'price_grounding',
            offending,
            blockedText: blockedText.slice(0, 500),
            preview: '🚫 guardrail: resposta com preço não fundamentado foi bloqueada',
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  /** Erros retryable abrem o breaker; 4xx de request são bug nosso (não abrem) */
  private registerApiFailure(err: unknown): void {
    const retryable =
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError;
    this.logger.error(
      `API Claude falhou (${(err as Error).constructor?.name}): ${(err as Error).message}`,
    );
    if (!retryable) return;
    this.breaker.failures++;
    if (this.breaker.failures >= BREAKER_THRESHOLD) {
      this.breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
      this.breaker.failures = 0;
      this.logger.warn(
        `Circuit breaker do SDR ABERTO por ${BREAKER_OPEN_MS / 60000}min — leads seguem no fluxo humano`,
      );
    }
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
  }

  private getClient(): Anthropic {
    if (!this.client) this.client = new Anthropic({ apiKey: this.apiKey() });
    return this.client;
  }
}
