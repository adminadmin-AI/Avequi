'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Can } from '@/components/can';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/format';
import type { SupportAccessLog } from '@/types/api';

function SupportAccessList() {
  const { data, isError, isLoading } = useQuery<SupportAccessLog[]>({
    queryKey: ['/support-access'],
    queryFn: async () => (await apiClient.get<SupportAccessLog[]>('/support-access')).data,
    retry: false,
  });

  // Fail-soft: mesmo com <Can> liberando a UI, o backend pode recusar (403)
  // ou falhar por outro motivo — a seção some, nunca mostra um erro.
  if (isError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acessos do suporte</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-content-muted">Nenhuma sessão de suporte registrada.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {data.map((log) => (
              <li key={log.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-content">
                    {log.user?.name ?? 'Suporte Avecchi'}
                    {log.newValue?.targetEmail && (
                      <>
                        {' '}
                        — visualizando como{' '}
                        <span className="font-mono text-xs">{log.newValue.targetEmail}</span>
                      </>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-content-muted">
                    {log.action === 'CANCEL' && <Badge variant="warning">encerrada antes</Badge>}
                    <span title={formatDateTime(log.createdAt)}>{formatDateTime(log.createdAt)}</span>
                  </div>
                </div>
                {log.newValue?.reason && (
                  <p className="mt-1 text-content-secondary">{log.newValue.reason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Transparência ao cliente das sessões de suporte (impersonation) sobre a
 * própria conta — OPS WP6 (#913). Consome GET /support-access
 * (perm iam.audit-logs.view). Gate na UI + fail-soft dentro da lista: quem
 * não tem a permissão simplesmente não vê a seção existir.
 */
export function SupportAccessCard() {
  return (
    <Can permission="iam.audit-logs.view">
      <SupportAccessList />
    </Can>
  );
}
