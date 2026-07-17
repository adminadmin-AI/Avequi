'use client';

import { useState } from 'react';
import { Plus, LifeBuoy } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useList, useCreate } from '@/hooks/use-resource';
import type { SupportIncident, SupportIncidentStatus } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';
import { IncidentForm, type CreateIncidentPayload } from './incident-form';

const RESOURCE = '/support/incidents';

const STATUS_LABEL: Record<SupportIncidentStatus, string> = {
  NEW: 'Novo',
  TRIAGING: 'Em triagem',
  TRIAGED: 'Triado',
  IN_PROGRESS: 'Em andamento',
  RESOLVED: 'Resolvido',
  CLOSED: 'Fechado',
};

const STATUS_VARIANT: Record<SupportIncidentStatus, BadgeVariant> = {
  NEW: 'info',
  TRIAGING: 'info',
  TRIAGED: 'info',
  IN_PROGRESS: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

/** Meus chamados — self-service de suporte (épico #764). */
export default function SupportPage() {
  const toast = useToast();

  const { data: incidents = [], isLoading } = useList<SupportIncident>(RESOURCE);
  const create = useCreate<SupportIncident, CreateIncidentPayload>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);

  function handleSubmit(values: CreateIncidentPayload) {
    create.mutate(values, {
      onSuccess: (data) => {
        toast.success(`Recebemos seu reporte — protocolo ${data.protocol}`);
        setDialogOpen(false);
      },
      onError: () => toast.error('Erro ao enviar o reporte'),
    });
  }

  const columns: Column<SupportIncident>[] = [
    {
      key: 'protocol',
      header: 'Protocolo',
      sortable: true,
      cell: (i) => <span className="font-mono text-xs">{i.protocol}</span>,
    },
    { key: 'title', header: 'Título', sortable: true },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      sortable: true,
      cell: (i) => <Badge variant={STATUS_VARIANT[i.status]}>{STATUS_LABEL[i.status]}</Badge>,
    },
    {
      key: 'createdAt',
      header: 'Aberto em',
      sortable: true,
      cell: (i) => formatDateTime(i.createdAt),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Meus chamados"
        description="Acompanhe os problemas que você reportou."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={16} />
            Reportar problema
          </Button>
        }
      />

      <DataTable
        data={incidents}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por protocolo ou título..."
        empty={
          <EmptyState
            icon={LifeBuoy}
            title="Nenhum chamado aberto"
            description="Encontrou um problema? Reporte para o nosso time."
            action={{ label: 'Reportar problema', icon: <Plus size={16} />, onClick: () => setDialogOpen(true) }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Reportar problema"
        description="Conte o que aconteceu — nosso time vai analisar."
        formId="incident-form"
        loading={create.isPending}
      >
        <IncidentForm formId="incident-form" onSubmit={handleSubmit} />
      </FormDialog>
    </div>
  );
}
