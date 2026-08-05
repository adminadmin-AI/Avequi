'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Customer } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { erroDeAcao } from '@/lib/feedback';
import { formatCpfCnpj, unmask } from '@/lib/format';
import { CUSTOMER_TYPE_LABELS } from '@/lib/enums';
import { CustomerForm, type CustomerFormValues } from './customer-form';
import { CustomerAddresses } from './customer-addresses';
import { CustomerExtras } from './customer-extras';
import { Select } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const RESOURCE = '/customers';

export default function CustomersPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [tagFilter, setTagFilter] = useState('');
  const { data: customers = [], isLoading } = useList<Customer>(RESOURCE, {
    tagId: tagFilter || undefined,
  });
  // #476: tags com contagem — filtro + contadores de segmentação
  const { data: tags = [] } = useQuery<Array<{ id: string; name: string; _count?: { links: number } }>>({
    queryKey: ['/customers/tags'],
    queryFn: async () => (await apiClient.get('/customers/tags')).data,
  });
  const create = useCreate<Customer, Record<string, unknown>>(RESOURCE);
  const update = useUpdate<Customer>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    setDialogOpen(true);
  }

  function handleSubmit(values: CustomerFormValues) {
    const payload = {
      ...values,
      document: values.document ? unmask(values.document) : undefined,
      zipCode: values.zipCode ? unmask(values.zipCode) : undefined,
      // strings vazias estouram @IsEmail/@IsEnum no backend — enviar undefined
      email: values.email || undefined,
      birthDate: (values as any).birthDate ? new Date((values as any).birthDate).toISOString() : undefined,
      fiscalEmail: values.fiscalEmail || undefined,
      indIeDest: values.indIeDest || undefined,
      // #475: crédito e padrões comerciais
      creditLimit: values.creditLimit ? Number(values.creditLimit) : undefined,
      billingBlockReason: values.billingBlocked ? values.billingBlockReason || undefined : undefined,
      defaultSellerId: values.defaultSellerId || undefined,
      defaultPaymentTerms: values.defaultPaymentTerms || undefined,
      defaultCarrierId: values.defaultCarrierId || undefined,
      internalNotes: values.internalNotes || undefined,
      creditScore: values.creditScore || undefined,
      creditNotes: values.creditNotes || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Cliente atualizado');
            setDialogOpen(false);
          },
          onError: (err) => toast.error(erroDeAcao('atualizar o cliente', err)),
        },
      );
    } else {
      create.mutate(
        payload,
        {
          onSuccess: () => {
            toast.success('Cliente criado');
            setDialogOpen(false);
          },
          onError: (err) => toast.error(erroDeAcao('criar o cliente', err)),
        },
      );
    }
  }

  async function toggleActive(c: Customer) {
    const turningOff = c.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar cliente?' : 'Reativar cliente?',
      description: turningOff
        ? `"${c.name}" deixará de aparecer nas operações.`
        : `"${c.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: c.id, data: { isActive: !c.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Cliente desativado' : 'Cliente reativado'),
        onError: (err) => toast.error(erroDeAcao('alterar o status do cliente', err)),
      },
    );
  }

  const columns: Column<Customer>[] = [
    {
      key: 'type',
      header: 'Tipo',
      align: 'center',
      sortable: true,
      cell: (c) => (
        <span className="inline-flex items-center gap-1">
          <Badge variant={c.type === 'COMPANY' ? 'brand' : 'neutral'}>
            {c.type === 'COMPANY' ? 'PJ' : 'PF'}
          </Badge>
          {(c as any).billingBlocked && (
            <Badge variant="danger" title={(c as any).billingBlockReason ?? 'Faturamento bloqueado'}>
              Bloqueado
            </Badge>
          )}
        </span>
      ),
      accessor: (c) => CUSTOMER_TYPE_LABELS[c.type],
    },
    { key: 'name', header: 'Nome / Razão social', sortable: true },
    {
      key: 'document',
      header: 'CPF / CNPJ',
      cell: (c) => (c.document ? <span className="font-mono text-xs">{formatCpfCnpj(c.document)}</span> : '—'),
    },
    {
      key: 'tags',
      header: 'Tags',
      cell: (c) => {
        const links = (c as any).tagLinks as Array<{ tag: { id: string; name: string } }> | undefined;
        if (!links?.length) return <span className="text-xs text-content-muted">—</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {links.map((l) => (
              <Badge key={l.tag.id} variant="neutral">{l.tag.name}</Badge>
            ))}
          </span>
        );
      },
    },
    {
      key: 'city',
      header: 'Cidade/UF',
      cell: (c) => (c.city ? `${c.city}${c.state ? '/' + c.state : ''}` : '—'),
    },
    { key: 'email', header: 'E-mail', cell: (c) => c.email || '—' },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (c) => (c.isActive ? 1 : 0),
      cell: (c) => (
        <Badge variant={c.isActive ? 'success' : 'neutral'}>
          {c.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(c);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(c);
            }}
            title={c.isActive ? 'Desativar' : 'Reativar'}
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger"
          >
            <Power size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes pessoa física e jurídica."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo cliente
          </Button>
        }
      />

      {tags.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <Select
            aria-label="Filtrar por tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-64"
          >
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t._count?.links ?? 0})
              </option>
            ))}
          </Select>
        </div>
      )}

      <DataTable
        data={customers}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por nome ou documento..."
        empty={
          <EmptyState
            icon={Users}
            title="Nenhum cliente cadastrado"
            description="Comece adicionando seu primeiro cliente."
            action={{ label: 'Novo cliente', icon: <Plus size={16} />, onClick: openCreate }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados do cliente.'}
        formId="customer-form"
        loading={create.isPending || update.isPending}
        size="lg"
      >
        <CustomerForm
          key={editing?.id ?? 'new'}
          formId="customer-form"
          defaultValues={
            editing
              ? {
                  type: editing.type,
                  name: editing.name,
                  document: editing.document ? formatCpfCnpj(editing.document) : '',
                  email: editing.email ?? '',
                  phone: editing.phone ?? '',
                  zipCode: editing.zipCode ?? '',
                  address: editing.address ?? '',
                  number: editing.number ?? '',
                  complement: editing.complement ?? '',
                  neighborhood: editing.neighborhood ?? '',
                  city: editing.city ?? '',
                  state: editing.state ?? '',
                  ibgeCode: editing.ibgeCode ?? '',
                  razaoSocial: editing.razaoSocial ?? '',
                  ie: editing.ie ?? '',
                  indIeDest: editing.indIeDest ?? '',
                  isRuralProducer: editing.isRuralProducer ?? false,
                  isSimplesNacional: editing.isSimplesNacional ?? false,
                  fiscalEmail: editing.fiscalEmail ?? '',
                  contactName: editing.contactName ?? '',
                  birthDate: (editing as any).birthDate ? String((editing as any).birthDate).slice(0, 10) : '',
                  creditLimit: (editing as any).creditLimit != null ? String((editing as any).creditLimit) : '',
                  billingBlocked: (editing as any).billingBlocked ?? false,
                  billingBlockReason: (editing as any).billingBlockReason ?? '',
                  defaultSellerId: (editing as any).defaultSellerId ?? '',
                  defaultPaymentTerms: (editing as any).defaultPaymentTerms ?? '',
                  defaultCarrierId: (editing as any).defaultCarrierId ?? '',
                  internalNotes: (editing as any).internalNotes ?? '',
                  creditScore: (editing as any).creditScore ?? '',
                  creditNotes: (editing as any).creditNotes ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
        {editing ? (
          <>
            <CustomerAddresses customerId={editing.id} />
            <CustomerExtras customerId={editing.id} />
          </>
        ) : (
          <p className="mt-4 border-t border-line pt-4 text-sm text-content-muted">
            Salve o cliente para cadastrar endereços de entrega (grupo entrega da NF-e).
          </p>
        )}
      </FormDialog>
    </div>
  );
}
