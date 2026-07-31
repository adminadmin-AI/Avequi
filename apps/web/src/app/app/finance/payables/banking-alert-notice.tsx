'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import type { BankingAlertResponse } from '@/types/api';
import { bankingAlertMessage } from './detail';

/**
 * Aviso anti-fraude (#864): o fornecedor do título TROCOU chave PIX/dados
 * bancários nos últimos 15 dias — a janela clássica do "golpe da chave
 * trocada". Aparece no painel de detalhe e no diálogo de baixa. Silencioso
 * quando não há troca recente (caso normal) e degrada mudo se a API de prod
 * ainda não tiver o endpoint (404 → nada).
 */
export function BankingAlertNotice({ entryId }: { entryId: string | null | undefined }) {
  const { data } = useQuery({
    queryKey: ['/finance/entries', entryId, 'banking-alert'],
    queryFn: async () =>
      (await apiClient.get<BankingAlertResponse>(`/finance/entries/${entryId}/banking-alert`)).data,
    enabled: !!entryId,
    retry: false,
    staleTime: 60_000,
  });

  const alert = data?.alert;
  if (!alert) return null;

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
      <p className="text-content">
        <span className="font-medium">{bankingAlertMessage(alert, new Date())}.</span>{' '}
        <span className="text-content-secondary">
          Confirme os dados com o fornecedor por outro canal antes de pagar.
        </span>
      </p>
    </div>
  );
}
