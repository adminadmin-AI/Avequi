'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldX } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import { useList } from '@/hooks/use-resource';
import type { User } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DateRangePicker, type DateRange, dateToISO } from '@/components/ui/date-picker';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { SupportAccessCard } from './support-access-card';

interface AuditLog {
  id: string;
  userId: string | null;
  user?: { id: string; name: string; email: string } | null;
  entity: string;
  action: string;
  /** Diff do AuditLogV2: estado anterior e novo (a v2 não tem `payload`). */
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

const PAGE_SIZE = 50;

/** Espelho do enum AuditAction do backend (audit-log-query.dto valida com @IsEnum). */
const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'CANCEL', 'FINALIZE',
  'REOPEN', 'EXPORT', 'IMPORT', 'PRINT', 'EXECUTE', 'PROCESS', 'LOGIN',
  'LOGOUT', 'OTHER',
] as const;
const ENTITIES = [
  'Product', 'SalesOrder', 'PurchaseOrder', 'FinancialEntry', 'StockMovement',
  'ProductionOrder', 'FiscalDocument', 'Customer', 'Supplier', 'User', 'WorkCenter',
  'RoutingStep', 'BomVersion', 'NfeManifest',
];

export default function AuditLogPage() {
  // #1003 — mesmo gate do menu e do backend (iam.audit-logs.view).
  const { can } = usePermission();
  const isSuperAdmin = can('iam.audit-logs.view');

  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  // Período (padrão #881): um campo, calendário de 2 cliques.
  const [range, setRange] = useState<DateRange>();
  const from = dateToISO(range?.from);
  const to = dateToISO(range?.to);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: users = [] } = useList<User>('/users', undefined, { enabled: isSuperAdmin });

  const logsQ = useQuery({
    queryKey: ['/iam/audit-logs', entity, userId, action, from, to, page],
    enabled: isSuperAdmin,
    retry: false,
    queryFn: async () =>
      (
        // Endpoint real (o antigo GET /audit-logs não existe na API — a tela
        // estava morta por baixo). A resposta é paginada NO SERVIDOR:
        // { data, total, page, pageSize }.
        await apiClient.get<{ data: AuditLog[]; total: number }>('/iam/audit-logs', {
          params: {
            entity: entity || undefined,
            userId: userId || undefined,
            action: action || undefined,
            // O backend compara com lte/gte no instante exato — data solta
            // viraria meia-noite UTC e EXCLUIRIA o próprio dia escolhido.
            // Converte para início/fim do dia LOCAL antes de enviar.
            from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
            to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
            page: page + 1,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
  });

  const logs = logsQ.data?.data ?? [];
  const total = logsQ.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paged = logs;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!isSuperAdmin) {
    return (
      <div>
        <PageHeader title="Trilha de auditoria" />
        {/* Transparência do suporte (#913): independe de SUPER_ADMIN — gate
            próprio por permissão (iam.audit-logs.view) dentro do card. */}
        <div className="mb-5">
          <SupportAccessCard />
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldX size={32} className="text-content-muted" />
            <p className="text-sm text-content-muted">Acesso restrito a administradores (SUPER_ADMIN).</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Trilha de auditoria" description="Registro de alterações realizadas no sistema." />

      <div className="mb-5">
        <SupportAccessCard />
      </div>

      {logsQ.isError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Não foi possível carregar a trilha de auditoria. Verifique os filtros e tente de novo;
            se persistir, fale com o administrador.
          </span>
        </div>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label>Entidade</Label>
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }}>
            <option value="">Todas</option>
            {ENTITIES.map((en) => <option key={en} value={en}>{en}</option>)}
          </Select>
        </div>
        <div>
          <Label>Usuário</Label>
          <Select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(0); }}>
            <option value="">Todos</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
        <div>
          <Label>Ação</Label>
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
            <option value="">Todas</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Período</Label>
          <DateRangePicker
            value={range}
            onValueChange={(r) => {
              setRange(r);
              setPage(0);
            }}
            clearable
            placeholder="Qualquer período"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {logsQ.isLoading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : paged.length === 0 ? (
            <p className="py-16 text-center text-sm text-content-muted">
              {logsQ.isError
                ? 'Ainda não conseguimos carregar a trilha. Tente de novo mais tarde.'
                : 'Nenhum registro de auditoria encontrado.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-secondary text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <th className="w-8 px-2 py-3"></th>
                  <th className="px-4 py-3 text-left">Data/hora</th>
                  <th className="px-4 py-3 text-left">Usuário</th>
                  <th className="px-4 py-3 text-left">Entidade</th>
                  <th className="px-4 py-3 text-left">Ação</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((log) => {
                  const isOpen = expanded.has(log.id);
                  const hasPayload = log.oldValue != null || log.newValue != null;
                  return (
                    <Fragment key={log.id}>
                      <tr
                        onClick={() => hasPayload && toggle(log.id)}
                        className={cn('border-b border-line', hasPayload && 'cursor-pointer hover:bg-surface-secondary')}
                      >
                        <td className="px-2 py-3 text-content-muted">
                          {hasPayload && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-content-secondary">{formatDateTime(log.createdAt)}</td>
                        <td className="px-4 py-3 text-content-secondary">{log.user?.name ?? '—'}</td>
                        <td className="px-4 py-3"><span className="font-mono text-xs">{log.entity}</span></td>
                        <td className="px-4 py-3 text-content-secondary">{log.action}</td>
                      </tr>
                      {isOpen && hasPayload && (
                        <tr className="border-b border-line bg-surface-secondary">
                          <td></td>
                          <td colSpan={4} className="px-4 py-3">
                            <pre className="max-h-72 overflow-auto rounded-lg bg-neutral-900 p-3 text-[11px] leading-relaxed text-neutral-100">
                              {JSON.stringify({ antes: log.oldValue ?? null, depois: log.newValue ?? null }, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-content-muted">
          <span>{total} registro{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-md px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40">Anterior</button>
            <span className="px-2 tabular-nums">{page + 1} / {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded-md px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}
