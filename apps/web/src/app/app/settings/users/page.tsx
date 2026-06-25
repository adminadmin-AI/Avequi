'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useList, useCreate, useUpdate } from '@/hooks/use-resource';
import type { User } from '@/types/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { roleLabel, roleVariant } from './roles';
import { UserForm, type UserFormValues } from './user-form';

const RESOURCE = '/users';
const ALLOWED_ROLES = ['SUPER_ADMIN', 'DIRECTOR'];

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const companyId = currentUser?.companyId ?? '';
  const canManage = !!currentUser && ALLOWED_ROLES.includes(currentUser.role);

  const toast = useToast();
  const confirm = useConfirm();

  const { data: users = [], isLoading } = useList<User>(RESOURCE, undefined, {
    enabled: canManage,
  });
  const create = useCreate<User, UserFormValues & { companyId: string }>(RESOURCE);
  const update = useUpdate<User>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(u: User) {
    setEditing(u);
    setDialogOpen(true);
  }

  function handleSubmit(values: UserFormValues) {
    if (editing) {
      // Na edição só enviamos nome e papel (e-mail é imutável; senha não muda aqui).
      update.mutate(
        { id: editing.id, data: { name: values.name, role: values.role } },
        {
          onSuccess: () => {
            toast.success('Usuário atualizado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao atualizar usuário'),
        },
      );
    } else {
      create.mutate(
        { ...values, companyId },
        {
          onSuccess: () => {
            toast.success('Usuário criado');
            setDialogOpen(false);
          },
          onError: () => toast.error('Erro ao criar usuário'),
        },
      );
    }
  }

  async function toggleActive(u: User) {
    const turningOff = u.isActive;
    const ok = await confirm({
      title: turningOff ? 'Inativar usuário?' : 'Reativar usuário?',
      description: turningOff
        ? `"${u.name}" perderá o acesso ao sistema.`
        : `"${u.name}" voltará a ter acesso ao sistema.`,
      confirmLabel: turningOff ? 'Inativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    update.mutate(
      { id: u.id, data: { isActive: !u.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Usuário inativado' : 'Usuário reativado'),
        onError: () => toast.error('Erro ao alterar status'),
      },
    );
  }

  const columns: Column<User>[] = [
    { key: 'name', header: 'Nome', sortable: true },
    { key: 'email', header: 'E-mail', cell: (u) => u.email || '—' },
    {
      key: 'role',
      header: 'Papel',
      sortable: true,
      accessor: (u) => u.role,
      cell: (u) => <Badge variant={roleVariant(u.role)}>{roleLabel(u.role)}</Badge>,
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (u) => (u.isActive ? 1 : 0),
      cell: (u) => (
        <Badge variant={u.isActive ? 'success' : 'neutral'}>
          {u.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openEdit(u);
            }}
            title="Editar"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleActive(u);
            }}
            disabled={u.id === currentUser?.id}
            title={
              u.id === currentUser?.id
                ? 'Você não pode inativar a si mesmo'
                : u.isActive
                  ? 'Inativar'
                  : 'Reativar'
            }
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Power size={15} />
          </button>
        </div>
      ),
    },
  ];

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Usuários" description="Gestão de acessos e papéis." />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white py-16 text-center">
          <ShieldAlert className="text-slate-300" size={40} />
          <div>
            <p className="text-sm font-medium text-slate-700">Acesso restrito</p>
            <p className="text-xs text-slate-400">
              Apenas Super Admin e Diretor podem gerenciar usuários.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Usuários"
        description="Gestão de acessos e papéis."
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} />
            Novo usuário
          </Button>
        }
      />

      <DataTable
        data={users}
        columns={columns}
        loading={isLoading}
        onRowClick={openEdit}
        searchPlaceholder="Buscar por nome ou e-mail..."
        emptyMessage="Nenhum usuário cadastrado."
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? 'Editar usuário' : 'Novo usuário'}
        description={
          editing ? `Editando "${editing.name}"` : 'Preencha os dados do novo usuário.'
        }
        formId="user-form"
        loading={create.isPending || update.isPending}
      >
        <UserForm
          key={editing?.id ?? 'new'}
          formId="user-form"
          isEdit={!!editing}
          defaultValues={
            editing
              ? { name: editing.name, email: editing.email, role: editing.role }
              : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
