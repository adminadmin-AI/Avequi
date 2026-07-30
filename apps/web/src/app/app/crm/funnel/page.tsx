'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GripVertical, Loader2, MessageCircle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { LOST_REASON_OPTIONS, type LostReasonCategory } from '@/lib/crm-lost-reasons';
import { Board, BoardColumn, BoardLead, SOURCE_LABEL, formatBRL } from './funnel-types';

/**
 * Kanban do funil por loja (CRM F2.1 #514). Drag&drop nativo HTML5 — o backend
 * calcula a posição pela média dos vizinhos (padrão Twenty). Perdido abre modal
 * de motivo. Gerente vê todas as lojas via scope; vendedor vê as suas.
 */
export default function FunnelPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const queryClient = useQueryClient();
  const isManager = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'].includes(user?.role ?? '');

  const [scope, setScope] = useState<'mine' | 'all'>(isManager ? 'all' : 'mine');
  const [dragged, setDragged] = useState<BoardLead | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ lead: BoardLead; stageId: string } | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostCategory, setLostCategory] = useState<LostReasonCategory | ''>('');

  const { data: board, isLoading } = useQuery<Board>({
    queryKey: ['crm-board', scope],
    queryFn: async () => (await apiClient.get('/crm/board', { params: { scope } })).data,
    refetchInterval: 8000,
  });

  const move = useMutation({
    mutationFn: (body: {
      leadId: string;
      stageId: string;
      beforeLeadId?: string;
      afterLeadId?: string;
      lostReason?: string;
      lostReasonCategory?: LostReasonCategory;
    }) => apiClient.patch(`/crm/leads/${body.leadId}/move`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-board'] });
      setLostPrompt(null);
      setLostReason('');
      setLostCategory('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao mover'),
  });

  function onDrop(column: BoardColumn, index: number) {
    if (!dragged) return;
    const lead = dragged;
    setDragged(null);
    if (column.stage.type === 'LOST') {
      setLostPrompt({ lead, stageId: column.stage.id });
      return;
    }
    const list = column.leads.filter((l) => l.id !== lead.id);
    const before = list[index - 1];
    const after = list[index];
    move.mutate({
      leadId: lead.id,
      stageId: column.stage.id,
      beforeLeadId: before?.id,
      afterLeadId: after?.id,
    });
  }

  const columns = board?.columns ?? [];
  const grandTotal = useMemo(
    () => columns.reduce((sum, c) => (c.stage.type === 'OPEN' ? sum + c.totalValue : sum), 0),
    [columns],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funil"
        description="Kanban de leads por loja"
        actions={
          <div className="flex items-center gap-3">
            {isManager && (
              <div className="flex gap-1">
                {(['mine', 'all'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      scope === s ? 'bg-brand-600/[0.10] font-medium text-brand-700 dark:text-brand-300' : 'text-content-secondary hover:bg-neutral-500/[0.06]'
                    }`}
                  >
                    {s === 'mine' ? 'Meus' : 'Todas as lojas'}
                  </button>
                ))}
              </div>
            )}
            <span className="text-sm text-content-muted">
              Pipeline aberto: <b>{formatBRL(grandTotal)}</b>
            </span>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
        </div>
      ) : (
        // F4 (recalibrada com o Claudio): lane com tint suave SEMPRE visível —
        // contenção clara da coluna sem virar caixa pesada; o tint sobe um
        // ponto durante o drag como affordance de drop
        <div className="flex gap-5 overflow-x-auto pb-4">
          {columns.map((column) => (
            <div
              key={column.stage.id}
              className={`flex w-72 shrink-0 flex-col rounded-xl transition-colors duration-fast ${
                dragged ? 'bg-neutral-500/[0.08]' : 'bg-neutral-500/[0.05]'
              }`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(column, column.leads.length)}
            >
              <div className="flex items-center justify-between px-3 pb-2 pt-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: column.stage.color ?? '#94a3b8' }}
                  />
                  <span className="text-sm font-medium">{column.stage.name}</span>
                  <span className="text-[11px] tabular-nums text-content-muted">{column.count}</span>
                </div>
                {column.totalValue > 0 && (
                  <span className="text-[11px] text-content-muted">
                    {formatBRL(column.totalValue)}
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto p-2">
                {column.leads.map((lead, index) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragged(lead)}
                    onDragEnd={() => setDragged(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      onDrop(column, index);
                    }}
                    className={`group surface-sheen cursor-grab rounded-lg bg-surface p-3 text-sm shadow-soft transition-shadow hover:shadow-md active:cursor-grabbing ${
                      dragged?.id === lead.id ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="flex items-start gap-1">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-content-muted opacity-0 group-hover:opacity-100" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-medium">
                            {lead.name ?? lead.phone ?? 'Sem nome'}
                          </span>
                          {lead.unreadCount > 0 && (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] text-white">
                              {lead.unreadCount}
                            </span>
                          )}
                        </div>
                        {lead.interest && (
                          <p className="truncate text-xs text-content-muted">{lead.interest}</p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {/* F4 dieta de badges: origem é metadado, não alarme — texto mudo */}
                          <span className="text-[10px] text-content-muted">
                            {SOURCE_LABEL[lead.source] ?? lead.source}
                          </span>
                          {Number(lead.estimatedValue ?? 0) > 0 && (
                            <span className="text-[10px] text-content-muted">
                              {formatBRL(Number(lead.estimatedValue))}
                            </span>
                          )}
                          {scope === 'all' && lead.assignedTo && (
                            <span className="text-[10px] text-content-muted">
                              {lead.assignedTo.name}
                            </span>
                          )}
                          <Link
                            href="/app/crm/inbox"
                            className="ml-auto text-content-muted hover:text-content"
                            title="Abrir no inbox"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {/* Coluna vazia: placeholder tracejado dentro da lane;
                    acende em brand como alvo durante o drag */}
                {column.leads.length === 0 && (
                  <div
                    className={`rounded-lg border border-dashed py-10 text-center text-xs transition-colors duration-fast ${
                      dragged
                        ? 'border-brand-600/50 bg-brand-600/[0.05] text-content-secondary'
                        : 'border-[color:var(--border-strong)] text-content-muted'
                    }`}
                  >
                    {dragged ? 'solte aqui' : 'Sem leads neste estágio'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {lostPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-surface-elevated p-4 shadow-elevation-4">
            <h2 className="font-medium">Motivo da perda</h2>
            <p className="text-sm text-content-muted">
              Marcando <b>{lostPrompt.lead.name ?? lostPrompt.lead.phone}</b> como perdido.
            </p>
            <select
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-content"
              value={lostCategory}
              onChange={(e) => setLostCategory(e.target.value as LostReasonCategory | '')}
            >
              <option value="">Categoria (obrigatória)…</option>
              {LOST_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-content"
              placeholder="Detalhe opcional (ex.: achou R$ 2 mil mais barato na X)"
              value={lostReason}
              maxLength={300}
              onChange={(e) => setLostReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-sm text-content-secondary transition-colors duration-micro hover:bg-neutral-500/[0.06]"
                onClick={() => {
                  setLostPrompt(null);
                  setLostReason('');
                  setLostCategory('');
                }}
              >
                Cancelar
              </button>
              <button
                className="rounded-md bg-danger px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={!lostCategory || move.isPending}
                onClick={() =>
                  move.mutate({
                    leadId: lostPrompt.lead.id,
                    stageId: lostPrompt.stageId,
                    lostReasonCategory: lostCategory as LostReasonCategory,
                    ...(lostReason.trim() ? { lostReason: lostReason.trim() } : {}),
                  })
                }
              >
                Confirmar perda
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
