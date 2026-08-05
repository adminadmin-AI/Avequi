'use client';

import { useState } from 'react';
import { FileCheck2, Mail, RotateCw } from 'lucide-react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Can } from '@/components/can';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';

const RESOURCE = '/vehicle-tracking/renave/sales-order';

// ─── Tipos (espelham a resposta do orquestrador — #529-533) ──────────────────
type BinStatus = 'PENDING' | 'SUBMITTED' | 'REGISTERED' | 'REJECTED';
type RenaveOpType =
  | 'STOCK_IN'
  | 'SALE_OUT'
  | 'ATPVE_PDF'
  | 'RETURN_MANUFACTURER'
  | string;
type RenaveOpStatus = 'PENDING' | 'PROCESSING' | 'STOCK_CONFIRMED' | 'SALE_INTENT_CREATED' | 'ACTIVE' | 'ERROR' | 'CANCELLED' | string;
type AtpveStatus = 'PENDING' | 'ISSUED' | 'CANCELLED' | string;

interface SerialEntry {
  id: string;
  chassi: string | null;
  binRegistration?: {
    id: string;
    status: BinStatus;
    binNumber: string | null;
    registeredAt: string | null;
  } | null;
}

interface RenaveOperationEntry {
  id: string;
  type: RenaveOpType;
  status: RenaveOpStatus;
  serialNumberId: string;
  protocol: string | null;
  attempt: number;
  lastError: string | null;
  updatedAt: string;
}

interface AtpveRecordEntry {
  id: string;
  serialNumberId: string;
  status: AtpveStatus;
  atpveNumber: string | null;
  issuedAt: string | null;
  hasPdf: boolean;
}

interface RenaveSalesOrderStatus {
  enabled: boolean;
  serials: SerialEntry[];
  operations: RenaveOperationEntry[];
  atpveRecords: AtpveRecordEntry[];
}

// ─── Derivação de badges ──────────────────────────────────────────────────────
const BIN_BADGE: Record<BinStatus, { variant: BadgeVariant; label: string }> = {
  REGISTERED: { variant: 'success', label: 'Registrado' },
  PENDING: { variant: 'neutral', label: 'Pendente' },
  SUBMITTED: { variant: 'neutral', label: 'Enviado' },
  REJECTED: { variant: 'danger', label: 'Rejeitado' },
};

const RENAVE_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  STOCK_CONFIRMED: { variant: 'info', label: 'Em estoque' },
  SALE_INTENT_CREATED: { variant: 'success', label: 'Saída OK' },
  ACTIVE: { variant: 'success', label: 'Saída OK' },
  PENDING: { variant: 'neutral', label: 'Processando' },
  PROCESSING: { variant: 'neutral', label: 'Processando' },
  ERROR: { variant: 'danger', label: 'Erro' },
  CANCELLED: { variant: 'warning', label: 'Cancelada' },
};

const ATPVE_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  ISSUED: { variant: 'success', label: 'Emitida' },
  PENDING: { variant: 'neutral', label: 'Pendente' },
  CANCELLED: { variant: 'warning', label: 'Cancelada' },
};

/** Operação mais recente entre STOCK_IN/SALE_OUT define o badge RENAVE do chassi. */
function latestTrackedOperation(ops: RenaveOperationEntry[], serialNumberId: string) {
  const relevant = ops.filter(
    (o) => o.serialNumberId === serialNumberId && (o.type === 'STOCK_IN' || o.type === 'SALE_OUT'),
  );
  if (relevant.length === 0) return undefined;
  return relevant.reduce((latest, o) =>
    new Date(o.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? o : latest,
  );
}

function ChassiRow({
  serial,
  operations,
  atpveRecord,
  onRetried,
}: {
  serial: SerialEntry;
  operations: RenaveOperationEntry[];
  atpveRecord?: AtpveRecordEntry;
  onRetried: () => void;
}) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const bin = serial.binRegistration;
  const binBadge = bin ? BIN_BADGE[bin.status] : undefined;

  const renaveOp = latestTrackedOperation(operations, serial.id);
  const renaveBadge = renaveOp ? RENAVE_BADGE[renaveOp.status] : undefined;

  const atpveBadge = atpveRecord ? ATPVE_BADGE[atpveRecord.status] : undefined;

  const errorOps = operations.filter(
    (o) => o.serialNumberId === serial.id && o.status === 'ERROR',
  );

  const retry = useMutation({
    mutationFn: (operationId: string) =>
      apiClient.post(`/vehicle-tracking/renave/operations/${operationId}/retry`),
    onSuccess: () => {
      toast.success('Operação reenviada');
      onRetried();
    },
    onError: (err: any) => toast.error(erroDeAcao('reenviar a operação ao RENAVE', err)),
  });

  const resendEmail = useMutation({
    mutationFn: () => apiClient.post(`/vehicle-tracking/atpve/${atpveRecord?.id}/resend-email`),
    onSuccess: () => toast.success('E-mail da ATPV-e reenviado'),
    onError: (err: any) => toast.error(erroDeAcao('reenviar o e-mail da ATPV-e', err)),
  });

  async function downloadPdf() {
    if (!atpveRecord) return;
    setDownloading(true);
    try {
      const res = await apiClient.get(`/vehicle-tracking/atpve/${atpveRecord.id}/pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atpve-${serial.chassi ?? atpveRecord.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(erroDeAcao('baixar o PDF da ATPV-e', err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li className="space-y-1.5 rounded-md border border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-content-secondary">
          chassi {serial.chassi ?? '—'}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={binBadge?.variant ?? 'neutral'}>BIN: {binBadge?.label ?? '—'}</Badge>
          <Badge variant={renaveBadge?.variant ?? 'neutral'}>RENAVE: {renaveBadge?.label ?? '—'}</Badge>
          <Badge variant={atpveBadge?.variant ?? 'neutral'}>ATPV-e: {atpveBadge?.label ?? '—'}</Badge>
        </div>
      </div>

      {errorOps.map((op) => (
        <div
          key={op.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger/5 px-2 py-1.5"
        >
          <p className="max-w-[28rem] truncate text-xs text-danger" title={op.lastError ?? undefined}>
            {op.lastError ?? 'Erro não especificado'}
          </p>
          <Can permission="vehicle-tracking.renave.retry">
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<RotateCw size={13} />}
              onClick={() => retry.mutate(op.id)}
              loading={retry.isPending}
            >
              Tentar de novo
            </Button>
          </Can>
        </div>
      ))}

      {atpveRecord?.hasPdf && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            size="xs"
            variant="outline"
            leftIcon={<FileCheck2 size={13} />}
            onClick={downloadPdf}
            loading={downloading}
          >
            Baixar ATPV-e
          </Button>
          <Can permission="vehicle-tracking.atpve.update">
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<Mail size={13} />}
              onClick={() => resendEmail.mutate()}
              loading={resendEmail.isPending}
            >
              Reenviar e-mail
            </Button>
          </Can>
        </div>
      )}
    </li>
  );
}

export function VehicleDocsCard({ salesOrderId }: { salesOrderId: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<RenaveSalesOrderStatus>({
    queryKey: [RESOURCE, salesOrderId],
    enabled: !!salesOrderId,
    queryFn: async () => {
      const { data } = await apiClient.get<RenaveSalesOrderStatus>(`${RESOURCE}/${salesOrderId}`);
      return data;
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: [RESOURCE, salesOrderId] });
  }

  if (isLoading) {
    return (
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Documentação veicular</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Sem chassis rastreados nesta OV — nada a mostrar, inclusive com a flag
  // desligada (senão TODA venda sem veículo ganharia um card de aviso)
  if (!data.serials || data.serials.length === 0) return null;

  // OV tem chassi mas integração desabilitada: card neutro — pré-cadastro segue manual.
  if (data.enabled === false) {
    return (
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-base">Documentação veicular</CardTitle>
        </CardHeader>
        <CardContent className="pb-5">
          <EmptyState
            compact
            title="Integração RENAVE desativada"
            description="Pré-cadastro BIN e ATPV-e seguem manuais."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="text-base">Documentação veicular</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-5">
        <ul className="space-y-2">
          {data.serials.map((serial) => (
            <ChassiRow
              key={serial.id}
              serial={serial}
              operations={data.operations}
              atpveRecord={data.atpveRecords.find((r) => r.serialNumberId === serial.id)}
              onRetried={invalidate}
            />
          ))}
        </ul>
        <p className="border-t border-line pt-3 text-xs text-content-muted">
          Veículo já emplacado? A devolução deve ser feita como veículo usado, fora do RENAVE
          (manual).
        </p>
      </CardContent>
    </Card>
  );
}
