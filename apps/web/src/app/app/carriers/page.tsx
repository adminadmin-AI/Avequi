'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, Truck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { Carrier } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { erroDeAcao } from '@/lib/feedback';
import { formatCpfCnpj, unmask } from '@/lib/format';
import { CarrierForm, type CarrierFormValues } from './carrier-form';

const RESOURCE = '/carriers';

/** Transportadoras — grupo transp da NF-e (#481) */
export default function CarriersPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: carriers = [], isLoading } = useList<Carrier>(RESOURCE);
  const create = useCreate<Carrier, CarrierFormValues>(RESOURCE);
  const update = useUpdate<Carrier>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Carrier | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: Carrier) {
    setEditing(c);
    setDialogOpen(true);
  }

  function handleSubmit(values: CarrierFormValues) {
    const payload = {
      ...values,
      document: values.document ? unmask(values.document) : undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Transportadora atualizada');
            setDialogOpen(false);
          },
          onError: (err) => toast.error(erroDeAcao('atualizar a transportadora', err)),
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success('Transportadora criada');
          setDialogOpen(false);
        },
        onError: (err) => toast.error(erroDeAcao('criar a transportadora', err)),
      });
    }
  }

  async function toggleActive(c: Carrier) {
    const turningOff = c.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar transportadora?' : 'Reativar transportadora?',
      description: turningOff
        ? `"${c.name}" deixará de aparecer nas vendas.`
        : `"${c.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: c.id, data: { isActive: !c.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Transportadora desativada' : 'Transportadora reativada'),
        onError: (err) => toast.error(erroDeAcao('alterar o status da transportadora', err)),
      },
    );
  }

  const columns: Column<Carrier>[] = [
    { key: 'name', header: 'Nome', sortable: true },
    {
      key: 'document',
      header: 'CPF/CNPJ',
      cell: (c) => (c.document ? <span className="font-mono text-xs">{formatCpfCnpj(c.document)}</span> : '—'),
    },
    {
      key: 'city',
      header: 'Cidade/UF',
      cell: (c) => (c.city ? `${c.city}${c.state ? '/' + c.state : ''}` : '—'),
    },
    {
      key: 'vehiclePlate',
      header: 'Placa',
      cell: (c) => (c.vehiclePlate ? <span className="font-mono text-xs">{c.vehiclePlate}</span> : '—'),
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (c) => (c.isActive ? 1 : 0),
      cell: (c) => (
        <Badge variant={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Ativa' : 'Inativa'}</Badge>
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
        title="Transportadoras"
        description="Cadastro de transportadoras (grupo transportador da NF-e)."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Nova transportadora
          </Button>
        }
      />

      <DataTable
        data={carriers}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por nome ou documento..."
        empty={
          <EmptyState
            icon={Truck}
            title="Nenhuma transportadora cadastrada"
            description="Cadastre transportadoras para usar frete de terceiros nas vendas."
            action={{ label: 'Nova transportadora', icon: <Plus size={16} />, onClick: openCreate }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar transportadora' : 'Nova transportadora'}
        description={editing ? `Editando "${editing.name}"` : 'Preencha os dados da transportadora.'}
        formId="carrier-form"
        loading={create.isPending || update.isPending}
      >
        <CarrierForm
          key={editing?.id ?? 'new'}
          formId="carrier-form"
          defaultValues={
            editing
              ? {
                  name: editing.name,
                  razaoSocial: editing.razaoSocial ?? '',
                  document: editing.document ? formatCpfCnpj(editing.document) : '',
                  ie: editing.ie ?? '',
                  address: editing.address ?? '',
                  city: editing.city ?? '',
                  state: editing.state ?? '',
                  vehiclePlate: editing.vehiclePlate ?? '',
                  vehiclePlateState: editing.vehiclePlateState ?? '',
                  rntc: editing.rntc ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
