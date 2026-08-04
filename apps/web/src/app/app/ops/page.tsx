'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Coins,
  HeartHandshake,
  Receipt,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { formatBRL, formatNumber } from '@/lib/format';
import type { BillingOverview, OpsAlert, OpsPanelKpis } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import { AtivarMfaLink } from './ativar-mfa-link';
import { CARTEIRA_STATUS_ORDER, STATUS_LABEL, STATUS_VARIANT } from './tenant-status';
import { agingTone, inadimplenciaCents, temFaturamento, ticketMedioCents } from './panel-format';

/** Recharts fora do chunk inicial da rota — padrão do console e do workspace. */
const FaturamentoAreaChart = dynamic(
  () => import('./panel-charts').then((m) => m.FaturamentoAreaChart),
  { ssr: false, loading: () => <Skeleton className="h-[240px] w-full" /> },
);

const ALERT_SEVERITY_LABEL: Record<OpsAlert['severity'], string> = {
  CRITICAL: 'Crítico',
  WARNING: 'Aviso',
};

/**
 * Painel da Operadora (#957) — a home do console da Avecchi deixou de ser a
 * lista de contas (que foi para /app/ops/tenants) e virou o painel de
 * negócio do SaaS: MRR, ticket, carteira por status, faturamento por
 * competência, inadimplência e os alertas acionáveis.
 *
 * Duas metades, dois gates (o backend exige os mesmos):
 * - carteira + alertas → `ops.tenants.view` (GET /ops/panel/kpis, /ops/alerts)
 * - dinheiro (MRR, série, aging, MRR por plano) → `ops.billing.view`
 *   (GET /ops/billing)
 * Quem só tem o primeiro vê um painel menor, SEM erro e sem buraco — a
 * requisição financeira nem sai (`enabled`), então também não há 403 no log.
 *
 * Regra da casa: NÚMERO INVENTADO NÃO EXISTE. Indicador sem base mostra
 * estado vazio honesto (ticket sem assinatura = "sem base"; CAC/LTV ainda
 * não têm funil comercial e aparecem como slot desabilitado, não como zero).
 */
export default function OpsPanelPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermission();
  const podeVerFinanceiro = !permsLoading && can('ops.billing.view');

  const kpisQ = useQuery<OpsPanelKpis>({
    queryKey: ['/ops/panel/kpis'],
    queryFn: async () => (await apiClient.get<OpsPanelKpis>('/ops/panel/kpis')).data,
  });

  const billingQ = useQuery<BillingOverview>({
    queryKey: ['/ops/billing'],
    // Mesma queryKey da página de Billing → navegar entre as duas não refaz a
    // requisição (cache do TanStack Query).
    queryFn: async () => (await apiClient.get<BillingOverview>('/ops/billing')).data,
    enabled: podeVerFinanceiro,
  });

  // Só a carteira derruba o painel: sem ela não há o que mostrar. O
  // financeiro que falha vira aviso discreto no lugar dos cards.
  if (kpisQ.isError) {
    const negado = ehNegativaDeAcesso(kpisQ.error);
    return (
      <div>
        <PageHeader title="Painel" description="Saúde do negócio da operadora Avecchi." />
        <ErrorState
          fullPage={false}
          title={negado ? 'Acesso negado' : 'Não foi possível carregar o painel'}
          description={
            negado
              ? (mensagemDoErro(kpisQ.error) ?? 'Você não tem permissão para acessar esta área.')
              : (mensagemDoErro(kpisQ.error) ?? 'Tente novamente em instantes.')
          }
          onRetry={negado ? undefined : () => kpisQ.refetch()}
          // #936 — o 403 do OpsMfaGuard tem saída: link direto pra ativar o MFA.
          action={<AtivarMfaLink message={mensagemDoErro(kpisQ.error)} />}
        />
      </div>
    );
  }

  const kpis = kpisQ.data;
  const billing = billingQ.data;
  // A metade financeira só se desenha quando existe DE FATO: sem permissão
  // ela nem é pedida, e se a requisição falhar as seções somem (em vez de
  // ficarem em esqueleto eterno) — o aviso discreto abaixo assume o lugar.
  const financeiroOk = podeVerFinanceiro && !billingQ.isError;
  const carregandoStats = permsLoading || kpisQ.isLoading || (financeiroOk && billingQ.isLoading);

  const ticket = billing ? ticketMedioCents(billing.mrrCents, billing.activeSubscriptions) : null;
  const inadimplencia = billing ? inadimplenciaCents(billing.aging) : 0;
  const tomAging = billing ? agingTone(billing.aging) : 'success';
  const mrrByPlan = Object.entries(billing?.mrrByPlan ?? {}).sort(([, a], [, b]) => b - a);

  return (
    <div>
      <PageHeader
        title="Painel"
        description="Saúde do negócio da operadora Avecchi — carteira, receita e o que precisa de ação."
        actions={
          <Link
            href="/app/ops/tenants"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-content-secondary transition-colors duration-flow ease-precise hover:border-brand-400/50 hover:bg-brand-600/10 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Building2 size={15} />
            Ver contas
          </Link>
        }
      />

      {/* ─── Linha de indicadores ─────────────────────────────────────────── */}
      {carregandoStats ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: financeiroOk || permsLoading ? 4 : 1 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] w-full" />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {financeiroOk && billing && (
            <StatCard
              icon={TrendingUp}
              label="MRR"
              value={formatBRL(billing.mrrCents / 100)}
              sub={
                billing.newMrrMonthCents > 0
                  ? `+${formatBRL(billing.newMrrMonthCents / 100)} novos este mês`
                  : 'nenhuma venda nova no mês'
              }
              subTone={billing.newMrrMonthCents > 0 ? 'success' : 'muted'}
            />
          )}

          {financeiroOk && billing && (
            <StatCard
              icon={Wallet}
              label="Ticket médio"
              value={ticket === null ? '—' : formatBRL(ticket / 100)}
              sub={
                ticket === null
                  ? 'sem base — nenhuma assinatura ativa'
                  : `${formatNumber(billing.activeSubscriptions)} assinatura(s) ativa(s)`
              }
              subTone="muted"
            />
          )}

          <StatCard
            icon={Building2}
            label="Contas"
            value={formatNumber(kpis?.totalTenants ?? 0)}
            sub={
              kpis && kpis.newTenantsMonth > 0
                ? `+${formatNumber(kpis.newTenantsMonth)} nova(s) este mês`
                : 'nenhuma conta nova no mês'
            }
            subTone={kpis && kpis.newTenantsMonth > 0 ? 'success' : 'muted'}
            footer={
              kpis ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {CARTEIRA_STATUS_ORDER.filter((s) => (kpis.statusCounts[s] ?? 0) > 0).map((s) => (
                    <Badge key={s} variant={STATUS_VARIANT[s]}>
                      {STATUS_LABEL[s]}: {formatNumber(kpis.statusCounts[s] ?? 0)}
                    </Badge>
                  ))}
                  {kpis.totalTenants === 0 && (
                    <span className="text-helper text-content-muted">carteira ainda vazia</span>
                  )}
                  {/* Sandbox fora da carteira, mas visível: é conta de teste. */}
                  {kpis.sandbox > 0 && (
                    <span className="text-helper text-content-muted">
                      + {formatNumber(kpis.sandbox)} sandbox
                    </span>
                  )}
                </div>
              ) : undefined
            }
          />

          {financeiroOk && billing && (
            <StatCard
              icon={Receipt}
              label="Inadimplência"
              value={formatBRL(inadimplencia / 100)}
              valueTone={tomAging}
              sub={
                tomAging === 'success'
                  ? 'nada vencido ✓'
                  : tomAging === 'danger'
                    ? 'há faturas com 31+ dias de atraso'
                    : 'atrasos de até 30 dias'
              }
              subTone={tomAging === 'success' ? 'muted' : tomAging}
            />
          )}
        </div>
      )}

      {podeVerFinanceiro && billingQ.isError && (
        <p className="mb-6 flex items-center gap-1.5 text-sm text-content-muted">
          <AlertTriangle size={14} />
          Não foi possível carregar os números financeiros da carteira.
        </p>
      )}

      {/* ─── Faturamento por competência + aging ──────────────────────────── */}
      {financeiroOk && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Faturamento por competência</CardTitle>
              <p className="mt-0.5 text-helper text-content-muted">
                Últimas 6 competências — faturas emitidas (anuladas fora).
              </p>
            </CardHeader>
            <CardContent className="pt-2">
              {billingQ.isLoading || !billing ? (
                <Skeleton className="h-[240px] w-full" />
              ) : temFaturamento(billing.billedSeries) ? (
                <FaturamentoAreaChart data={billing.billedSeries} />
              ) : (
                // Seis meses zerados não é "linha rasa": é ausência de
                // faturamento. Dizer isso é mais honesto que desenhar série.
                <div className="flex h-[240px] flex-col items-center justify-center px-6 text-center">
                  <p className="text-sm font-medium text-content">Nenhuma fatura nas últimas 6 competências</p>
                  <p className="mt-1 max-w-sm text-sm text-content-muted">
                    O gráfico aparece assim que a régua de cobrança emitir a primeira fatura da
                    carteira.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Inadimplência por faixa</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {billingQ.isLoading || !billing ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              ) : (
                <ul className="space-y-1">
                  <AgingRow label="A vencer" cents={billing.aging.current} tone="muted" />
                  <AgingRow label="1–15 dias" cents={billing.aging.d1_15} tone="warning" />
                  <AgingRow label="16–30 dias" cents={billing.aging.d16_30} tone="warning" />
                  <AgingRow label="31+ dias" cents={billing.aging.d31_plus} tone="danger" />
                </ul>
              )}
              <Link
                href="/app/ops/billing"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 transition-colors duration-flow ease-precise hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Ver faturas
                <ArrowRight size={14} />
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Alertas + MRR por plano ──────────────────────────────────────── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className={cn(financeiroOk ? 'lg:col-span-2' : 'lg:col-span-3')}>
          <AlertsPanel onSelect={(tenantId) => router.push(`/app/ops/${tenantId}`)} />
        </div>

        {financeiroOk && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">MRR por plano</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {billingQ.isLoading || !billing ? (
                <Skeleton className="h-16 w-full" />
              ) : mrrByPlan.length === 0 ? (
                <p className="text-sm text-content-muted">Nenhuma assinatura ativa.</p>
              ) : (
                <ul className="space-y-1.5">
                  {mrrByPlan.map(([code, cents]) => (
                    <li key={code} className="flex items-center justify-between gap-3 text-sm">
                      <Badge variant={code === 'LEGADO' ? 'neutral' : 'brand'}>{code}</Badge>
                      <span className="tabular-nums font-medium text-content">
                        {formatBRL(cents / 100)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Slots honestos: CAC e LTV ────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SlotAguardando
          icon={Coins}
          label="CAC"
          hint="Custo de aquisição por cliente"
        />
        <SlotAguardando
          icon={HeartHandshake}
          label="LTV"
          hint="Valor do cliente ao longo da relação"
        />
      </div>
    </div>
  );
}

/* ─────────────────────────── peças do painel ─────────────────────────────── */

type Tone = 'success' | 'warning' | 'danger' | 'muted';

const VALUE_TONE: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-content',
};

const SUB_TONE: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-content-muted',
};

/**
 * Stat card do painel — mesma gramática dos KPIs do Workspace (rótulo em
 * caption com ícone, número grande em tabular-nums, subtexto helper), aqui
 * dentro de um Card porque o painel da operadora é uma grade de superfícies,
 * não o canvas de-boxed da Home do ERP.
 */
function StatCard({
  icon: Icon,
  label,
  value,
  valueTone = 'muted',
  sub,
  subTone = 'muted',
  footer,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueTone?: Tone;
  sub?: string;
  subTone?: Tone;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className="shrink-0 text-content-muted" />
          <span className="truncate text-caption uppercase tracking-wide text-content-muted">
            {label}
          </span>
        </div>
        <p
          className={cn(
            'mt-1.5 truncate text-[28px] font-semibold leading-9 tracking-[-0.02em] tabular-nums',
            VALUE_TONE[valueTone],
          )}
          title={value}
        >
          {value}
        </p>
        {sub && <p className={cn('mt-0.5 text-helper', SUB_TONE[subTone])}>{sub}</p>}
        {footer}
      </CardContent>
    </Card>
  );
}

function AgingRow({ label, cents, tone }: { label: string; cents: number; tone: Tone }) {
  const zerado = cents === 0;
  return (
    <li className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-content-secondary">{label}</span>
      <span
        className={cn(
          'tabular-nums font-medium',
          zerado ? 'text-content-muted' : SUB_TONE[tone],
        )}
      >
        {formatBRL(cents / 100)}
      </span>
    </li>
  );
}

/**
 * Slot de indicador que AINDA NÃO TEM FONTE DE DADO (#957). Não é um KPI
 * zerado nem um "0%" de enfeite: é a promessa explícita de onde o número vai
 * nascer. Regra da casa — número inventado não existe.
 */
function SlotAguardando({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <div
      aria-disabled
      className="rounded-xl border border-dashed border-line bg-transparent px-6 py-4 opacity-90 transition-opacity duration-flow ease-precise hover:opacity-100"
    >
      <div className="flex items-center gap-1.5">
        <Icon size={14} className="shrink-0 text-content-muted" />
        <span className="truncate text-caption uppercase tracking-wide text-content-muted">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-content-muted/60">
        —
      </p>
      <p className="mt-1 text-helper text-content-muted">{hint}</p>
      <Badge variant="neutral" className="mt-2">
        Aguardando funil comercial
      </Badge>
      <p className="mt-1.5 text-helper text-content-muted">
        entra com o CRM da operadora — épico ERP da Avecchi
      </p>
    </div>
  );
}

/**
 * Alertas da carteira — GET /ops/alerts (CRITICAL primeiro). Veio da lista de
 * contas para o painel (#957): é o bloco acionável da home, não um enfeite da
 * tabela. Clicar leva ao detalhe da conta.
 */
function AlertsPanel({ onSelect }: { onSelect: (tenantId: string) => void }) {
  const { data, isLoading, isError } = useQuery<OpsAlert[]>({
    queryKey: ['/ops/alerts'],
    queryFn: async () => (await apiClient.get<OpsAlert[]>('/ops/alerts')).data,
  });

  // Erro nos alertas não pode derrubar o painel — aviso discreto e segue.
  if (isError) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-content-muted">
        <AlertTriangle size={14} />
        Não foi possível carregar os alertas da carteira.
      </p>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Alertas da carteira</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhum alerta na carteira ✓</p>
        ) : (
          <ul className="space-y-2">
            {data.map((a, i) => (
              <li key={`${a.type}-${a.tenantId}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelect(a.tenantId)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors duration-flow ease-precise',
                    a.severity === 'CRITICAL'
                      ? 'border-danger-200 bg-danger-50 hover:bg-danger-100 dark:border-danger-900 dark:bg-danger-900/20 dark:hover:bg-danger-900/30'
                      : 'border-warning-200 bg-warning-50 hover:bg-warning-100 dark:border-warning-900 dark:bg-warning-900/20 dark:hover:bg-warning-900/30',
                  )}
                >
                  <Badge variant={a.severity === 'CRITICAL' ? 'danger' : 'warning'} className="mt-0.5 shrink-0">
                    {ALERT_SEVERITY_LABEL[a.severity]}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-content">{a.tenantName}</span>
                    <span className="block text-content-secondary">{a.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
