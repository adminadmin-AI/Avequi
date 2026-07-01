'use client';

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldX } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import type { User } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';

interface AuditLog {
  id: string;
  userId: string | null;
  user?: { id: string; name: string; email: string } | null;
  entity: string;
  action: string;
  payload?: unknown;
  createdAt: string;
}

const PAGE_SIZE = 50;
const ENTITIES = [
  'Product', 'SalesOrder', 'PurchaseOrder', 'FinancialEntry', 'StockMovement',
  'ProductionOrder', 'FiscalDocument', 'Customer', 'Supplier', 'User', 'WorkCenter',
  'RoutingStep', 'BomVersion', 'NfeManifest',
];

export default function AuditLogPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: users = [] } = useList<User>('/users', undefined, { enabled: isSuperAdmin });

  const logsQ = useQuery({
    queryKey: ['/audit-logs', entity, userId, action, from, to],
    enabled: isSuperAdmin,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<AuditLog[]>('/audit-logs', {
          params: {
            entity: entity || undefined,
            userId: userId || undefined,
            action: action || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
      ).data,
  });

  const logs = logsQ.data ?? [];
  const pageCount = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(
    () => logs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [logs, safePage],
  );

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
        <PageHeader title="Log de Auditoria" />
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
      <PageHeader title="Log de Auditoria" description="Registro de alterações realizadas no sistema." />

      {logsQ.isError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            O endpoint <code>GET /audit-logs</code> ainda <strong>não está disponível no backend</strong> — os
            AuditLogs são gravados por alguns serviços, mas não há rota de leitura consolidada. Esta tela já está
            pronta para consumi-lo assim que existir (pendência registrada na #247).
          </span>
        </div>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
          <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} placeholder="Ex.: CREATE, UPDATE" />
        </div>
        <div>
          <Label>De</Label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        </div>
        <div>
          <Label>Até</Label>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {logsQ.isLoading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : paged.length === 0 ? (
            <p className="py-16 text-center text-sm text-content-muted">
              {logsQ.isError ? 'Sem dados (endpoint indisponível).' : 'Nenhum registro de auditoria encontrado.'}
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
                  const hasPayload = log.payload != null;
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
                              {JSON.stringify(log.payload, null, 2)}
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
          <span>{logs.length} registro{logs.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="rounded-md px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40">Anterior</button>
            <span className="px-2 tabular-nums">{safePage + 1} / {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} className="rounded-md px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}
