/** F4 SDR IA (#521-525) — tipos e constantes do agente */

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
 * Preço de tabela por 1M tokens (USD) — cálculo do custo por turno (#524).
 * Cache read = 0.1x input; cache write (5min) = 1.25x input.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCostUsd(
  model: string,
  usage: { input: number; output: number; cacheRead: number; cacheCreation: number },
): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING['claude-opus-4-8'];
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.input * 0.1 +
      usage.cacheCreation * p.input * 1.25) /
    1_000_000
  );
}
