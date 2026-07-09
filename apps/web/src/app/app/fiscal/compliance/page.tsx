'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, FileWarning, ShieldCheck, Truck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/format';

/**
 * #503 parte 2 — Compliance Center: conformidade fiscal em tempo real.
 * Score ponderado + 4 dimensões: Reforma Tributária (prazo 03/08/2026),
 * cobertura de regras vigentes, saúde de emissão 30d e pendências veiculares.
 * O painel SINALIZA, não bloqueia.
 */

interface Compliance {
  generatedAt: string;
  score: number;
  weights: Record<string, number>;
  reforma: {
    deadline: string;
    daysLeft: number;
    activeProducts: number;
    withNcm: number;
    withoutNcm: number;
    withCClassTrib: number;
    withoutCClassTrib: number;
    rulesVigentes: number;
    rulesWithIbsCbs: number;
    score: number;
  };
  ruleCoverage: {
    operations: Array<{ operationType: string; activeRules: number; covered: boolean }>;
    coveredCount: number;
    totalOperations: number;
    score: number;
  };
  emission30d: {
    authorized: number;
    rejected: number;
    error: number;
    pending: number;
    cancelled: number;
    total: number;
    successRate: number;
    recentFailures: Array<{ id: string; type: string; status: string; lastError: string | null; createdAt: string }>;
    score: number;
  };
  vehicular: { soldSerials: number; soldWithBin: number; soldWithoutBin: number; score: number };
}

const OPERATION_LABEL: Record<string, string> = {
  VENDA_INTERNA: 'Venda interna',
  VENDA_INTERESTADUAL: 'Venda interestadual',
  DEVOLUCAO_VENDA: 'Devolução de venda',
  TRANSFERENCIA_INTERNA: 'Transferência interna',
  TRANSFERENCIA_INTERESTADUAL: 'Transferência interestadual',
  COMPRA_INTERNA: 'Compra interna',
  COMPRA_INTERESTADUAL: 'Compra interestadual',
  DEVOLUCAO_COMPRA: 'Devolução de compra',
  REMESSA_CONSERTO: 'Remessa p/ conserto',
  RETORNO_CONSERTO: 'Retorno de conserto',
  AMOSTRA_GRATIS: 'Amostra grátis',
  BONIFICACAO: 'Bonificação',
  INDUSTRIALIZACAO: 'Industrialização',
};

function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 85) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

const TONE_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const TONE_BAR = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const;

function DimensionCard({
  title,
  icon,
  score,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  score: number;
  children: React.ReactNode;
}) {
  const tone = scoreTone(score);
  return (
    <Card>
      <CardContent className="py-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-content-secondary">
            {icon}
            {title}
          </h3>
          <span className={`text-lg font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{score}</span>
        </div>
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary">
          <div className={`h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${score}%` }} />
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-content-secondary">{label}</span>
      <span className={`font-medium tabular-nums ${danger ? 'text-danger' : 'text-content'}`}>{value}</span>
    </div>
  );
}

export default function CompliancePage() {
  const { data, isLoading } = useQuery<Compliance>({
    queryKey: ['/fiscal/compliance'],
    queryFn: async () => (await apiClient.get('/fiscal/compliance')).data,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const tone = scoreTone(data.score);
  const r = data.reforma;
  const cov = data.ruleCoverage;
  const em = data.emission30d;
  const v = data.vehicular;
  const uncovered = cov.operations.filter((o) => !o.covered);

  return (
    <div>
      <PageHeader
        title="Conformidade Fiscal"
        description="Compliance Center: prontidão pra Reforma, cobertura de regras, saúde de emissão e pendências — em tempo real."
        actions={
          <Link href="/app/fiscal/rules">
            <Button variant="secondary">Regras Fiscais</Button>
          </Link>
        }
      />

      {/* Score geral */}
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex items-center gap-4">
            <div className={`text-5xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{data.score}</div>
            <div>
              <p className="text-sm font-semibold text-content">Score de conformidade</p>
              <p className="text-xs text-content-muted">
                Reforma {Math.round(data.weights.reforma * 100)}% · Cobertura{' '}
                {Math.round(data.weights.ruleCoverage * 100)}% · Emissão{' '}
                {Math.round(data.weights.emission30d * 100)}% · Veicular{' '}
                {Math.round(data.weights.vehicular * 100)}%
              </p>
              <p className="mt-0.5 text-[11px] text-content-muted">
                Atualizado {formatDateTime(data.generatedAt)} · o painel sinaliza, não bloqueia
              </p>
            </div>
          </div>
          {r.daysLeft <= 60 && r.withoutCClassTrib > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
              <AlertTriangle size={18} />
              <span>
                <b>{r.daysLeft} dias</b> pro IBS/CBS obrigatório e{' '}
                <b>{r.withoutCClassTrib} produtos sem cClassTrib</b> — NF-e será rejeitada (N12-110)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Reforma Tributária */}
        <DimensionCard
          title={`Reforma Tributária — prazo 03/08/2026 (${r.daysLeft}d)`}
          icon={<CalendarClock size={16} />}
          score={r.score}
        >
          <Row label="Produtos ativos" value={r.activeProducts} />
          <Row label="Sem NCM" value={r.withoutNcm} danger={r.withoutNcm > 0} />
          <Row
            label="Sem cClassTrib (classificação IBS/CBS)"
            value={r.withoutCClassTrib}
            danger={r.withoutCClassTrib > 0}
          />
          <Row label="Regras vigentes com IBS/CBS" value={`${r.rulesWithIbsCbs}/${r.rulesVigentes}`} />
          {r.withoutCClassTrib > 0 && (
            <p className="mt-2 text-xs text-content-muted">
              Use a skill <code className="font-mono">reforma-tributaria</code> pra classificar em lote e
              gerar o relatório pro contador assinar (#665).
            </p>
          )}
        </DimensionCard>

        {/* Cobertura de regras */}
        <DimensionCard
          title={`Cobertura de regras — ${cov.coveredCount}/${cov.totalOperations} operações`}
          icon={<ShieldCheck size={16} />}
          score={cov.score}
        >
          {uncovered.length === 0 ? (
            <p className="py-2 text-sm text-content-secondary">
              Todas as operações têm regra fiscal vigente. ✓
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-content-muted">
                Sem regra vigente — Faturar bloqueia nessas operações (#498):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {uncovered.map((o) => (
                  <Badge key={o.operationType} variant="warning">
                    {OPERATION_LABEL[o.operationType] ?? o.operationType}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </DimensionCard>

        {/* Emissão 30d */}
        <DimensionCard
          title={`Emissão últimos 30 dias — ${em.successRate}% de sucesso`}
          icon={<FileWarning size={16} />}
          score={em.score}
        >
          <Row label="Autorizadas" value={em.authorized} />
          <Row label="Rejeitadas" value={em.rejected} danger={em.rejected > 0} />
          <Row label="Com erro" value={em.error} danger={em.error > 0} />
          <Row label="Pendentes/processando" value={em.pending} />
          {em.recentFailures.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-line pt-2">
              <p className="text-xs font-medium text-content-muted">Falhas recentes:</p>
              {em.recentFailures.map((f) => (
                <Link
                  key={f.id}
                  href={`/app/fiscal/${f.id}`}
                  className="block truncate text-xs text-danger hover:underline"
                  title={f.lastError ?? undefined}
                >
                  {f.type} · {formatDateTime(f.createdAt)} — {f.lastError ?? f.status}
                </Link>
              ))}
            </div>
          )}
        </DimensionCard>

        {/* Veicular */}
        <DimensionCard title="Veicular — BIN dos chassis vendidos" icon={<Truck size={16} />} score={v.score}>
          <Row label="Chassis vendidos" value={v.soldSerials} />
          <Row label="Com BIN registrada" value={v.soldWithBin} />
          <Row label="Sem BIN (pendência RENAVE)" value={v.soldWithoutBin} danger={v.soldWithoutBin > 0} />
          {v.soldWithoutBin > 0 && (
            <p className="mt-2 text-xs text-content-muted">
              ATPV-e fica bloqueada sem BIN registrada — regularize antes do emplacamento (#527).
            </p>
          )}
        </DimensionCard>
      </div>
    </div>
  );
}
