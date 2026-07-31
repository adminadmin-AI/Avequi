/**
 * Status geral da Antonella — módulo PURO (sem React) para spec em node.
 *
 * O pior insight dita o tom do widget inteiro: qualquer CRITICAL → "Crítico";
 * senão qualquer WARNING → "Atenção"; senão "Tudo OK". INFO e SUCCESS não
 * mudam o status — informam, não alarmam.
 */

export type InsightSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';

export type InsightStatus = 'critical' | 'attention' | 'ok';

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  SUCCESS: 3,
};

export function overallStatus(severities: InsightSeverity[]): InsightStatus {
  if (severities.includes('CRITICAL')) return 'critical';
  if (severities.includes('WARNING')) return 'attention';
  return 'ok';
}

/** Mais grave primeiro; empates preservam a ordem do backend (sort estável). */
export function sortBySeverity<T extends { severity: InsightSeverity }>(items: T[]): T[] {
  return [...items].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
