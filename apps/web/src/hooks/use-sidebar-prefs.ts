'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  parseStringArray,
  resolveServerSync,
  type UiPreferences,
} from '@/lib/sidebar-prefs';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Favoritos e seções recolhidas da sidebar POR USUÁRIO (#975).
 *
 * Fonte da verdade é a API (GET/PUT /users/me/preferences) — os favoritos
 * seguem o login em qualquer navegador/máquina. O localStorage vira só cache
 * de boot (sem piscar enquanto a API responde), agora ESCOPADO por userId:
 * dois logins no mesmo perfil de navegador não compartilham mais favoritos.
 *
 * Migração suave do legado: se o servidor não tem nada e as chaves antigas
 * (sem escopo) têm favoritos, sobe os locais uma única vez — flag por
 * usuário/navegador evita re-migrar depois que a pessoa limpar de propósito.
 */

const LEGACY_FAV_KEY = 'avequi:sidebar:favorites';
const LEGACY_COLLAPSED_KEY = 'avequi:sidebar:collapsed-sections';

const favKey = (userId: string) => `avequi:sidebar:favorites:${userId}`;
const collapsedKey = (userId: string) => `avequi:sidebar:collapsed-sections:${userId}`;
const migratedKey = (userId: string) => `avequi:sidebar:prefs-migrated:${userId}`;

function readLocal(key: string): string[] {
  return parseStringArray(localStorage.getItem(key));
}

function writeCache(userId: string, prefs: UiPreferences) {
  try {
    localStorage.setItem(favKey(userId), JSON.stringify(prefs.favorites));
    localStorage.setItem(collapsedKey(userId), JSON.stringify(prefs.collapsedSections));
  } catch {
    /* quota/modo privado — cache é opcional */
  }
}

/** Debounce do PUT: cliques rápidos na estrela viram UMA gravação. */
const SAVE_DEBOUNCE_MS = 800;

export function useSidebarPrefs() {
  const userId = useAuthStore((s) => s.user?.id);

  const [hydrated, setHydrated] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Boot instantâneo pelo cache escopado (troca de usuário re-hidrata).
  // Cleanup: PUT pendente de um usuário nunca dispara na sessão do próximo.
  useEffect(() => {
    if (!userId) return;
    setFavorites(readLocal(favKey(userId)));
    setCollapsedSections(readLocal(collapsedKey(userId)));
    setHydrated(true);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [userId]);

  const server = useQuery({
    enabled: !!userId,
    queryKey: ['/users/me/preferences', userId],
    queryFn: async () => (await apiClient.get<UiPreferences>('/users/me/preferences')).data,
    retry: false,
    staleTime: 60_000,
  });

  const persist = useCallback(
    (next: UiPreferences) => {
      if (!userId) return;
      writeCache(userId, next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        // fire-and-forget: falha de rede não desfaz a UI; o cache local segura
        // e a próxima gravação (ou login em outra máquina) reconcilia
        apiClient.put('/users/me/preferences', next).catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);
    },
    [userId],
  );

  // Servidor respondeu: reconcilia (regras em lib/sidebar-prefs.ts — servidor
  // vence; migra o legado pré-#975 uma única vez quando o servidor está vazio).
  // Guarda POR USUÁRIO: logout→login de outra pessoa sem reload re-sincroniza.
  const syncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !server.data || syncedForRef.current === userId) return;
    syncedForRef.current = userId;

    const decision = resolveServerSync(
      server.data,
      { favorites: readLocal(LEGACY_FAV_KEY), collapsedSections: readLocal(LEGACY_COLLAPSED_KEY) },
      localStorage.getItem(migratedKey(userId)) === '1',
    );
    setFavorites(decision.prefs.favorites);
    setCollapsedSections(decision.prefs.collapsedSections);
    if (decision.shouldUpload) persist(decision.prefs);
    else writeCache(userId, decision.prefs);
    try {
      localStorage.setItem(migratedKey(userId), '1');
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, [userId, server.data, persist]);

  const toggleFav = useCallback(
    (href: string) => {
      setFavorites((prev) => {
        const next = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
        persist({ favorites: next, collapsedSections });
        return next;
      });
    },
    [persist, collapsedSections],
  );

  const toggleSection = useCallback(
    (key: string) => {
      setCollapsedSections((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        persist({ favorites, collapsedSections: next });
        return next;
      });
    },
    [persist, favorites],
  );

  return { hydrated, favorites, collapsedSections, toggleFav, toggleSection };
}
