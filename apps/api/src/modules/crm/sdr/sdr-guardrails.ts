/**
 * F4.3 (#523) — guardrails validados em CÓDIGO (defesa em profundidade: o
 * system prompt instrui, o código garante). A IA erra do lado seguro, sempre.
 */

/** Padrões de preço em pt-BR: "R$ 12.500", "R$12500,00", "12500 reais", "12,5 mil" */
const PRICE_PATTERNS = [
  /R\$\s*[\d][\d.,]*/gi,
  /\b[\d][\d.,]*\s*(?:reais|conto[s]?)\b/gi,
  /\b[\d][\d.,]*\s*mil\b/gi,
];

/** Extrai valores numéricos de preço mencionados num texto */
export function detectPrices(text: string): number[] {
  const found: number[] = [];
  for (const pattern of PRICE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = parseBrNumber(match[0]);
      if (value != null && value >= 50) found.push(value); // < 50 não é preço de reboque
    }
  }
  return [...new Set(found)];
}

/** "12.500,00" → 12500; "12,5 mil" → 12500; "R$ 3500" → 3500 */
function parseBrNumber(raw: string): number | null {
  const isMil = /mil\b/i.test(raw);
  let s = raw.replace(/R\$|reais|conto[s]?|mil/gi, '').trim();
  // formato brasileiro: ponto = milhar, vírgula = decimal
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return isMil ? n * 1000 : n;
}

export interface PriceValidation {
  ok: boolean;
  offending: number[];
}

/**
 * Resposta da IA só pode citar preço retornado por tool NA MESMA conversa.
 * Sem tool call de estoque → nenhum preço é permitido. Tolerância de 1 real
 * p/ arredondamento de formatação.
 */
export function validatePriceGrounding(text: string, toolPrices: string[]): PriceValidation {
  const mentioned = detectPrices(text);
  if (mentioned.length === 0) return { ok: true, offending: [] };

  const allowed = toolPrices
    .map((p) => parseFloat(p))
    .filter((n) => isFinite(n));

  const offending = mentioned.filter(
    (m) => !allowed.some((a) => Math.abs(a - m) <= 1),
  );
  return { ok: offending.length === 0, offending };
}

/** Janela de atendimento (#523): 24/7 ou só fora do expediente (seg-sex 8h-18h BRT) */
export function isWithinSdrWindow(schedule: '24_7' | 'OFF_HOURS', now: Date = new Date()): boolean {
  if (schedule !== 'OFF_HOURS') return true;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const isWeekend = /^(sáb|dom)/i.test(weekday);
  // expediente humano: seg-sex 8h-18h → IA atende fora disso
  return isWeekend || hour < 8 || hour >= 18;
}
