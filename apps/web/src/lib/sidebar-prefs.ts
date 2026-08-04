/**
 * Sidebar por usuário (#975) — decisão pura de reconciliação entre o que o
 * SERVIDOR tem e o que o localStorage LEGADO (pré-#975, sem escopo de
 * usuário) guardava. Extraída do hook para ser testável sem DOM.
 */

export interface UiPreferences {
  favorites: string[];
  collapsedSections: string[];
}

export interface ServerSyncDecision {
  /** estado que a UI deve adotar */
  prefs: UiPreferences;
  /** true = servidor não tinha nada e o legado tinha: subir via PUT */
  shouldUpload: boolean;
}

/**
 * Regras:
 *  - servidor COM dados → servidor vence sempre (é a fonte da verdade);
 *  - servidor vazio + legado com favoritos + nunca migrado → adota o legado e
 *    sobe pro servidor (migração única);
 *  - já migrado antes → servidor vazio é decisão do usuário (limpou de
 *    propósito), não re-migra.
 */
export function resolveServerSync(
  server: UiPreferences,
  legacy: UiPreferences,
  alreadyMigrated: boolean,
): ServerSyncDecision {
  const serverEmpty = server.favorites.length === 0 && server.collapsedSections.length === 0;
  if (serverEmpty && !alreadyMigrated && legacy.favorites.length > 0) {
    return { prefs: legacy, shouldUpload: true };
  }
  return { prefs: server, shouldUpload: false };
}

/** Parse defensivo de um array de strings vindo do localStorage. */
export function parseStringArray(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
