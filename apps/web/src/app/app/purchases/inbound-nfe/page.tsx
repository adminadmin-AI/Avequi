'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Link2, Ban, FileDown, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type { PurchaseOrder } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { formatBRL, formatCNPJ, formatDate } from '@/lib/format';

type InboundStatus = 'PENDING' | 'MATCHED' | 'IMPORTED' | 'REJECTED';

interface InboundNfe {
  id: string;
  chaveNfe: string;
  nfeNumber?: string | null;
  series?: string | null;
  supplierCnpj: string;
  supplierName: string;
  issueDate?: string | null;
  totalValue?: string | null;
  status: InboundStatus;
  purchaseOrderId?: string | null;
}

const STATUS_META: Record<InboundStatus, { label: string; variant: any }> = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  MATCHED: { label: 'Vinculada', variant: 'info' },
  IMPORTED: { label: 'Importada', variant: 'success' },
  REJECTED: { label: 'Rejeitada', variant: 'danger' },
};

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

export default function InboundNfePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['/inbound-nfe'],
    queryFn: async () => (await apiClient.get<InboundNfe[]>('/inbound-nfe')).data,
  });
  const { data: pos = [] } = useList<PurchaseOrder>('/purchases/orders');
  const approvedPOs = pos.filter((p) => p.status === 'APPROVED' || p.status === 'PARTIALLY_RECEIVED');

  // Importar (upload XML)
  const [importOpen, setImportOpen] = useState(false);
  const [xmlContent, setXmlContent] = useState('');

  // Vincular PO
  const [linkTarget, setLinkTarget] = useState<InboundNfe | null>(null);
  const [linkPoId, setLinkPoId] = useState('');

  const upload = useMutation({
    mutationFn: (xml: string) => apiClient.post('/inbound-nfe/upload', { xmlContent: xml }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/inbound-nfe'] }),
  });
  const match = useMutation({
    mutationFn: ({ id, purchaseOrderId }: { id: string; purchaseOrderId: string }) =>
      apiClient.patch(`/inbound-nfe/${id}/match`, { purchaseOrderId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/inbound-nfe'] }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/inbound-nfe/${id}/reject`, { reason: 'Rejeitada manualmente' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/inbound-nfe'] }),
  });

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setXmlContent(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function submitImport() {
    if (!xmlContent.trim()) return toast.error('Cole o XML ou selecione um arquivo');
    upload.mutate(xmlContent, {
      onSuccess: () => {
        toast.success('NF-e importada');
        setImportOpen(false);
        setXmlContent('');
      },
      onError: () => toast.error('Falha ao importar — verifique o XML'),
    });
  }

  function submitLink() {
    if (!linkTarget || !linkPoId) return toast.error('Selecione a PO');
    match.mutate(
      { id: linkTarget.id, purchaseOrderId: linkPoId },
      {
        onSuccess: () => {
          toast.success('NF-e vinculada à PO');
          setLinkTarget(null);
          setLinkPoId('');
        },
        onError: () => toast.error('Não foi possível vincular'),
      },
    );
  }

  function downloadXml(nfe: InboundNfe) {
    apiClient
      .get<InboundNfe & { xmlContent?: string }>(`/inbound-nfe/${nfe.id}`)
      .then(({ data }) => {
        const xml = data.xmlContent;
        if (!xml) return toast.error('XML indisponível');
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nfe-${nfe.chaveNfe}.xml`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast.error('Erro ao baixar XML'));
  }

  const columns: Column<InboundNfe>[] = [
    {
      key: 'chave',
      header: 'Chave',
      cell: (n) => (
        <span className="font-mono text-xs" title={n.chaveNfe}>
          …{n.chaveNfe.slice(-12)}
        </span>
      ),
    },
    {
      key: 'supplier',
      header: 'Fornecedor',
      cell: (n) => (
        <div>
          <p className="text-sm text-content">{n.supplierName}</p>
          <p className="font-mono text-xs text-content-muted">{formatCNPJ(n.supplierCnpj)}</p>
        </div>
      ),
    },
    { key: 'number', header: 'Nº / Série', cell: (n) => `${n.nfeNumber ?? '—'} / ${n.series ?? '—'}` },
    { key: 'issueDate', header: 'Emissão', cell: (n) => (n.issueDate ? formatDate(n.issueDate) : '—') },
    {
      key: 'total',
      header: 'Valor',
      align: 'right',
      sortable: true,
      accessor: (n) => Number(n.totalValue ?? 0),
      cell: (n) => <span className="font-medium tabular-nums">{formatBRL(Number(n.totalValue ?? 0))}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: (n) => <Badge variant={STATUS_META[n.status].variant}>{STATUS_META[n.status].label}</Badge>,
    },
    {
      key: 'po',
      header: 'PO',
      cell: (n) => (n.purchaseOrderId ? <span className="font-mono text-xs">#{shortId(n.purchaseOrderId)}</span> : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (n) => (
        <div className="flex items-center justify-end gap-1">
          {n.status === 'PENDING' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLinkTarget(n);
                setLinkPoId('');
              }}
              title="Vincular a PO"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
            >
              <Link2 size={15} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadXml(n);
            }}
            title="Baixar XML"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <FileDown size={15} />
          </button>
          {(n.status === 'PENDING' || n.status === 'MATCHED') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                reject.mutate(n.id, {
                  onSuccess: () => toast.success('NF-e rejeitada'),
                  onError: () => toast.error('Erro ao rejeitar'),
                });
              }}
              title="Rejeitar"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
            >
              <Ban size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="NF-e de Entrada"
        description="Notas fiscais de fornecedores — importação e vínculo com pedidos de compra."
        actions={
          <Button onClick={() => setImportOpen(true)}>
            <Plus size={16} />
            Importar NF-e
          </Button>
        }
      />

      <DataTable
        data={list}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por fornecedor ou chave..."
        emptyMessage="Nenhuma NF-e de entrada."
      />

      {/* Importar */}
      <FormDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Importar NF-e"
        description="Cole o XML da NF-e ou selecione o arquivo."
        formId="import-nfe-form"
        submitLabel="Importar"
        loading={upload.isPending}
      >
        <form
          id="import-nfe-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitImport();
          }}
          className="space-y-3 py-1"
        >
          <div>
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              Selecionar arquivo XML
            </Button>
            <input ref={fileRef} type="file" accept=".xml,text/xml" onChange={onPickFile} className="hidden" />
          </div>
          <div>
            <Label>Conteúdo XML</Label>
            <textarea
              value={xmlContent}
              onChange={(e) => setXmlContent(e.target.value)}
              rows={6}
              placeholder="<?xml version=&quot;1.0&quot;?> ..."
              className="w-full rounded-lg border border-line p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            />
          </div>
          <p className="text-xs text-content-muted">
            A consulta automática à SEFAZ por chave de acesso não está disponível no backend; use o XML.
          </p>
        </form>
      </FormDialog>

      {/* Vincular a PO */}
      <FormDialog
        open={!!linkTarget}
        onOpenChange={(o) => !o && setLinkTarget(null)}
        title="Vincular a Pedido de Compra"
        description={linkTarget ? `NF-e de ${linkTarget.supplierName}` : ''}
        formId="link-po-form"
        submitLabel="Vincular"
        loading={match.isPending}
      >
        <form
          id="link-po-form"
          onSubmit={(e) => {
            e.preventDefault();
            submitLink();
          }}
          className="space-y-3 py-1"
        >
          <div>
            <Label required>Pedido de Compra (aprovado)</Label>
            <Select value={linkPoId} onChange={(e) => setLinkPoId(e.target.value)}>
              <option value="">— Selecione —</option>
              {approvedPOs.map((p) => (
                <option key={p.id} value={p.id}>
                  PO #{shortId(p.id)} — {p.supplier?.name ?? 'sem fornecedor'}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-content-muted">
            Ao vincular, o backend gera o recebimento (GR) e a conta a pagar automaticamente.
          </p>
        </form>
      </FormDialog>
    </div>
  );
}
