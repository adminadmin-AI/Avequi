/**
 * Matcher de permissão com wildcard — ESPELHO EXATO do backend (#351).
 *
 * Fonte da semântica: apps/api/src/modules/iam/permission.service.ts
 * (função `permissionMatches`). Qualquer mudança lá DEVE ser replicada aqui —
 * o frontend precisa esconder exatamente o que o backend vai negar.
 *
 * Regras:
 * - Sem `*` → membership exato no conjunto efetivo.
 * - `*` sozinho → true se o conjunto não está vazio.
 * - Só wildcard de SUFIXO: `modulo.*` ou `modulo.recurso.*`.
 * - Padrão inválido (ex.: `sa*les.x`, `sales.*.view`) → false, nunca lança
 *   (fail-closed).
 */
export function permissionMatches(effective: ReadonlySet<string>, query: string): boolean {
  if (!query.includes('*')) return effective.has(query);
  if (query === '*') return effective.size > 0;
  // Só aceita wildcard de sufixo: 'modulo.*' ou 'modulo.recurso.*'
  if (!query.endsWith('.*') || query.indexOf('*') !== query.length - 1) return false;
  const prefix = query.slice(0, -1); // mantém o ponto: 'sales.'
  for (const code of effective) {
    if (code.startsWith(prefix)) return true;
  }
  return false;
}
