'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { formatBRL, formatDate } from '@/lib/format';
import type { MyBillingStatus } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useToast } from '@/components/ui/toast';

const NOTICE_SESSION_KEY = 'avequi:billing-notice-shown';

/**
 * Banner de inadimplência do app do CLIENTE — OPS WP5 (#912). Consome
 * GET /billing/me/status (régua: D+3 aviso discreto · D+10 banner
 * persistente); suspender a conta continua sendo ação manual do operador
 * (OPS WP1) — isto é só aviso.
 *
 * Fail-soft por design: 'none' e erro na chamada não renderizam nada — o
 * banner é conveniência, nunca pode derrubar o app do cliente.
 */
export function BillingBanner() {
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const noticeShown = useRef(false);

  const { data } = useQuery<MyBillingStatus>({
    queryKey: ['/billing/me/status'],
    queryFn: async () => (await apiClient.get<MyBillingStatus>('/billing/me/status')).data,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!data || data.level !== 'notice' || noticeShown.current) return;
    if (typeof window !== 'undefined' && sessionStorage.getItem(NOTICE_SESSION_KEY)) return;
    noticeShown.current = true;
    try {
      sessionStorage.setItem(NOTICE_SESSION_KEY, '1');
    } catch {
      /* storage indisponível — o pior caso é o aviso repetir na sessão */
    }
    toast.warning(
      'Fatura em aberto',
      `${data.message} Vencimento ${formatDate(data.dueDate)} · ${formatBRL(data.amountCents / 100)}`,
    );
  }, [data, toast]);

  if (!data || data.level !== 'banner') return null;

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-danger-200 bg-danger-50 px-4 py-2.5 text-sm text-danger-700 sm:px-6 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-400"
    >
      <AlertTriangle size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {data.message} Vencimento {formatDate(data.dueDate)} · {formatBRL(data.amountCents / 100)}
      </span>
    </div>
  );
}
