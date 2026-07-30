'use client';

import { createContext, useContext } from 'react';

/**
 * Contexto compartilhado entre widgets do Workspace — F0.
 *
 * O período (7/30/90 dias) é estado do workspace, não de um widget: o seletor
 * mora na saudação, mas faturamento (KPI e gráfico) e "a pagar" leem daqui.
 */
export interface WorkspacePeriod {
  periodDays: number;
  setPeriodDays: (days: number) => void;
}

export const WorkspacePeriodContext = createContext<WorkspacePeriod>({
  periodDays: 30,
  setPeriodDays: () => {},
});

export function useWorkspacePeriod(): WorkspacePeriod {
  return useContext(WorkspacePeriodContext);
}

/** Helpers de data compartilhados pelos widgets (mesma semântica da Home antiga). */
export function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function num(v: string | number | null | undefined) {
  return v == null ? 0 : Number(v);
}

/** "há 3h" / "em 2d" / "agora" — curto de propósito, para linhas de lista. */
export function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const value = minutes < 60 ? `${minutes}min` : hours < 24 ? `${hours}h` : `${days}d`;
  if (minutes < 1) return 'agora';
  return diffMs < 0 ? `há ${value}` : `em ${value}`;
}
