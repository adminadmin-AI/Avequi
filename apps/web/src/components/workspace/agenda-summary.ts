/**
 * Sumário compacto da agenda — módulo PURO (sem React) para spec em node.
 *
 * Estado compacto do widget (auditoria UX 30/07): em vez da lista inteira,
 * uma linha por TIPO de compromisso ("5 vencimentos financeiros · 2 hoje"),
 * com o detalhe atrás de "Mostrar detalhes". A ordem é fixa por relevância
 * operacional: financeiro → produção → CRM.
 */

export type AgendaKind = 'finance-due' | 'production-end' | 'crm-reminder';

export interface AgendaSummaryItem {
  kind: AgendaKind;
  label: string;
  total: number;
  today: number;
  /** Algum item do tipo com tone danger (ex.: vencendo hoje/atrasado). */
  hasDanger: boolean;
}

const KIND_LABEL: Record<AgendaKind, { singular: string; plural: string }> = {
  'finance-due': { singular: 'vencimento financeiro', plural: 'vencimentos financeiros' },
  'production-end': { singular: 'término de produção', plural: 'términos de produção' },
  'crm-reminder': { singular: 'lembrete de CRM', plural: 'lembretes de CRM' },
};

const KIND_ORDER: readonly AgendaKind[] = ['finance-due', 'production-end', 'crm-reminder'];

export function summarizeAgenda(
  items: { kind: AgendaKind; date: string; tone?: 'danger' | 'warning' | 'neutral' }[],
  todayIso: string,
): AgendaSummaryItem[] {
  return KIND_ORDER.flatMap((kind) => {
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length === 0) return [];
    const total = ofKind.length;
    return [
      {
        kind,
        label: `${total} ${total === 1 ? KIND_LABEL[kind].singular : KIND_LABEL[kind].plural}`,
        total,
        today: ofKind.filter((i) => i.date === todayIso).length,
        hasDanger: ofKind.some((i) => i.tone === 'danger'),
      },
    ];
  });
}
