'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { overallStatus, sortBySeverity, type InsightSeverity } from '../insights-status';

/**
 * Resumo do dia — Antonella V1 (F1). O widget-âncora da zona de atenção:
 * responde "o que exige minha atenção AGORA?" com insights priorizados e
 * CTA direto para a tela certa.
 *
 * Postura de ANALISTA, não de chatbot (auditoria UX 30/07): o status geral
 * (Crítico / Atenção / Tudo OK) aparece no header e vira accent do card
 * quando é alarme de verdade; os insights vêm ordenados do mais grave para
 * o mais leve, cada um com a próxima ação a um clique.
 *
 * V1 é determinística de propósito: o motor de regras é o backend
 * (GET /workspace/insights, já curado pela permissão efetiva do usuário —
 * o payload nunca traz insight de módulo que o usuário não enxerga).
 * A V2 (LLM) trocará o miolo mantendo este contrato.
 */

export interface WorkspaceInsight {
  id: string;
  severity: InsightSeverity;
  message: string;
  count?: number;
  cta?: { label: string; href: string };
}

interface InsightsResponse {
  insights: WorkspaceInsight[];
  generatedAt: string;
}

const DOT: Record<WorkspaceInsight['severity'], string> = {
  CRITICAL: 'bg-danger',
  WARNING: 'bg-warning',
  INFO: 'bg-info',
  SUCCESS: 'bg-success',
};

const STATUS_CHIP = {
  critical: { label: 'Crítico', className: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  attention: { label: 'Atenção', className: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  ok: { label: 'Tudo OK', className: 'bg-success/10 text-success', dot: 'bg-success' },
} as const;

export function AiInsightsWidget(_: WidgetComponentProps) {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? '';

  const insightsQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/workspace/insights'],
    queryFn: async () => (await apiClient.get<InsightsResponse>('/workspace/insights')).data,
  });

  const insights = sortBySeverity(insightsQ.data?.insights ?? []);
  const status = overallStatus(insights.map((i) => i.severity));
  const chip = STATUS_CHIP[status];
  const ready = !insightsQ.isLoading && !insightsQ.isError;

  return (
    <WidgetFrame
      title="Resumo da operação"
      // Accent só quando é alarme de verdade — verde permanente seria ruído.
      accent={status === 'critical' ? 'danger' : status === 'attention' ? 'warning' : undefined}
      action={
        <span className="flex items-center gap-2.5">
          {ready && (
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-helper font-medium',
                chip.className,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', chip.dot)} />
              {chip.label}
            </span>
          )}
          <span className="flex items-center gap-1 text-caption text-content-muted">
            <Sparkles size={13} className="text-brand-600 dark:text-brand-400" /> Antonella
          </span>
        </span>
      }
    >
      {insightsQ.isLoading ? (
        <ListSkeleton />
      ) : insightsQ.isError ? (
        <p className="py-2 text-caption text-content-muted">
          Não consegui analisar a operação agora. Tente de novo em instantes.
        </p>
      ) : insights.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          tone="success"
          title="Operação em ordem"
          hint={`${firstName ? `${firstName}, analisei` : 'Analisei'} sua operação e não encontrei nenhum ponto de atenção agora.`}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-body text-content-secondary">
            {firstName ? `${firstName}, analisei` : 'Analisei'} sua operação —{' '}
            {insights.length === 1
              ? 'encontrei 1 ponto importante.'
              : `encontrei ${insights.length} pontos importantes.`}
          </p>
          <ul className="-mx-2 space-y-0.5">
            {insights.map((i) => (
              <li key={i.id}>
                <InsightRow insight={i} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}

function InsightRow({ insight }: { insight: WorkspaceInsight }) {
  const inner = (
    <>
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[insight.severity])} />
      <span className="min-w-0 flex-1 text-sm text-content">{insight.message}</span>
      {insight.cta && (
        // Sugestão acionável como pílula — mesma linguagem do seletor de
        // período (tint da marca): o próximo passo fica óbvio, não escondido.
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-caption font-medium text-brand-700 transition-colors duration-micro group-hover:bg-brand-100 dark:bg-brand-600/15 dark:text-brand-300 dark:group-hover:bg-brand-600/25">
          {insight.cta.label}
          <ArrowRight size={13} className="transition-transform duration-micro group-hover:translate-x-0.5" />
        </span>
      )}
    </>
  );

  if (!insight.cta) {
    return <div className="flex items-start gap-3 px-2 py-2.5">{inner}</div>;
  }
  return (
    <Link
      href={insight.cta.href}
      className="group flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-micro hover:bg-neutral-500/[0.05]"
    >
      {inner}
    </Link>
  );
}
