'use client';

import { useState } from 'react';
import { Plus, Pencil, Power, KeyRound, ShieldAlert } from 'lucide-react';
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
import { usePermission } from '@/hooks/use-permission';
import { useUserRoles } from '@/hooks/use-iam';
import Link from 'next/link';
import { LEGACY_MIRRORED_ROLE_CODES } from './roles';
import { canShowStatusToggle, canShowPasswordReset } from './permissions';
import { erroDeAcao } from '@/lib/feedback';
import { roleLabel, roleVariant } from './roles';
import { UserForm, type UserFormValues } from './user-form';
import { ResetPasswordDialog } from './reset-password-dialog';

const RESOURCE = '/users';

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  // #1003 — gate por permissão v2 (settings.users.update cobre a gestão;
  // criação também exige settings.users.create no backend, que barra sozinho).
  const { can } = usePermission();
  const canManage = can('settings.users.update');

  const toast = useToast();
  const confirm = useConfirm();
  // Toggle Ativo/Inativo espelha a permissão real do backend
  // (settings.users.update) — sem ela o botão nem aparece (fail-closed).
  const showStatusToggle = canShowStatusToggle(can);
  const showPasswordReset = canShowPasswordReset(can);

  const { data: users = [], isLoading } = useList<User>(RESOURCE, undefined, {
    enabled: canManage,
  });
  const create = useCreate<User, UserFormValues>(RESOURCE);
  const update = useUpdate<User>(RESOURCE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);

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
      // #946: na edição só o nome. E-mail é imutável, senha tem fluxo próprio
      // e o PAPEL saiu daqui — ele é derivado dos perfis RBAC v2 (a API
      // rejeita `role` no PATCH). Acesso se muda em Perfis e Permissões.
      update.mutate(
        { id: editing.id, data: { name: values.name } },
        {
          onSuccess: () => {
            toast.success('Usuário atualizado');
            setDialogOpen(false);
          },
          onError: (e) => toast.error(erroDeAcao('atualizar o usuário', e)),
        },
      );
    } else {
      create.mutate(
        values,
        {
          onSuccess: () => {
            toast.success('Usuário criado');
            setDialogOpen(false);
          },
          onError: (e) => toast.error(erroDeAcao('criar o usuário', e)),
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
        // erroDeAcao já mostra o motivo real da API (ex.: 400 de validação) —
        // o genérico escondia a causa e travou o diagnóstico (#744).
        onError: (e) => toast.error(erroDeAcao('alterar o status do usuário', e)),
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
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400"
          >
            <Pencil size={15} />
          </button>
          {showPasswordReset && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setResetTarget(u);
                setResetOpen(true);
              }}
              disabled={u.id === currentUser?.id}
              title={
                u.id === currentUser?.id
                  ? 'Para a sua própria senha, use a troca voluntária (menu do perfil)'
                  : 'Redefinir senha'
              }
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-brand-600 dark:hover:text-brand-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content-muted"
            >
              <KeyRound size={15} />
            </button>
          )}
          {showStatusToggle && (
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
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content-muted"
            >
              <Power size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Usuários" description="Gestão de acessos e papéis." />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <div>
            <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
            <p className="text-xs text-content-muted">
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
        {editing && <ResumoDeAcesso user={editing} />}
      </FormDialog>

      <ResetPasswordDialog user={resetTarget} open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}

/**
 * #946: o acesso do usuário é definido pelos PERFIS RBAC v2 — o papel legado
 * virou espelho. Este bloco aparece na edição para (a) mostrar os perfis que
 * de fato valem, (b) levar direto à tela onde se muda acesso e (c) avisar
 * quando o papel legado ficou congelado por não representar a combinação.
 */
function ResumoDeAcesso({ user }: { user: User }) {
  const { data: perfis = [], isLoading } = useUserRoles(user.id);

  // Congelado = o papel legado não representa integralmente o acesso: mais de
  // um perfil, ou um perfil sem equivalente no vocabulário legado.
  const oficiaisMapeados = perfis.filter((p) => LEGACY_MIRRORED_ROLE_CODES.includes(p.role.code));
  const ambiguo = perfis.length > 1 || (perfis.length === 1 && oficiaisMapeados.length === 0);

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Acesso (perfis)</p>
          <p className="text-xs text-muted-foreground">
            O acesso é definido pelos perfis. O papel legado é apenas compatibilidade.
          </p>
        </div>
        <Link
          href={`/app/settings/roles?tab=atribuicoes&userId=${user.id}`}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          Gerenciar perfis
        </Link>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando perfis…</p>
      ) : perfis.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum perfil atribuído. Este usuário não tem acesso pelo RBAC v2.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {perfis.map((p) => (
            <Badge key={p.id} variant="neutral">
              {p.role.name}
            </Badge>
          ))}
        </div>
      )}

      {ambiguo && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          O acesso deste usuário é definido por múltiplos perfis. O papel legado é mantido
          apenas para compatibilidade.
        </p>
      )}
    </div>
  );
}
