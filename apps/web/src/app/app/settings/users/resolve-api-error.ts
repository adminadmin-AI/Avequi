/**
 * Extrai a mensagem real da API (string ou array do class-validator).
 * A política de senha PT-BR do backend devolve exatamente o que faltou —
 * esconder isso atrás de um genérico já travou diagnóstico antes (#744).
 */
export function resolveApiError(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data?.message;
  if (Array.isArray(message)) return message.join('\n');
  if (typeof message === 'string' && message) return message;
  return fallback;
}
