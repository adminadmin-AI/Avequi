import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LeadActivityType, Prisma, WaMessageDirection } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SDR_ACTOR, estimateCostUsd } from './sdr.types';
import {
  LEAD_SUMMARY_SYSTEM_PROMPT,
  LEAD_SUMMARY_TOOL,
  LeadSummaryResult,
} from './lead-summary-prompt';

/** Modelo barato fixo pra sumarização (#573): não é raciocínio, é condensar. */
const SUMMARY_MODEL = 'claude-haiku-4-5';
/** Histórico enviado ao modelo — cobre conversa longa (100% humana) do #573. */
const SUMMARY_HISTORY_LIMIT = 150;

/**
 * V2.6 (#573) — "Resumir conversa" no painel do lead. Reusa a infra do SDR
 * (cliente Anthropic, custo em SdrUsage via estimateCostUsd, actor sintético)
 * mas com prompt PRÓPRIO e curto (lead-summary-prompt.ts), modelo barato e
 * SEM tools de ERP: só condensa a conversa pro humano que assume o takeover.
 *
 * Isolamento: toda leitura é escopada por companyId — o prompt nunca vê
 * conversa de outra loja.
 */
@Injectable()
export class LeadSummaryService {
  private readonly logger = new Logger(LeadSummaryService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Guarda igual à do SDR: sem chave, a feature simplesmente não existe. */
  isAvailable(): boolean {
    return !!this.apiKey();
  }

  /**
   * Gera o resumo da conversa do lead e o grava como LeadActivity NOTE
   * (kind conversation_summary) na timeline. Custo logado em SdrUsage.
   */
  async summarize(companyId: string, leadId: string, actorId: string) {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException(
        'Resumo por IA indisponível: ANTHROPIC_API_KEY não configurada.',
      );
    }

    // Escopo por companyId: lead de outra loja simplesmente não é encontrado —
    // a conversa nunca chega ao prompt.
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: {
        id: true,
        name: true,
        source: true,
        anonymizedAt: true,
        conversation: {
          select: {
            messages: {
              orderBy: { createdAt: 'desc' },
              take: SUMMARY_HISTORY_LIMIT,
              select: { direction: true, type: true, text: true },
            },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.anonymizedAt) {
      throw new BadRequestException('Lead anonimizado (LGPD) — sem conversa para resumir.');
    }
    const history = lead.conversation?.messages ?? [];
    if (history.length === 0) {
      throw new BadRequestException('Este lead ainda não tem conversa para resumir.');
    }

    const messages = this.buildMessages(lead.name, lead.source, [...history].reverse());

    let result: LeadSummaryResult;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    try {
      const response = await this.getClient().messages.create({
        model: SUMMARY_MODEL,
        max_tokens: 1024,
        system: LEAD_SUMMARY_SYSTEM_PROMPT,
        tools: [LEAD_SUMMARY_TOOL],
        // saída estruturada garantida numa única chamada
        tool_choice: { type: 'tool', name: LEAD_SUMMARY_TOOL.name },
        messages,
      });
      usage.input = response.usage.input_tokens;
      usage.output = response.usage.output_tokens;
      usage.cacheRead = response.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreation = response.usage.cache_creation_input_tokens ?? 0;
      result = this.parseResult(response);
    } catch (err) {
      this.logger.error(`Resumo do lead ${leadId} falhou: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Falha ao gerar o resumo — tente novamente.');
    }

    // custo logado igual ao SDR (o painel de custo #524 identifica pelo model haiku)
    await this.prisma.sdrUsage
      .create({
        data: {
          companyId,
          leadId,
          model: SUMMARY_MODEL,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          cacheCreationTokens: usage.cacheCreation,
          costUsd: new Prisma.Decimal(estimateCostUsd(SUMMARY_MODEL, usage).toFixed(6)),
        },
      })
      .catch((e) => this.logger.warn(`Log de usage do resumo falhou: ${(e as Error).message}`));

    const discovered = this.discovered(result);
    const activity = await this.prisma.leadActivity.create({
      data: {
        leadId,
        type: LeadActivityType.NOTE,
        actorId,
        properties: {
          kind: 'conversation_summary',
          preview: `📝 ${result.resumo}`.slice(0, 280),
          summary: result.resumo,
          discovered,
          model: SUMMARY_MODEL,
          messageCount: history.length,
        } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Resumo IA gerado para o lead ${leadId} (${history.length} mensagens)`);
    return { summary: result.resumo, discovered, activityId: activity.id };
  }

  // ── internos ────────────────────────────────────────────────────────────────

  /** Só os campos que o cliente REVELOU (vazio não vira ruído na timeline). */
  private discovered(r: LeadSummaryResult): Record<string, string> {
    const out: Record<string, string> = {};
    const put = (k: string, v?: string | null) => {
      const t = v?.trim();
      if (t) out[k] = t;
    };
    put('cidade', r.cidade);
    put('necessidade', r.necessidade);
    put('prazo', r.prazo);
    put('pagamento', r.pagamento);
    return out;
  }

  private parseResult(response: Anthropic.Messages.Message): LeadSummaryResult {
    const toolUse = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    );
    const input = (toolUse?.input ?? {}) as Partial<LeadSummaryResult>;
    const resumo = (input.resumo ?? '').trim();
    if (!resumo) throw new Error('modelo não retornou resumo');
    return {
      resumo,
      cidade: input.cidade,
      necessidade: input.necessidade,
      prazo: input.prazo,
      pagamento: input.pagamento,
    };
  }

  private buildMessages(
    leadName: string | null,
    source: string,
    history: Array<{ direction: WaMessageDirection; type: string; text: string | null }>,
  ): Anthropic.Messages.MessageParam[] {
    const lines = history.map((m) => {
      const autor = m.direction === WaMessageDirection.IN ? 'Cliente' : 'Loja';
      const text = m.text?.trim() || `[${m.type.toLowerCase()}]`;
      return `${autor}: ${text}`;
    });
    const content =
      `Cliente: ${leadName ?? 'não informado'}\nOrigem do lead: ${source}\n\n` +
      `Conversa de WhatsApp (mais antiga primeiro):\n${lines.join('\n')}`;
    return [{ role: 'user', content }];
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
  }

  private getClient(): Anthropic {
    if (!this.client) this.client = new Anthropic({ apiKey: this.apiKey() });
    return this.client;
  }
}
