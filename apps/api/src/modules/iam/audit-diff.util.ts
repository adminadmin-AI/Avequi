/**
 * Utilitário de diff para auditoria (issue #343).
 *
 * `computeDiff(before, after)` compara dois estados de uma entidade e devolve
 * SOMENTE os campos alterados (oldValue/newValue), com campos sensíveis
 * substituídos por [REDACTED]. É o insumo do AuditService.logWithDiff().
 *
 * Regras:
 * - comparação rasa por campo (1º nível), com igualdade profunda por valor
 *   (JSON normalizado) para objetos/arrays aninhados;
 * - Date é normalizada para ISO string antes de comparar/gravar;
 * - campos sensíveis (senha, hash, token, secret…) NUNCA aparecem em claro —
 *   quando mudam, ambos os lados viram [REDACTED];
 * - retorna null quando nada mudou (nada a auditar).
 */

export const REDACTED = '[REDACTED]';

/** Padrões de nome de campo que nunca podem aparecer em claro no audit log. */
const SENSITIVE_KEY_PATTERN =
  /password|passwd|senha|secret|token|apikey|api_key|credential|authorization|privatekey|private_key|passwordhash|backupcodes|totp/i;

const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** Normaliza valores para serialização estável (Date → ISO). */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Redige recursivamente campos sensíveis de qualquer estrutura.
 * Profundidade limitada (6 níveis) para não explodir em objetos circulares
 * profundos; além do limite o valor é truncado para '[TRUNCATED]'.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(val, depth + 1);
    }
    return out;
  }
  return normalize(value);
}

/** Igualdade profunda por valor (via JSON normalizado). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export interface AuditDiff {
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
}

/**
 * Compara before/after e devolve só os campos que mudaram.
 * - null quando nada mudou;
 * - before null/undefined (criação) → oldValue = {} e newValue = after inteiro
 *   (redigido); simétrico para deleção.
 */
export function computeDiff(before: unknown, after: unknown): AuditDiff | null {
  const beforeObj = isPlainObject(before) ? before : {};
  const afterObj = isPlainObject(after) ? after : {};

  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  for (const key of keys) {
    const oldVal = beforeObj[key];
    const newVal = afterObj[key];
    if (deepEqual(oldVal, newVal)) continue;

    if (isSensitiveKey(key)) {
      // Registra QUE mudou, nunca O QUE mudou.
      if (key in beforeObj) oldValue[key] = REDACTED;
      if (key in afterObj) newValue[key] = REDACTED;
      continue;
    }
    if (key in beforeObj) oldValue[key] = redactSensitive(oldVal);
    if (key in afterObj) newValue[key] = redactSensitive(newVal);
  }

  if (Object.keys(oldValue).length === 0 && Object.keys(newValue).length === 0) {
    return null;
  }
  return { oldValue, newValue };
}
