'use client';

import { useState } from 'react';
import { Pencil, Plus, Power, ShieldAlert, Trash2 } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import { useList } from '@/hooks/use-resource';
import { erroDeAcao } from '@/lib/feedback';
import {
  useCreateIamBranch,
  useCreateIamDepartment,
  useCreateIamTeam,
  useDeleteIamBranch,
  useDeleteIamDepartment,
  useDeleteIamTeam,
  useIamBranches,
  useIamDepartments,
  useIamTeams,
  useUpdateIamBranch,
  useUpdateIamDepartment,
  useUpdateIamTeam,
} from '@/hooks/use-org-structure';
import type { IamBranch, IamDepartment, IamTeam, User } from '@/types/api';
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
import {
  BranchForm,
  DepartmentForm,
  TeamForm,
  type BranchFormValues,
  type DepartmentFormValues,
  type TeamFormValues,
} from './org-forms';
import { LinksTab } from './links-tab';

/**
 * Tela de estrutura organizacional — issue #347 (IAM F5.2, FASE 1).
 *
 * Abas: Filiais / Departamentos / Equipes (CRUD com DataTable + FormDialog)
 * e Vínculos (usuário ↔ departamentos/equipes, padrão da aba Atribuições da
 * tela de perfis #352).
 *
 * Gating por PERMISSÃO (dogfooding do usePermission/<Can> do #351/#472):
 * iam.org.view abre a tela; iam.org.manage libera o CRUD da estrutura;
 * iam.org.assign libera os vínculos de usuários. O backend revalida tudo
 * (@RequirePermission) — aqui é só UX.
 *
 * FASE 2 (pendente na #347): enforcement do escopo por filial/departamento
 * no sistema todo (filtro automático de dados).
 */
export default function OrganizationPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { can, isLoading: loadingPerms } = usePermission();
  const canView = can('iam.org.view');
  const canManage = can('iam.org.manage');
  const canAssign = can('iam.org.assign');

  const { data: branches = [], isLoading: loadingBranches } = useIamBranches(canView);
  const { data: departments = [], isLoading: loadingDepartments } =
    useIamDepartments(canView);
  const { data: teams = [], isLoading: loadingTeams } = useIamTeams(canView);
  const { data: users = [] } = useList<User>('/users');

  const createBranch = useCreateIamBranch();
  const updateBranch = useUpdateIamBranch();
  const deleteBranch = useDeleteIamBranch();
  const createDepartment = useCreateIamDepartment();
  const updateDepartment = useUpdateIamDepartment();
  const deleteDepartment = useDeleteIamDepartment();
  const createTeam = useCreateIamTeam();
  const updateTeam = useUpdateIamTeam();
  const deleteTeam = useDeleteIamTeam();

  // ─── Diálogos ───────────────────────────────────────────────────────────────

  const [branchDialog, setBranchDialog] = useState(false);
  const [editingBranch, setEditingBranch] = useState<IamBranch | null>(null);
  const [departmentDialog, setDepartmentDialog] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<IamDepartment | null>(null);
  const [teamDialog, setTeamDialog] = useState(false);
  const [editingTeam, setEditingTeam] = useState<IamTeam | null>(null);

  // ─── Filiais ────────────────────────────────────────────────────────────────

  function submitBranch(values: BranchFormValues) {
    if (editingBranch) {
      updateBranch.mutate(
        {
          id: editingBranch.id,
          data: { name: values.name, cnpj: values.cnpj || undefined },
        },
        {
          onSuccess: () => {
            toast.success('Filial atualizada');
            setBranchDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('atualizar a filial', e)),
        },
      );
    } else {
      createBranch.mutate(
        {
          name: values.name,
          code: values.code.trim().toUpperCase(),
          cnpj: values.cnpj || undefined,
        },
        {
          onSuccess: () => {
            toast.success('Filial criada');
            setBranchDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('criar a filial', e)),
        },
      );
    }
  }

  async function toggleBranch(b: IamBranch) {
    const turningOff = b.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar filial?' : 'Reativar filial?',
      description: turningOff
        ? `"${b.name}" ficará indisponível para novos escopos de atribuição.`
        : `"${b.name}" voltará a ficar disponível.`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    updateBranch.mutate(
      { id: b.id, data: { isActive: !b.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Filial desativada' : 'Filial reativada'),
        onError: (e) => toast.error(erroDeAcao('alterar o status da filial', e)),
      },
    );
  }

  async function removeBranch(b: IamBranch) {
    const ok = await confirm({
      title: 'Excluir filial?',
      description: `"${b.name}" será excluída. Só é possível excluir filiais sem atribuições de perfil escopadas nela.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    deleteBranch.mutate(b.id, {
      onSuccess: () => toast.success('Filial excluída'),
      onError: (e) => toast.error(erroDeAcao('excluir a filial', e)),
    });
  }

  const branchColumns: Column<IamBranch>[] = [
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      cell: (b) => <span className="font-mono text-xs font-medium">{b.code}</span>,
    },
    { key: 'name', header: 'Nome', sortable: true },
    { key: 'cnpj', header: 'CNPJ', cell: (b) => b.cnpj || '—' },
    {
      key: 'assignments',
      header: 'Atribuições escopadas',
      align: 'center',
      sortable: true,
      accessor: (b) => b._count?.userRoleAssignments ?? 0,
      cell: (b) => b._count?.userRoleAssignments ?? 0,
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (b) => (b.isActive ? 1 : 0),
      cell: (b) => (
        <Badge variant={b.isActive ? 'success' : 'neutral'}>
          {b.isActive ? 'Ativa' : 'Inativa'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (b) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingBranch(b);
                setBranchDialog(true);
              }}
              title="Editar"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleBranch(b);
              }}
              title={b.isActive ? 'Desativar' : 'Reativar'}
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-warning dark:hover:bg-neutral-800"
            >
              <Power size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeBranch(b);
              }}
              title="Excluir"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null,
    },
  ];

  // ─── Departamentos ──────────────────────────────────────────────────────────

  function submitDepartment(values: DepartmentFormValues) {
    if (editingDepartment) {
      updateDepartment.mutate(
        {
          id: editingDepartment.id,
          data: {
            name: values.name,
            parentId: values.parentId || null,
            managerId: values.managerId || null,
          },
        },
        {
          onSuccess: () => {
            toast.success('Departamento atualizado');
            setDepartmentDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('atualizar o departamento', e)),
        },
      );
    } else {
      createDepartment.mutate(
        {
          name: values.name,
          code: values.code.trim().toUpperCase(),
          parentId: values.parentId || undefined,
          managerId: values.managerId || undefined,
        },
        {
          onSuccess: () => {
            toast.success('Departamento criado');
            setDepartmentDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('criar o departamento', e)),
        },
      );
    }
  }

  async function toggleDepartment(d: IamDepartment) {
    const turningOff = d.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar departamento?' : 'Reativar departamento?',
      description: `"${d.name}" ${turningOff ? 'ficará indisponível para novos vínculos.' : 'voltará a ficar disponível.'}`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    updateDepartment.mutate(
      { id: d.id, data: { isActive: !d.isActive } },
      {
        onSuccess: () =>
          toast.success(turningOff ? 'Departamento desativado' : 'Departamento reativado'),
        onError: (e) => toast.error(erroDeAcao('alterar o status do departamento', e)),
      },
    );
  }

  async function removeDepartment(d: IamDepartment) {
    const ok = await confirm({
      title: 'Excluir departamento?',
      description: `"${d.name}" será excluído. Só é possível excluir departamentos sem subdepartamentos, equipes ou usuários vinculados.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    deleteDepartment.mutate(d.id, {
      onSuccess: () => toast.success('Departamento excluído'),
      onError: (e) => toast.error(erroDeAcao('excluir o departamento', e)),
    });
  }

  const departmentColumns: Column<IamDepartment>[] = [
    {
      key: 'code',
      header: 'Código',
      sortable: true,
      cell: (d) => <span className="font-mono text-xs font-medium">{d.code}</span>,
    },
    { key: 'name', header: 'Nome', sortable: true },
    {
      key: 'parent',
      header: 'Pertence a',
      cell: (d) => (d.parent ? d.parent.name : '—'),
      accessor: (d) => d.parent?.name ?? '',
    },
    {
      key: 'manager',
      header: 'Gerente',
      cell: (d) => (d.manager ? d.manager.name : '—'),
      accessor: (d) => d.manager?.name ?? '',
    },
    {
      key: 'teams',
      header: 'Equipes',
      align: 'center',
      sortable: true,
      accessor: (d) => d._count?.teams ?? 0,
      cell: (d) => d._count?.teams ?? 0,
    },
    {
      key: 'users',
      header: 'Usuários',
      align: 'center',
      sortable: true,
      accessor: (d) => d._count?.users ?? 0,
      cell: (d) => d._count?.users ?? 0,
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (d) => (d.isActive ? 1 : 0),
      cell: (d) => (
        <Badge variant={d.isActive ? 'success' : 'neutral'}>
          {d.isActive ? 'Ativo' : 'Inativo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (d) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingDepartment(d);
                setDepartmentDialog(true);
              }}
              title="Editar"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleDepartment(d);
              }}
              title={d.isActive ? 'Desativar' : 'Reativar'}
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-warning dark:hover:bg-neutral-800"
            >
              <Power size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeDepartment(d);
              }}
              title="Excluir"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null,
    },
  ];

  // ─── Equipes ────────────────────────────────────────────────────────────────

  function submitTeam(values: TeamFormValues) {
    if (editingTeam) {
      updateTeam.mutate(
        {
          id: editingTeam.id,
          data: {
            name: values.name,
            departmentId: values.departmentId,
            leaderId: values.leaderId || null,
          },
        },
        {
          onSuccess: () => {
            toast.success('Equipe atualizada');
            setTeamDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('atualizar a equipe', e)),
        },
      );
    } else {
      createTeam.mutate(
        {
          name: values.name,
          departmentId: values.departmentId,
          leaderId: values.leaderId || undefined,
        },
        {
          onSuccess: () => {
            toast.success('Equipe criada');
            setTeamDialog(false);
          },
          onError: (e) => toast.error(erroDeAcao('criar a equipe', e)),
        },
      );
    }
  }

  async function toggleTeam(t: IamTeam) {
    const turningOff = t.isActive;
    const ok = await confirm({
      title: turningOff ? 'Desativar equipe?' : 'Reativar equipe?',
      description: `"${t.name}" ${turningOff ? 'ficará indisponível para novos vínculos.' : 'voltará a ficar disponível.'}`,
      confirmLabel: turningOff ? 'Desativar' : 'Reativar',
      variant: turningOff ? 'danger' : 'primary',
    });
    if (!ok) return;
    updateTeam.mutate(
      { id: t.id, data: { isActive: !t.isActive } },
      {
        onSuccess: () => toast.success(turningOff ? 'Equipe desativada' : 'Equipe reativada'),
        onError: (e) => toast.error(erroDeAcao('alterar o status da equipe', e)),
      },
    );
  }

  async function removeTeam(t: IamTeam) {
    const ok = await confirm({
      title: 'Excluir equipe?',
      description: `"${t.name}" será excluída. Só é possível excluir equipes sem membros.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    deleteTeam.mutate(t.id, {
      onSuccess: () => toast.success('Equipe excluída'),
      onError: (e) => toast.error(erroDeAcao('excluir a equipe', e)),
    });
  }

  const teamColumns: Column<IamTeam>[] = [
    { key: 'name', header: 'Nome', sortable: true },
    {
      key: 'department',
      header: 'Departamento',
      cell: (t) => (t.department ? `${t.department.name} (${t.department.code})` : '—'),
      accessor: (t) => t.department?.name ?? '',
    },
    {
      key: 'leader',
      header: 'Líder',
      cell: (t) => (t.leader ? t.leader.name : '—'),
      accessor: (t) => t.leader?.name ?? '',
    },
    {
      key: 'members',
      header: 'Membros',
      align: 'center',
      sortable: true,
      accessor: (t) => t._count?.members ?? 0,
      cell: (t) => t._count?.members ?? 0,
    },
    {
      key: 'isActive',
      header: 'Status',
      align: 'center',
      sortable: true,
      accessor: (t) => (t.isActive ? 1 : 0),
      cell: (t) => (
        <Badge variant={t.isActive ? 'success' : 'neutral'}>
          {t.isActive ? 'Ativa' : 'Inativa'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (t) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingTeam(t);
                setTeamDialog(true);
              }}
              title="Editar"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-brand-600 dark:hover:bg-neutral-800 dark:hover:text-brand-400"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleTeam(t);
              }}
              title={t.isActive ? 'Desativar' : 'Reativar'}
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-warning dark:hover:bg-neutral-800"
            >
              <Power size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTeam(t);
              }}
              title="Excluir"
              className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null,
    },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────────

  const header = (
    <PageHeader
      title="Organização"
      description="Estrutura organizacional da empresa: filiais, departamentos, equipes e vínculos de usuários."
    />
  );

  // Fail-closed com UX (padrão da tela de perfis #352)
  if (loadingPerms) {
    return (
      <div>
        {header}
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <Can
      permission="iam.org.view"
      fallback={
        <div>
          {header}
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
            <ShieldAlert className="text-content-muted" size={40} />
            <div>
              <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
              <p className="text-xs text-content-muted">
                Você não tem a permissão necessária (iam.org.view) para ver a estrutura
                organizacional.
              </p>
            </div>
          </div>
        </div>
      }
    >
      <div>
        {header}

        <Tabs defaultValue="filiais">
          <TabsList className="mb-4">
            <TabsTrigger value="filiais">Filiais</TabsTrigger>
            <TabsTrigger value="departamentos">Departamentos</TabsTrigger>
            <TabsTrigger value="equipes">Equipes</TabsTrigger>
            <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
          </TabsList>

          <TabsContent value="filiais">
            <div className="mb-3 flex justify-end">
              <Can permission="iam.org.manage">
                <Button
                  onClick={() => {
                    setEditingBranch(null);
                    setBranchDialog(true);
                  }}
                >
                  <Plus size={16} />
                  Nova filial
                </Button>
              </Can>
            </div>
            <DataTable
              data={branches}
              columns={branchColumns}
              loading={loadingBranches}
              searchPlaceholder="Buscar por código ou nome..."
              emptyMessage="Nenhuma filial cadastrada."
            />
          </TabsContent>

          <TabsContent value="departamentos">
            <div className="mb-3 flex justify-end">
              <Can permission="iam.org.manage">
                <Button
                  onClick={() => {
                    setEditingDepartment(null);
                    setDepartmentDialog(true);
                  }}
                >
                  <Plus size={16} />
                  Novo departamento
                </Button>
              </Can>
            </div>
            <DataTable
              data={departments}
              columns={departmentColumns}
              loading={loadingDepartments}
              searchPlaceholder="Buscar por código ou nome..."
              emptyMessage="Nenhum departamento cadastrado."
            />
          </TabsContent>

          <TabsContent value="equipes">
            <div className="mb-3 flex justify-end">
              <Can permission="iam.org.manage">
                <Button
                  onClick={() => {
                    setEditingTeam(null);
                    setTeamDialog(true);
                  }}
                >
                  <Plus size={16} />
                  Nova equipe
                </Button>
              </Can>
            </div>
            <DataTable
              data={teams}
              columns={teamColumns}
              loading={loadingTeams}
              searchPlaceholder="Buscar por nome..."
              emptyMessage="Nenhuma equipe cadastrada."
            />
          </TabsContent>

          <TabsContent value="vinculos">
            <LinksTab canAssign={canAssign} />
          </TabsContent>
        </Tabs>

        {/* ── Diálogos ── */}
        <FormDialog
          open={branchDialog}
          onOpenChange={setBranchDialog}
          title={editingBranch ? 'Editar filial' : 'Nova filial'}
          description={
            editingBranch
              ? `Editando "${editingBranch.name}"`
              : 'A filial pertence à sua empresa (escopo automático).'
          }
          formId="branch-form"
          loading={createBranch.isPending || updateBranch.isPending}
        >
          <BranchForm
            key={editingBranch?.id ?? 'new'}
            formId="branch-form"
            isEdit={!!editingBranch}
            defaultValues={
              editingBranch
                ? {
                    code: editingBranch.code,
                    name: editingBranch.name,
                    cnpj: editingBranch.cnpj ?? '',
                  }
                : undefined
            }
            onSubmit={submitBranch}
          />
        </FormDialog>

        <FormDialog
          open={departmentDialog}
          onOpenChange={setDepartmentDialog}
          title={editingDepartment ? 'Editar departamento' : 'Novo departamento'}
          description={
            editingDepartment
              ? `Editando "${editingDepartment.name}"`
              : 'Departamentos podem formar hierarquia (pai opcional).'
          }
          formId="department-form"
          loading={createDepartment.isPending || updateDepartment.isPending}
        >
          <DepartmentForm
            key={editingDepartment?.id ?? 'new'}
            formId="department-form"
            isEdit={!!editingDepartment}
            editingId={editingDepartment?.id}
            departments={departments}
            users={users}
            defaultValues={
              editingDepartment
                ? {
                    code: editingDepartment.code,
                    name: editingDepartment.name,
                    parentId: editingDepartment.parentId ?? '',
                    managerId: editingDepartment.managerId ?? '',
                  }
                : undefined
            }
            onSubmit={submitDepartment}
          />
        </FormDialog>

        <FormDialog
          open={teamDialog}
          onOpenChange={setTeamDialog}
          title={editingTeam ? 'Editar equipe' : 'Nova equipe'}
          description={
            editingTeam
              ? `Editando "${editingTeam.name}"`
              : 'Toda equipe pertence a um departamento.'
          }
          formId="team-form"
          loading={createTeam.isPending || updateTeam.isPending}
        >
          <TeamForm
            key={editingTeam?.id ?? 'new'}
            formId="team-form"
            departments={departments}
            users={users}
            defaultValues={
              editingTeam
                ? {
                    name: editingTeam.name,
                    departmentId: editingTeam.departmentId,
                    leaderId: editingTeam.leaderId ?? '',
                  }
                : undefined
            }
            onSubmit={submitTeam}
          />
        </FormDialog>
      </div>
    </Can>
  );
}
