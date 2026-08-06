/** F4 SDR IA (#521-525) — tipos e constantes do agente */
import type Anthropic from '@anthropic-ai/sdk';

/** actorId sintético da IA na timeline e em WhatsappMessage.sentById */
export const SDR_ACTOR = 'SDR_IA';

/** Parâmetros por company (SystemParameter) — expostos na config do CRM */
export const SDR_PARAM_KEYS = {
  /** kill switch (#523): 'true' liga o SDR na loja */
  enabled: 'CRM_SDR_ENABLED',
  /** model id — permite A/B opus/sonnet/haiku (#521/#525) */
  model: 'CRM_SDR_MODEL',
  /** handoff garantido após N trocas da IA (#523) */
  maxTurns: 'CRM_SDR_MAX_TURNS',
  /** '24_7' (default) ou 'OFF_HOURS' — IA só fora do expediente (#523) */
  schedule: 'CRM_SDR_SCHEDULE',
} as const;

export const SDR_DEFAULTS = {
  enabled: false,
  model: 'claude-opus-4-8',
  maxTurns: 12,
  schedule: '24_7' as '24_7' | 'OFF_HOURS',
};

export interface SdrSettings {
  sdrEnabled: boolean;
  sdrModel: string;
  sdrMaxTurns: number;
  sdrSchedule: '24_7' | 'OFF_HOURS';
}

/**
 * TTL dos breakpoints de cache do SDR.
 *
 * 1h em vez do default de 5min porque o prefixo tools+system é IDÊNTICO em
 * todas as conversas de todos os leads: com 5min ele esfriava entre um lead e
 * outro e era reescrito quase toda vez. O histórico também passa dos 5min
 * sozinho — lead de WhatsApp some no meio da qualificação e volta depois.
 *
 * ⚠️ A escrita passa a custar 2x o input (era 1.25x), então a troca só se paga
 * acima de ~80% de acerto na janela de 1h. Acompanhe `cacheHitRate` no painel
 * do SDR (sdr-dashboard.service) — se cair abaixo disso, volte para '5m'.
 */
export const SDR_CACHE_TTL = '1h' as const;

/**
 * Preço de tabela por 1M tokens (USD) — cálculo do custo por turno (#524).
 * Cache read = 0.1x input; cache write depende do TTL (ver CACHE_WRITE_MULTIPLIER).
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Multiplicador da ESCRITA de cache por TTL. A leitura é sempre 0.1x. */
export const CACHE_WRITE_MULTIPLIER = { '5m': 1.25, '1h': 2 } as const;

export interface SdrUsageTokens {
  input: number;
  output: number;
  cacheRead: number;
  /** escrita de cache com TTL de 5min */
  cacheWrite5m: number;
  /** escrita de cache com TTL de 1h */
  cacheWrite1h: number;
}

export function emptyUsage(): SdrUsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
}

/**
 * Acumula o usage de uma resposta separando a escrita de cache por TTL — os
 * dois custam diferente e a API já devolve a quebra em `usage.cache_creation`.
 * Centralizado aqui de propósito: quando isso vivia duplicado no agente e no
 * resumo, um dos dois ficava para trás.
 */
export function addUsage(acc: SdrUsageTokens, u: Anthropic.Messages.Usage): void {
  acc.input += u.input_tokens;
  acc.output += u.output_tokens;
  acc.cacheRead += u.cache_read_input_tokens ?? 0;

  const breakdown = u.cache_creation;
  if (breakdown) {
    acc.cacheWrite5m += breakdown.ephemeral_5m_input_tokens;
    acc.cacheWrite1h += breakdown.ephemeral_1h_input_tokens;
    return;
  }
  // Sem a quebra (resposta antiga ou mock de teste), assume o TTL configurado
  // em vez de errar para baixo silenciosamente.
  const total = u.cache_creation_input_tokens ?? 0;
  if (SDR_CACHE_TTL === '1h') acc.cacheWrite1h += total;
  else acc.cacheWrite5m += total;
}

/** Total gravado em cache no turno — é o que vai para SdrUsage.cacheCreationTokens. */
export function totalCacheWrite(usage: SdrUsageTokens): number {
  return usage.cacheWrite5m + usage.cacheWrite1h;
}

export function estimateCostUsd(model: string, usage: SdrUsageTokens): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING['claude-opus-4-8'];
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.input * 0.1 +
      usage.cacheWrite5m * p.input * CACHE_WRITE_MULTIPLIER['5m'] +
      usage.cacheWrite1h * p.input * CACHE_WRITE_MULTIPLIER['1h']) /
    1_000_000
  );
}
