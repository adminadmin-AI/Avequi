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
