'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Plus, Pencil, Trash2, Truck, PackageCheck, FileCheck2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useList } from '@/hooks/use-resource';
import type {
  Product,
  Delivery,
  DeliveryStatus,
  VehicleDocument,
  VehicleDocumentType,
  VehicleDocumentStatus,
  SaleMissingDoc,
  ApiError,
} from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Combobox } from '@/components/ui/combobox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; variant: BadgeVariant }> = {
  AWAITING_BIN: { label: 'Aguardando BIN', variant: 'warning' },
  AWAITING_PICKUP: { label: 'Pronta p/ retirada', variant: 'info' },
  IN_TRANSIT: { label: 'Em trânsito', variant: 'brand' },
  DELIVERED: { label: 'Entregue', variant: 'success' },
  RETURNED: { label: 'Devolvida', variant: 'danger' },
};
const DOC_STATUS: Record<VehicleDocumentStatus, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'Ativo', variant: 'success' },
  EXPIRED: { label: 'Vencido', variant: 'warning' },
  REVOKED: { label: 'Revogado', variant: 'danger' },
};
const DOC_TYPE: Record<VehicleDocumentType, string> = { CAT: 'CAT', CCT: 'CCT', TECHNICAL_PROJECT: 'Projeto Técnico' };
const DELIVERED_TO: Record<string, string> = { RESELLER: 'Revenda', END_CUSTOMER: 'Cliente final' };

const apiMessage = (err: unknown) => {
  const m = (err as AxiosError<ApiError>)?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? 'Erro inesperado');
};
const short = (id: string) => id.slice(0, 8);

interface DocForm {
  id?: string;
  productId: string;
  type: VehicleDocumentType;
  documentNumber: string;
  issuedAt: string;
  expiresAt: string;
  fileUrl: string;
  status: VehicleDocumentStatus;
}
const EMPTY_DOC: DocForm = { productId: '', type: 'CAT', documentNumber: '', issuedAt: '', expiresAt: '', fileUrl: '', status: 'ACTIVE' };

interface StatusForm {
  status: DeliveryStatus;
  scheduledDate: string;
  transporterName: string;
  transporterCnpj: string;
  vehiclePlate: string;
  receivedBy: string;
  notes: string;
}
interface DocDeliveryForm {
  salesOrderId: string;
  serialNumberId: string;
  deliveredTo: string;
  deliveredBy: string;
}

export default function ShippingPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState('entregas');

  const { data: products = [] } = useList<Product>('/products');
  const productName = useMemo(() => new Map(products.map((p) => [p.id, `${p.sku} · ${p.name}`])), [products]);
  const productOptions = useMemo(() => products.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })), [products]);

  // ─── Entregas ───────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState('');
  const deliveries = useQuery<Delivery[]>({
    queryKey: ['deliveries', statusFilter],
    queryFn: async () => (await apiClient.get<Delivery[]>('/deliveries', { params: statusFilter ? { status: statusFilter } : {} })).data,
    retry: false,
  });

  const [statusDialog, setStatusDialog] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [statusForm, setStatusForm] = useState<StatusForm>({ status: 'AWAITING_BIN', scheduledDate: '', transporterName: '', transporterCnpj: '', vehiclePlate: '', receivedBy: '', notes: '' });

  const saveStatus = useMutation({
    mutationFn: async (f: StatusForm) => {
      const body: Record<string, unknown> = { status: f.status };
      for (const [k, v] of Object.entries({ scheduledDate: f.scheduledDate, transporterName: f.transporterName, transporterCnpj: f.transporterCnpj, vehiclePlate: f.vehiclePlate, receivedBy: f.receivedBy, notes: f.notes })) {
        if (v !== '') body[k] = v;
      }
      return (await apiClient.patch(`/deliveries/${editingDelivery!.id}/status`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      setStatusDialog(false);
    },
  });

  function openStatus(d: Delivery) {
    setEditingDelivery(d);
    setStatusForm({
      status: d.status,
      scheduledDate: d.scheduledDate?.slice(0, 10) ?? '',
      transporterName: d.transporterName ?? '',
      transporterCnpj: d.transporterCnpj ?? '',
      vehiclePlate: d.vehiclePlate ?? '',
      receivedBy: d.receivedBy ?? '',
      notes: d.notes ?? '',
    });
    setStatusDialog(true);
  }

  const deliveryColumns: Column<Delivery>[] = [
    { key: 'salesOrderId', header: 'OV', cell: (r) => <span className="font-mono text-caption">{short(r.salesOrderId)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={DELIVERY_STATUS[r.status].variant}>{DELIVERY_STATUS[r.status].label}</Badge> },
    { key: 'transporterName', header: 'Transportadora', cell: (r) => r.transporterName ?? '—' },
    { key: 'vehiclePlate', header: 'Placa', cell: (r) => r.vehiclePlate ?? '—' },
    { key: 'scheduledDate', header: 'Agendada', cell: (r) => (r.scheduledDate ? formatDate(r.scheduledDate) : '—') },
    { key: 'deliveredAt', header: 'Entregue em', cell: (r) => (r.deliveredAt ? formatDate(r.deliveredAt) : '—') },
    {
      key: '_acoes', header: '', align: 'right',
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => openStatus(r)}>
          <Pencil className="mr-1.5 h-4 w-4" /> Status
        </Button>
      ),
    },
  ];

  // ─── Documentos ─────────────────────────────────────────────────────────────
  const [docProductFilter, setDocProductFilter] = useState('');
  const documents = useQuery<VehicleDocument[]>({
    queryKey: ['vehicle-documents', docProductFilter],
    queryFn: async () => (await apiClient.get<VehicleDocument[]>('/vehicle-documents', { params: docProductFilter ? { productId: docProductFilter } : {} })).data,
    retry: false,
  });

  const [docDialog, setDocDialog] = useState(false);
  const [docForm, setDocForm] = useState<DocForm>(EMPTY_DOC);
  const [docDeliveryDialog, setDocDeliveryDialog] = useState(false);
  const [docForDelivery, setDocForDelivery] = useState<VehicleDocument | null>(null);
  const [docDeliveryForm, setDocDeliveryForm] = useState<DocDeliveryForm>({ salesOrderId: '', serialNumberId: '', deliveredTo: 'END_CUSTOMER', deliveredBy: '' });

  const saveDoc = useMutation({
    mutationFn: async (f: DocForm) => {
      if (f.id) {
        return (await apiClient.patch(`/vehicle-documents/${f.id}`, {
          documentNumber: f.documentNumber,
          status: f.status,
          expiresAt: f.expiresAt || undefined,
          fileUrl: f.fileUrl || undefined,
        })).data;
      }
      return (await apiClient.post('/vehicle-documents', {
        productId: f.productId, type: f.type, documentNumber: f.documentNumber,
        issuedAt: f.issuedAt, expiresAt: f.expiresAt || undefined, fileUrl: f.fileUrl || undefined, status: f.status,
      })).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-documents'] }); setDocDialog(false); },
  });
  const deleteDoc = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/vehicle-documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle-documents'] }),
  });
  const registerDocDelivery = useMutation({
    mutationFn: async (f: DocDeliveryForm) => (await apiClient.post(`/vehicle-documents/${docForDelivery!.id}/deliveries`, {
      salesOrderId: f.salesOrderId, serialNumberId: f.serialNumberId || undefined, deliveredTo: f.deliveredTo, deliveredBy: f.deliveredBy || undefined,
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-documents'] }); setDocDeliveryDialog(false); },
  });

  function openNewDoc() { setDocForm(EMPTY_DOC); setDocDialog(true); }
  function openEditDoc(d: VehicleDocument) {
    setDocForm({ id: d.id, productId: d.productId, type: d.type, documentNumber: d.documentNumber, issuedAt: d.issuedAt.slice(0, 10), expiresAt: d.expiresAt?.slice(0, 10) ?? '', fileUrl: d.fileUrl ?? '', status: d.status });
    setDocDialog(true);
  }
  function openDocDelivery(d: VehicleDocument) { setDocForDelivery(d); setDocDeliveryForm({ salesOrderId: '', serialNumberId: '', deliveredTo: 'END_CUSTOMER', deliveredBy: '' }); setDocDeliveryDialog(true); }
  async function confirmDeleteDoc(d: VehicleDocument) {
    if (await confirm({ title: `Remover ${DOC_TYPE[d.type]} nº ${d.documentNumber}?`, description: 'Você não vai conseguir desfazer isso.' })) deleteDoc.mutate(d.id);
  }

  const docColumns: Column<VehicleDocument>[] = [
    { key: 'productId', header: 'Produto', cell: (r) => productName.get(r.productId) ?? short(r.productId) },
    { key: 'type', header: 'Tipo', cell: (r) => <Badge variant="neutral">{DOC_TYPE[r.type]}</Badge> },
    { key: 'documentNumber', header: 'Nº documento' },
    { key: 'issuedAt', header: 'Emitido', cell: (r) => formatDate(r.issuedAt) },
    { key: 'expiresAt', header: 'Validade', cell: (r) => (r.expiresAt ? formatDate(r.expiresAt) : '—') },
    { key: 'status', header: 'Status', cell: (r) => <Badge variant={DOC_STATUS[r.status].variant}>{DOC_STATUS[r.status].label}</Badge> },
    {
      key: '_acoes', header: '', align: 'right',
      cell: (r) => (
        <span className="inline-flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => openDocDelivery(r)} aria-label="Registrar entrega"><PackageCheck className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => openEditDoc(r)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => confirmDeleteDoc(r)} aria-label="Remover"><Trash2 className="h-4 w-4 text-danger" /></Button>
        </span>
      ),
    },
  ];

  // ─── Pendências ─────────────────────────────────────────────────────────────
  const pending = useQuery<SaleMissingDoc[]>({
    queryKey: ['vehicle-documents', 'pending'],
    queryFn: async () => (await apiClient.get<SaleMissingDoc[]>('/vehicle-documents/pending-deliveries')).data,
    enabled: tab === 'pendencias',
    retry: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Expedição" description="Entregas pós-NF-e, documentos regulatórios e pendências" />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="entregas">Entregas</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="pendencias">Pendências</TabsTrigger>
        </TabsList>

        {/* ── Entregas ── */}
        <TabsContent value="entregas" className="space-y-4 pt-4">
          <div className="max-w-xs">
            <Field label="Filtrar por status">
              <Combobox
                options={[{ value: '', label: 'Todos' }, ...Object.entries(DELIVERY_STATUS).map(([v, m]) => ({ value: v, label: m.label }))]}
                value={statusFilter}
                onValueChange={setStatusFilter}
                placeholder="Todos"
              />
            </Field>
          </div>
          <Card>
            <CardContent className="pt-6">
              <DataTable
                data={deliveries.data ?? []}
                columns={deliveryColumns}
                rowKey={(r) => r.id}
                loading={deliveries.isLoading}
                searchPlaceholder="Buscar por OV / transportadora..."
                emptyMessage="Nenhuma entrega. Elas são criadas automaticamente ao faturar uma venda."
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Documentos ── */}
        <TabsContent value="documentos" className="space-y-4 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-64 flex-1 max-w-sm">
              <Field label="Filtrar por produto">
                <Combobox options={[{ value: '', label: 'Todos os produtos' }, ...productOptions]} value={docProductFilter} onValueChange={setDocProductFilter} placeholder="Todos os produtos" searchPlaceholder="Buscar produto..." clearable />
              </Field>
            </div>
            <Button onClick={openNewDoc}><Plus className="mr-1.5 h-4 w-4" /> Novo documento</Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              <DataTable
                data={documents.data ?? []}
                columns={docColumns}
                rowKey={(r) => r.id}
                loading={documents.isLoading}
                searchPlaceholder="Buscar por nº / produto..."
                emptyMessage="Nenhum documento cadastrado."
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Pendências ── */}
        <TabsContent value="pendencias" className="space-y-4 pt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="mb-4 text-body text-content-secondary">
                <FileCheck2 className="mr-1.5 inline h-4 w-4 text-warning" />
                Vendas de veículo faturadas que ainda <strong>não têm nenhum documento regulatório entregue</strong>.
              </p>
              <DataTable
                data={pending.data ?? []}
                columns={[
                  { key: 'id', header: 'OV', cell: (r) => <span className="font-mono text-caption">{short(r.id)}</span> },
                  { key: 'invoicedAt', header: 'Faturada em', cell: (r) => (r.invoicedAt ? formatDate(r.invoicedAt) : '—') },
                ]}
                rowKey={(r) => r.id}
                loading={pending.isLoading}
                searchable={false}
                emptyMessage="Nenhuma pendência. Todas as vendas de veículo têm documentos entregues. 🎉"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: atualizar status da entrega */}
      <FormDialog open={statusDialog} onOpenChange={setStatusDialog} title={`Entrega ${editingDelivery ? '· OV ' + short(editingDelivery.salesOrderId) : ''}`} formId="status-form" loading={saveStatus.isPending}>
        <form id="status-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveStatus.mutate(statusForm); }}>
          <Field label="Status" required>
            <Combobox options={Object.entries(DELIVERY_STATUS).map(([v, m]) => ({ value: v, label: m.label }))} value={statusForm.status} onValueChange={(v) => setStatusForm({ ...statusForm, status: v as DeliveryStatus })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Transportadora"><Input value={statusForm.transporterName} onChange={(e) => setStatusForm({ ...statusForm, transporterName: e.target.value })} /></Field>
            <Field label="CNPJ transportadora"><Input value={statusForm.transporterCnpj} onChange={(e) => setStatusForm({ ...statusForm, transporterCnpj: e.target.value })} /></Field>
            <Field label="Placa"><Input value={statusForm.vehiclePlate} onChange={(e) => setStatusForm({ ...statusForm, vehiclePlate: e.target.value })} /></Field>
            <Field label="Data agendada"><Input type="date" value={statusForm.scheduledDate} onChange={(e) => setStatusForm({ ...statusForm, scheduledDate: e.target.value })} /></Field>
          </div>
          <Field label="Recebido por"><Input value={statusForm.receivedBy} onChange={(e) => setStatusForm({ ...statusForm, receivedBy: e.target.value })} /></Field>
          <Field label="Observações"><Input value={statusForm.notes} onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })} /></Field>
          {saveStatus.isError && <p className="text-caption text-danger">{apiMessage(saveStatus.error)}</p>}
        </form>
      </FormDialog>

      {/* Dialog: documento */}
      <FormDialog open={docDialog} onOpenChange={setDocDialog} title={docForm.id ? 'Editar documento' : 'Novo documento regulatório'} formId="doc-form" loading={saveDoc.isPending}>
        <form id="doc-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveDoc.mutate(docForm); }}>
          {!docForm.id && (
            <>
              <Field label="Produto (modelo de reboque)" required>
                <Combobox options={productOptions} value={docForm.productId} onValueChange={(v) => setDocForm({ ...docForm, productId: v })} placeholder="Selecione o produto" searchPlaceholder="Buscar produto..." />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo" required>
                  <Combobox options={Object.entries(DOC_TYPE).map(([v, l]) => ({ value: v, label: l }))} value={docForm.type} onValueChange={(v) => setDocForm({ ...docForm, type: v as VehicleDocumentType })} />
                </Field>
                <Field label="Data de emissão" required>
                  <Input type="date" value={docForm.issuedAt} onChange={(e) => setDocForm({ ...docForm, issuedAt: e.target.value })} required />
                </Field>
              </div>
            </>
          )}
          <Field label="Nº do documento" required><Input value={docForm.documentNumber} onChange={(e) => setDocForm({ ...docForm, documentNumber: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Validade"><Input type="date" value={docForm.expiresAt} onChange={(e) => setDocForm({ ...docForm, expiresAt: e.target.value })} /></Field>
            <Field label="Status">
              <Combobox options={Object.entries(DOC_STATUS).map(([v, m]) => ({ value: v, label: m.label }))} value={docForm.status} onValueChange={(v) => setDocForm({ ...docForm, status: v as VehicleDocumentStatus })} />
            </Field>
          </div>
          <Field label="Link do arquivo (PDF)"><Input value={docForm.fileUrl} onChange={(e) => setDocForm({ ...docForm, fileUrl: e.target.value })} placeholder="https://..." /></Field>
          {saveDoc.isError && <p className="text-caption text-danger">{apiMessage(saveDoc.error)}</p>}
        </form>
      </FormDialog>

      {/* Dialog: registrar entrega de documento */}
      <FormDialog open={docDeliveryDialog} onOpenChange={setDocDeliveryDialog} title="Registrar entrega do documento" formId="doc-delivery-form" loading={registerDocDelivery.isPending}>
        <form id="doc-delivery-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); registerDocDelivery.mutate(docDeliveryForm); }}>
          <Field label="OV (salesOrderId)" required><Input value={docDeliveryForm.salesOrderId} onChange={(e) => setDocDeliveryForm({ ...docDeliveryForm, salesOrderId: e.target.value })} required placeholder="ID da ordem de venda" /></Field>
          <Field label="Chassi (serialNumberId, opcional)"><Input value={docDeliveryForm.serialNumberId} onChange={(e) => setDocDeliveryForm({ ...docDeliveryForm, serialNumberId: e.target.value })} /></Field>
          <Field label="Entregue a" required>
            <Combobox options={Object.entries(DELIVERED_TO).map(([v, l]) => ({ value: v, label: l }))} value={docDeliveryForm.deliveredTo} onValueChange={(v) => setDocDeliveryForm({ ...docDeliveryForm, deliveredTo: v })} />
          </Field>
          <Field label="Entregue por"><Input value={docDeliveryForm.deliveredBy} onChange={(e) => setDocDeliveryForm({ ...docDeliveryForm, deliveredBy: e.target.value })} /></Field>
          {registerDocDelivery.isError && <p className="text-caption text-danger">{apiMessage(registerDocDelivery.error)}</p>}
        </form>
      </FormDialog>
    </div>
  );
}
