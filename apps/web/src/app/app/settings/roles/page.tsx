'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Copy, KeyRound, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import {
  apiErrorMessage,
  useCreateIamRole,
  useDeleteIamRole,
  useIamRoles,
  useUpdateIamRole,
} from '@/hooks/use-iam';
import type { IamRole } from '@/types/api';
import { Can } from '@/components/can';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { FormDialog } from '@/components/ui/form-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { AssignmentsTab } from './assignments-tab';
import { RoleForm, type RoleFormValues } from './role-form';

/**
 * Tela de gestão de perfis e permissões — issue #352 (IAM F7.2).
 *
 * Aba "Perfis": lista perfis system (somente leitura, badge "Sistema") e
 * personalizados da empresa (criar/renomear/duplicar/excluir; a árvore de
 * permissões fica na página de detalhe /app/settings/roles/[id]).
 * Aba "Atribuições": vincula usuários a perfis e gerencia exceções.
 *
 * Gating por PERMISSÃO (RBAC v2, #351 — dogfooding do usePermission/<Can>):
 * iam.roles.view abre a tela; iam.roles.manage libera criar/editar/excluir.
 * O backend revalida tudo (@RequirePermission) — aqui é só UX.
 */
export default function RolesPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { can, isLoading: loadingPerms } = usePermission();
  const canView = can('iam.roles.view');
  const canManage = can('iam.roles.manage');

  const { data: roles = [], isLoading } = useIamRoles(canView);
  const createRole = useCreateIamRole();
  const updateRole = useUpdateIamRole();
  const deleteRole = useDeleteIamRole();

  const searchParams = useSearchParams();
  const tabInicial = searchParams.get('tab') === 'atribuicoes' ? 'atribuicoes' : 'perfis';
  const userIdInicial = searchParams.get('userId') ?? undefined;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IamRole | null>(null);
  const [copyFrom, setCopyFrom] = useState<IamRole | null>(null);

  function openCreate(source?: IamRole) {
    setEditing(null);
    setCopyFrom(source ?? null);
    setDialogOpen(true);
  }

  function openEdit(role: IamRole) {
    if (role.isSystem) {
      router.push(`/app/settings/roles/${role.id}`);
      return;
    }
    setEditing(role);
    setCopyFrom(null);
    setDialogOpen(true);
  }

  function handleSubmit(values: RoleFormValues) {
    if (editing) {
      updateRole.mutate(
        {
          id: editing.id,
          data: { name: values.name, description: values.description },
        },
        {
          onSuccess: () => {
            toast.success('Perfil atualizado');
            setDialogOpen(false);
          },
          onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao atualizar perfil')),
        },
      );
    } else {
      createRole.mutate(
        {
          name: values.name,
          description: values.description || undefined,
          copyFromRoleId: values.copyFromRoleId || undefined,
        },
        {
          onSuccess: (created) => {
            toast.success('Perfil criado — agora defina as permissões');
            setDialogOpen(false);
            router.push(`/app/settings/roles/${created.id}`);
          },
          onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao criar perfil')),
        },
      );
    }
  }

  async function handleDelete(role: IamRole) {
    const ok = await confirm({
      title: 'Excluir perfil?',
      description: `O perfil "${role.name}" será excluído. Só é possível excluir perfis sem usuários vinculados.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    deleteRole.mutate(role.id, {
      onSuccess: () => toast.success('Perfil excluído'),
      onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao excluir perfil')),
    });
  }

  const columns: Column<IamRole>[] = [
    {
      key: 'name',
      header: 'Perfil',
      sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{r.name}</span>
            {r.isSystem ? (
              <Badge variant="info">Sistema</Badge>
            ) : (
              <Badge variant="brand">Personalizado</Badge>
            )}
            {!r.isActive && <Badge variant="neutral">Inativo</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-content-muted">{r.code}</div>
        </div>
      ),
      accessor: (r) => r.name,
    },
    {
      key: 'parent',
      header: 'Herda de',
      cell: (r) => (r.parent ? r.parent.name : '—'),
      accessor: (r) => r.parent?.name ?? '',
    },
    {
      key: 'permissions',
      header: 'Permissões',
      align: 'center',
      sortable: true,
      accessor: (r) => r._count?.rolePermissions ?? 0,
      cell: (r) => r._count?.rolePermissions ?? 0,
    },
    {
      key: 'users',
      header: 'Usuários',
      align: 'center',
      sortable: true,
      accessor: (r) => r._count?.userAssignments ?? 0,
      cell: (r) => r._count?.userAssignments ?? 0,
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
              router.push(`/app/settings/roles/${r.id}`);
            }}
            title={r.isSystem ? 'Ver permissões (somente leitura)' : 'Editar permissões'}
            className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
          >
            <KeyRound size={15} />
          </button>
          {canManage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openCreate(r);
              }}
              title="Duplicar como perfil personalizado"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
            >
              <Copy size={15} />
            </button>
          )}
          {!r.isSystem && canManage && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(r);
                }}
                title="Renomear / editar"
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(r);
                }}
                title="Excluir"
                className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  // Fail-closed com UX: enquanto as permissões carregam, esqueleto (nunca
  // "Acesso restrito" piscando para quem TEM acesso).
  if (loadingPerms) {
    return (
      <div>
        <PageHeader
          title="Perfis e Permissões"
          description="Gestão de perfis de acesso (RBAC) e permissões granulares."
        />
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div>
        <PageHeader
          title="Perfis e Permissões"
          description="Gestão de perfis de acesso (RBAC) e permissões granulares."
        />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <div>
            <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
            <p className="text-xs text-content-muted">
              Você não tem a permissão necessária (iam.roles.view) para ver perfis e
              permissões.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Perfis e Permissões"
        description="Perfis de acesso (RBAC v2), permissões granulares e atribuições por usuário."
        actions={
          <Can permission="iam.roles.manage">
            <Button onClick={() => openCreate()}>
              <Plus size={16} />
              Novo perfil
            </Button>
          </Can>
        }
      />

      {/* #946: deep-link vindo da tela de usuários — ?tab=atribuicoes&userId=… */}
      <Tabs defaultValue={tabInicial}>
        <TabsList className="mb-4">
          <TabsTrigger value="perfis">Perfis</TabsTrigger>
          <TabsTrigger value="atribuicoes">Atribuições</TabsTrigger>
        </TabsList>

        <TabsContent value="perfis">
          <DataTable
            data={roles}
            columns={columns}
            loading={isLoading}
            onRowClick={(r) => router.push(`/app/settings/roles/${r.id}`)}
            searchPlaceholder="Buscar perfil..."
            emptyMessage="Nenhum perfil encontrado."
          />
        </TabsContent>

        <TabsContent value="atribuicoes">
          <AssignmentsTab roles={roles} userIdInicial={userIdInicial} />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={
          editing
            ? 'Editar perfil'
            : copyFrom
              ? `Duplicar "${copyFrom.name}"`
              : 'Novo perfil'
        }
        description={
          editing
            ? `Editando "${editing.name}" (as permissões são editadas na página do perfil).`
            : 'Perfis personalizados valem apenas para a sua empresa.'
        }
        formId="role-form"
        loading={createRole.isPending || updateRole.isPending}
      >
        <RoleForm
          key={editing?.id ?? copyFrom?.id ?? 'new'}
          formId="role-form"
          isEdit={!!editing}
          roles={roles}
          defaultValues={
            editing
              ? { name: editing.name, description: editing.description ?? '' }
              : copyFrom
                ? { name: `${copyFrom.name} (cópia)`, copyFromRoleId: copyFrom.id }
                : undefined
          }
          onSubmit={handleSubmit}
        />
      </FormDialog>
    </div>
  );
}
