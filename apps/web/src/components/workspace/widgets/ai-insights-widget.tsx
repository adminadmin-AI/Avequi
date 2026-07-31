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

/**
 * Estilo por severidade — o trilho (border-l) e o tint dão PESO ao insight
 * conforme a urgência: crítico grita, informação sussurra. A tag nomeia a
 * prioridade (🔴 Crítico / 🟠 Atenção / 🔵 Info / 🟢 OK) sem emoji, na cor.
 */
const SEVERITY: Record<
  WorkspaceInsight['severity'],
  { rail: string; tint: string; tag: string; label: string }
> = {
  CRITICAL: { rail: 'border-l-danger', tint: 'bg-danger/[0.05]', tag: 'text-danger', label: 'Crítico' },
  WARNING: { rail: 'border-l-warning', tint: 'bg-warning/[0.05]', tag: 'text-warning', label: 'Atenção' },
  INFO: { rail: 'border-l-info', tint: '', tag: 'text-info', label: 'Info' },
  SUCCESS: { rail: 'border-l-success', tint: '', tag: 'text-success', label: 'OK' },
};

const STATUS_CHIP = {
  critical: { label: 'Crítico', className: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  attention: { label: 'Atenção', className: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  ok: { label: 'Tudo OK', className: 'bg-success/10 text-success', dot: 'bg-success' },
} as const;

/** Abertura de consultora: enquadra a contagem como um briefing, não um alerta seco. */
function briefing(firstName: string, count: number, status: 'critical' | 'attention' | 'ok'): string {
  const nome = firstName ? `${firstName}, ` : '';
  const verbo = status === 'critical' ? 'precisam da sua atenção agora' : 'valem seu olhar hoje';
  return count === 1
    ? `${nome}analisei sua operação — 1 ponto ${verbo}.`
    : `${nome}analisei sua operação — ${count} pontos ${verbo}.`;
}

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
          <p className="text-body text-content-secondary">{briefing(firstName, insights.length, status)}</p>
          <ul className="space-y-2">
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
  const sev = SEVERITY[insight.severity];
  const inner = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border-l-2 py-2.5 pl-3 pr-2.5 transition-[background-color,transform] duration-micro',
        sev.rail,
        sev.tint || 'bg-neutral-500/[0.02]',
        insight.cta && 'group-hover:bg-neutral-500/[0.06]',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-content">{insight.message}</p>
        <span className={cn('mt-0.5 block text-helper font-medium uppercase tracking-wide', sev.tag)}>
          {sev.label}
        </span>
      </div>
      {insight.cta && (
        <span className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-caption font-medium text-white shadow-elevation-1 transition-all duration-micro group-hover:bg-brand-700 group-hover:shadow-elevation-2 dark:bg-brand-600 dark:group-hover:bg-brand-500">
          {insight.cta.label}
          <ArrowRight size={13} className="transition-transform duration-micro group-hover:translate-x-0.5" />
        </span>
      )}
    </div>
  );

  if (!insight.cta) return inner;
  return (
    <Link href={insight.cta.href} className="group block">
      {inner}
    </Link>
  );
}
