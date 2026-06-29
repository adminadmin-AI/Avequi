'use client';

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Landmark, Settings2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate, useDelete } from '@/hooks/use-resource';
import { apiClient } from '@/lib/api-client';
import type { BankAccount } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatBRL } from '@/lib/format';
import { BankAccountForm, type BankAccountFormValues } from './bank-account-form';
import { BankConfigForm, type BankConfigFormValues } from './bank-config-form';

const RESOURCE = '/finance/bank-accounts';

export default function BankAccountsPage() {
  const companyId = useAuthStore((s) => s.user?.companyId ?? '');
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data: accounts = [], isLoading } = useList<BankAccount>(RESOURCE);
  const create = useCreate<BankAccount, BankAccountFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<BankAccount>(RESOURCE);
  const remove = useDelete(RESOURCE);

  const configure = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.patch(`/banking/accounts/${id}/configure`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [RESOURCE] }),
  });

  const [configTarget, setConfigTarget] = useState<BankAccount | null>(null);

  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0),
    [accounts],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);

  function handleSubmit(values: BankAccountFormValues) {
    const payload = {
      ...values,
      bank: values.bank || undefined,
      agency: values.agency || undefined,
      account: values.account || undefined,
    };
    const opts = {
      onSuccess: () => {
        toast.success(editing ? 'Conta atualizada' : 'Conta criada');
        setDialogOpen(false);
      },
      onError: () => toast.error('Erro ao salvar conta'),
    };
    if (editing) update.mutate({ id: editing.id, data: payload }, opts);
    else create.mutate({ ...payload, companyId }, opts);
  }

  function handleConfigSubmit(values: BankConfigFormValues) {
    if (!configTarget) return;
    const data: Record<string, unknown> = {
      provider: values.provider || undefined,
      pixKey: values.pixKey || undefined,
    };
    if (
      values.minCashBalance !== undefined &&
      values.minCashBalance !== '' &&
      !Number.isNaN(Number(values.minCashBalance))
    ) {
      data.minCashBalance = Number(values.minCashBalance);
    }
    configure.mutate(
      { id: configTarget.id, data },
      {
        onSuccess: () => {
          toast.success('Configuração de cobrança salva');
          setConfigTarget(null);
        },
        onError: (err: any) =>
          toast.error(err?.response?.data?.message ?? 'Erro ao salvar configuração'),
      },
    );
  }

  async function deactivate(a: BankAccount) {
    const ok = await confirm({
      title: 'Desativar conta bancária?',
      description: `"${a.name}" deixará de aparecer nas operações financeiras.`,
      confirmLabel: 'Desativar',
      variant: 'danger',
    });
    if (!ok) return;
    remove.mutate(a.id, {
      onSuccess: () => toast.success('Conta desativada'),
      onError: () => toast.error('Erro ao desativar'),
    });
  }

  const columns: Column<BankAccount>[] = [
    { key: 'name', header: 'Nome', sortable: true },
    { key: 'bank', header: 'Banco', cell: (a) => a.bank || '—' },
    {
      key: 'agencyAccount',
      header: 'Agência / Conta',
      cell: (a) =>
        a.agency || a.account ? (
          <span className="font-mono text-xs">
            {a.agency ?? '—'} / {a.account ?? '—'}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'balance',
      header: 'Saldo atual',
      align: 'right',
      sortable: true,
      accessor: (a) => Number(a.balance ?? 0),
      cell: (a) => <span className="font-medium tabular-nums">{formatBRL(Number(a.balance ?? 0))}</span>,
    },
    {
      key: 'active',
      header: 'Status',
      align: 'center',
      cell: (a) => <Badge variant={a.active ? 'success' : 'neutral'}>{a.active ? 'Ativa' : 'Inativa'}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfigTarget(a);
            }}
            title="Configurar cobrança (provider, PIX, saldo mínimo)"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
          >
            <Settings2 size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(a);
              setDialogOpen(true);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deactivate(a);
            }}
            title="Desativar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Contas Bancárias"
        description="Contas da empresa e saldos."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={16} />
            Nova conta
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Landmark size={20} />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Saldo total</p>
              <p className="text-2xl font-semibold tracking-tight text-slate-900">
                {formatBRL(totalBalance)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={accounts}
        columns={columns}
        loading={isLoading}
        searchPlaceholder="Buscar por nome ou banco..."
        emptyMessage="Nenhuma conta bancária cadastrada."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar conta' : 'Nova conta bancária'}
        formId="bank-account-form"
        loading={create.isPending || update.isPending}
      >
        <BankAccountForm
          key={editing?.id ?? 'new'}
          formId="bank-account-form"
          defaultValues={
            editing
              ? {
                  name: editing.name,
                  bank: editing.bank ?? '',
                  agency: editing.agency ?? '',
                  account: editing.account ?? '',
                }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>

      <FormDialog
        open={!!configTarget}
        onOpenChange={(open) => !open && setConfigTarget(null)}
        title="Configurar cobrança"
        description={configTarget ? `Conta "${configTarget.name}".` : undefined}
        formId="bank-config-form"
        loading={configure.isPending}
      >
        {configTarget && (
          <BankConfigForm
            key={configTarget.id}
            formId="bank-config-form"
            defaultValues={{
              provider: configTarget.provider ?? '',
              pixKey: configTarget.pixKey ?? '',
              minCashBalance: configTarget.minCashBalance
                ? Number(configTarget.minCashBalance)
                : '',
            }}
            onSubmit={handleConfigSubmit}
          />
        )}
      </FormDialog>
    </div>
  );
}
