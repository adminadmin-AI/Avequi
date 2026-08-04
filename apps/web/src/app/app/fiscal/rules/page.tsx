'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, Scale } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TaxRuleForm, TAX_OPERATION_LABELS, type TaxRuleFormValues } from './tax-rule-form';

const RESOURCE = '/tax-rules';

interface TaxRule {
  id: string;
  operationType: string;
  ncm: string | null;
  ufOrigem: string | null;
  ufDestino: string | null;
  cfop: string;
  icmsCst: string;
  icmsAliquota: string | number;
  icmsBaseReducao: string | number;
  ipiCst: string;
  ipiAliquota: string | number;
  pisCst: string;
  pisAliquota: string | number;
  cofinsCst: string;
  cofinsAliquota: string | number;
  icmsInternaDestino: string | number | null;
  fcpAliquotaDestino: string | number | null;
  cClassTrib: string | null;
  cbsCst: string | null;
  cbsAliquota: string | number | null;
  ibsUfCst: string | null;
  ibsUfAliquota: string | number | null;
  ibsMunCst: string | null;
  ibsMunAliquota: string | number | null;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  description: string | null;
  isActive: boolean;
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : null);

/** Vigência da regra hoje: ativa, futura ou expirada (#500) */
function vigencia(r: TaxRule): { label: string; variant: 'success' | 'warning' | 'neutral' } {
  const now = Date.now();
  if (r.validFrom && new Date(r.validFrom).getTime() > now) {
    return { label: `A partir de ${fmtDate(r.validFrom)}`, variant: 'warning' };
  }
  if (r.validTo && new Date(r.validTo).getTime() < now) {
    return { label: `Expirou ${fmtDate(r.validTo)}`, variant: 'neutral' };
  }
  if (!r.validFrom && !r.validTo) return { label: 'Sem limite', variant: 'success' };
  return {
    label: `${fmtDate(r.validFrom) ?? '…'} → ${fmtDate(r.validTo) ?? 'sem fim'}`,
    variant: 'success',
  };
}

/** Regras Fiscais — parametrização tributária por operação/NCM/UF (#503) */
export default function TaxRulesPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: rules = [], isLoading } = useList<TaxRule>(RESOURCE);
  const create = useCreate<TaxRule, Record<string, unknown>>(RESOURCE);
  const update = useUpdate<TaxRule>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxRule | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(r: TaxRule) {
    setEditing(r);
    setDialogOpen(true);
  }

  function handleSubmit(values: TaxRuleFormValues) {
    const n = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
    const payload = {
      operationType: values.operationType,
      ncm: values.ncm || undefined,
      ufOrigem: values.ufOrigem || undefined,
      ufDestino: values.ufDestino || undefined,
      cfop: values.cfop,
      icmsCst: values.icmsCst,
      icmsAliquota: n(values.icmsAliquota) ?? 0,
      icmsBaseReducao: n(values.icmsBaseReducao),
      ipiCst: values.ipiCst || undefined,
      ipiAliquota: n(values.ipiAliquota),
      pisCst: values.pisCst || undefined,
      pisAliquota: n(values.pisAliquota),
      cofinsCst: values.cofinsCst || undefined,
      cofinsAliquota: n(values.cofinsAliquota),
      icmsInternaDestino: n(values.icmsInternaDestino),
      fcpAliquotaDestino: n(values.fcpAliquotaDestino),
      cClassTrib: values.cClassTrib || undefined,
      cbsCst: values.cbsCst || undefined,
      cbsAliquota: n(values.cbsAliquota),
      ibsUfCst: values.ibsUfCst || undefined,
      ibsUfAliquota: n(values.ibsUfAliquota),
      ibsMunCst: values.ibsMunCst || undefined,
      ibsMunAliquota: n(values.ibsMunAliquota),
      // vigência (#500) — date input → ISO com fuso local de Brasília
      validFrom: values.validFrom ? `${values.validFrom}T00:00:00-03:00` : undefined,
      validTo: values.validTo ? `${values.validTo}T23:59:59-03:00` : undefined,
      priority: n(values.priority),
      description: values.description || undefined,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, data: payload },
        {
          onSuccess: () => {
            toast.success('Regra fiscal atualizada');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar regra — confira se não duplica escopo+vigência'),
        },
      );
    } else {
      create.mutate(payload, {
        onSuccess: () => {
          toast.success('Regra fiscal criada');
          setDialogOpen(false);
        },
        onError: () => toast.error('Erro ao criar regra — confira se não duplica escopo+vigência'),
      });
    }
  }

  async function toggleActive(r: TaxRule) {
    const turningOff = r.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar regra fiscal?' : 'Reativar regra fiscal?',
      description: turningOff
        ? 'Sem regra cobrindo a operação, o faturamento BLOQUEIA a emissão (nunca emite com tributação genérica).'
        : 'A regra volta a ser considerada pelo motor tributário.',
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: r.id, data: { isActive: !r.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Regra desativada' : 'Regra reativada'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<TaxRule>[] = [
    {
      key: 'operationType',
      header: 'Operação',
      sortable: true,
      cell: (r) => TAX_OPERATION_LABELS[r.operationType] ?? r.operationType,
    },
    {
      key: 'escopo',
      header: 'UF / NCM',
      cell: (r) => (
        <span className="font-mono text-xs">
          {(r.ufOrigem ?? '**') + '→' + (r.ufDestino ?? '**')}
          {r.ncm ? ` · ${r.ncm}` : ''}
        </span>
      ),
    },
    { key: 'cfop', header: 'CFOP', cell: (r) => <span className="font-mono text-xs">{r.cfop}</span> },
    {
      key: 'icms',
      header: 'ICMS',
      cell: (r) => `CST ${r.icmsCst} · ${Number(r.icmsAliquota)}%`,
    },
    {
      key: 'ibscbs',
      header: 'IBS/CBS',
      align: 'center',
      cell: (r) =>
        r.cbsAliquota != null ? (
          <Badge variant="brand" title={`cClassTrib ${r.cClassTrib ?? '—'}`}>
            {`${Number(r.cbsAliquota)}% + ${Number(r.ibsUfAliquota ?? 0)}%`}
          </Badge>
        ) : (
          '—'
        ),
    },
    {
      key: 'vigencia',
      header: 'Vigência',
      cell: (r) => {
        const v = vigencia(r);
        return <Badge variant={v.variant}>{v.label}</Badge>;
      },
    },
    { key: 'priority', header: 'Prior.', align: 'center', sortable: true },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (r) => (r.isActive ? 1 : 0),
      cell: (r) => (
        <Badge variant={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Ativa' : 'Inativa'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(r);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(r);
            }}
            title={r.isActive ? 'Desativar' : 'Reativar'}
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
        title="Regras fiscais"
        description="Parametrização tributária por operação, NCM e UF — o motor escolhe a regra mais específica vigente na data de emissão."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Nova regra
          </Button>
        }
      />

      <DataTable
        data={rules}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por operação, NCM, CFOP..."
        empty={
          <EmptyState
            icon={Scale}
            title="Nenhuma regra fiscal cadastrada"
            description="Sem regra cobrindo a operação, o faturamento bloqueia a emissão."
            action={{ label: 'Nova regra', icon: <Plus size={16} />, onClick: openCreate }}
          />
        }
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar regra fiscal' : 'Nova regra fiscal'}
        description={
          editing
            ? `Editando regra ${TAX_OPERATION_LABELS[editing.operationType] ?? editing.operationType} (${editing.cfop})`
            : 'Para versionar uma NT, crie uma NOVA regra com vigência futura em vez de editar a atual.'
        }
        formId="tax-rule-form"
        loading={create.isPending || update.isPending}
        size="lg"
      >
        <TaxRuleForm
          key={editing?.id ?? 'new'}
          formId="tax-rule-form"
          defaultValues={
            editing
              ? {
                  operationType: editing.operationType,
                  ncm: editing.ncm ?? '',
                  ufOrigem: editing.ufOrigem ?? '',
                  ufDestino: editing.ufDestino ?? '',
                  cfop: editing.cfop,
                  icmsCst: editing.icmsCst,
                  icmsAliquota: String(Number(editing.icmsAliquota)),
                  icmsBaseReducao: String(Number(editing.icmsBaseReducao)),
                  ipiCst: editing.ipiCst ?? '',
                  ipiAliquota: String(Number(editing.ipiAliquota)),
                  pisCst: editing.pisCst ?? '',
                  pisAliquota: String(Number(editing.pisAliquota)),
                  cofinsCst: editing.cofinsCst ?? '',
                  cofinsAliquota: String(Number(editing.cofinsAliquota)),
                  icmsInternaDestino:
                    editing.icmsInternaDestino != null ? String(Number(editing.icmsInternaDestino)) : '',
                  fcpAliquotaDestino:
                    editing.fcpAliquotaDestino != null ? String(Number(editing.fcpAliquotaDestino)) : '',
                  cClassTrib: editing.cClassTrib ?? '',
                  cbsCst: editing.cbsCst ?? '',
                  cbsAliquota: editing.cbsAliquota != null ? String(Number(editing.cbsAliquota)) : '',
                  ibsUfCst: editing.ibsUfCst ?? '',
                  ibsUfAliquota: editing.ibsUfAliquota != null ? String(Number(editing.ibsUfAliquota)) : '',
                  ibsMunCst: editing.ibsMunCst ?? '',
                  ibsMunAliquota: editing.ibsMunAliquota != null ? String(Number(editing.ibsMunAliquota)) : '',
                  validFrom: editing.validFrom ? editing.validFrom.slice(0, 10) : '',
                  validTo: editing.validTo ? editing.validTo.slice(0, 10) : '',
                  priority: String(editing.priority ?? 0),
                  description: editing.description ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
