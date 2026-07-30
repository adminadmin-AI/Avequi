'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { ListSkeleton, WidgetFrame } from '../widget-frame';

/**
 * Resumo do dia — Antonella V1 (F1). O widget-âncora da zona de atenção:
 * responde "o que exige minha atenção AGORA?" com insights priorizados e
 * CTA direto para a tela certa.
 *
 * V1 é determinística de propósito: o motor de regras é o backend
 * (GET /workspace/insights, já curado pela permissão efetiva do usuário —
 * o payload nunca traz insight de módulo que o usuário não enxerga).
 * A V2 (LLM) trocará o miolo mantendo este contrato.
 */

export interface WorkspaceInsight {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
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

export function AiInsightsWidget(_: WidgetComponentProps) {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] ?? '';

  const insightsQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/workspace/insights'],
    queryFn: async () => (await apiClient.get<InsightsResponse>('/workspace/insights')).data,
  });

  const insights = insightsQ.data?.insights ?? [];

  return (
    <WidgetFrame
      title="Resumo do dia"
      action={
        <span className="flex items-center gap-1 text-caption text-content-muted">
          <Sparkles size={13} className="text-brand-600 dark:text-brand-400" /> Antonella
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
        <p className="py-2 text-body text-content-secondary">
          {firstName ? `${firstName}, analisei` : 'Analisei'} sua operação e está tudo em ordem —
          nenhum ponto de atenção agora. ✨
        </p>
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
        <span className="flex shrink-0 items-center gap-1 text-caption font-medium text-brand-600 opacity-90 transition-opacity group-hover:opacity-100 dark:text-brand-400">
          {insight.cta.label}
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
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
