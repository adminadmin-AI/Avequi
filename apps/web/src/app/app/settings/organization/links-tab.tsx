'use client';

import { useState } from 'react';
import { Plus, Star, Trash2 } from 'lucide-react';
import { useList } from '@/hooks/use-resource';
import { apiErrorMessage } from '@/hooks/use-iam';
import {
  useAddIamUserDepartment,
  useAddIamUserTeam,
  useIamDepartments,
  useIamTeams,
  useIamUserDepartments,
  useIamUserTeams,
  useRemoveIamUserDepartment,
  useRemoveIamUserTeam,
} from '@/hooks/use-org-structure';
import type { User } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/toast';

/**
 * Aba "Vínculos" da tela de organização (#347 F5.2, fase 1): vincula usuários
 * a departamentos e equipes. Mesmo padrão da aba "Atribuições" da tela de
 * perfis (#352). O vínculo por FILIAL continua onde sempre esteve: no escopo
 * da atribuição de perfil (Perfis e Permissões → Atribuições, branchId).
 */
export function LinksTab({ canAssign }: { canAssign: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: users = [], isLoading: loadingUsers } = useList<User>('/users');
  const [selectedUserId, setSelectedUserId] = useState('');
  const selectedUser = users.find((u) => u.id === selectedUserId);

  const { data: departments = [] } = useIamDepartments();
  const { data: teams = [] } = useIamTeams();
  const { data: userDepartments = [], isLoading: loadingUserDeps } =
    useIamUserDepartments(selectedUserId || undefined);
  const { data: userTeams = [], isLoading: loadingUserTeams } =
    useIamUserTeams(selectedUserId || undefined);

  const addDepartment = useAddIamUserDepartment();
  const removeDepartment = useRemoveIamUserDepartment();
  const addTeam = useAddIamUserTeam();
  const removeTeam = useRemoveIamUserTeam();

  // ── Formulário: vincular departamento ──────────────────────────────────────
  const [departmentToAdd, setDepartmentToAdd] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  const availableDepartments = departments.filter(
    (d) => d.isActive && !userDepartments.some((ud) => ud.department.id === d.id),
  );

  function handleAddDepartment() {
    if (!selectedUserId || !departmentToAdd) return;
    addDepartment.mutate(
      { userId: selectedUserId, data: { departmentId: departmentToAdd, isPrimary } },
      {
        onSuccess: () => {
          toast.success('Departamento vinculado');
          setDepartmentToAdd('');
          setIsPrimary(false);
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao vincular departamento')),
      },
    );
  }

  async function handleRemoveDepartment(departmentId: string, name: string) {
    const ok = await confirm({
      title: 'Remover vínculo?',
      description: `"${selectedUser?.name}" deixará de pertencer ao departamento "${name}".`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    removeDepartment.mutate(
      { userId: selectedUserId, departmentId },
      {
        onSuccess: () => toast.success('Vínculo removido'),
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao remover vínculo')),
      },
    );
  }

  // ── Formulário: vincular equipe ────────────────────────────────────────────
  const [teamToAdd, setTeamToAdd] = useState('');

  const availableTeams = teams.filter(
    (t) => t.isActive && !userTeams.some((ut) => ut.team.id === t.id),
  );

  function handleAddTeam() {
    if (!selectedUserId || !teamToAdd) return;
    addTeam.mutate(
      { userId: selectedUserId, data: { teamId: teamToAdd } },
      {
        onSuccess: () => {
          toast.success('Equipe vinculada');
          setTeamToAdd('');
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao vincular equipe')),
      },
    );
  }

  async function handleRemoveTeam(teamId: string, name: string) {
    const ok = await confirm({
      title: 'Remover vínculo?',
      description: `"${selectedUser?.name}" deixará de ser membro da equipe "${name}".`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    removeTeam.mutate(
      { userId: selectedUserId, teamId },
      {
        onSuccess: () => toast.success('Vínculo removido'),
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao remover vínculo')),
      },
    );
  }

  const userOptions: ComboboxOption[] = users.map((u) => ({
    value: u.id,
    label: `${u.name} · ${u.email}`,
  }));

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <Field label="Usuário">
          <Combobox
            options={userOptions}
            value={selectedUserId}
            onValueChange={(v: string) => setSelectedUserId(v)}
            placeholder={loadingUsers ? 'Carregando usuários...' : 'Selecione um usuário'}
            searchPlaceholder="Buscar por nome ou e-mail..."
          />
        </Field>
      </div>

      {!selectedUserId ? (
        <EmptyState
          title="Selecione um usuário"
          description="Escolha um usuário acima para ver e gerenciar os departamentos e equipes dele. O vínculo por FILIAL é feito no escopo da atribuição de perfil (Perfis e Permissões → Atribuições)."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Departamentos do usuário ── */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-content">Departamentos</h3>
            {loadingUserDeps ? (
              <Skeleton className="h-24 w-full" />
            ) : userDepartments.length === 0 ? (
              <p className="py-4 text-center text-xs text-content-muted">
                Nenhum departamento vinculado.
              </p>
            ) : (
              <ul className="space-y-2">
                {userDepartments.map((ud) => (
                  <li
                    key={ud.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-content">
                          {ud.department.name}
                        </span>
                        {ud.isPrimary && (
                          <Badge variant="brand">
                            <Star size={11} className="mr-0.5" />
                            Principal
                          </Badge>
                        )}
                        {!ud.department.isActive && (
                          <Badge variant="neutral">Inativo</Badge>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-content-muted">
                        {ud.department.code}
                      </div>
                    </div>
                    {canAssign && (
                      <button
                        onClick={() =>
                          handleRemoveDepartment(ud.department.id, ud.department.name)
                        }
                        title="Remover vínculo"
                        className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canAssign && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <Field label="Vincular departamento">
                  <Select
                    value={departmentToAdd}
                    onChange={(e) => setDepartmentToAdd(e.target.value)}
                  >
                    <option value="">Selecione um departamento</option>
                    {availableDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Toggle
                  size="sm"
                  checked={isPrimary}
                  onCheckedChange={(v) => setIsPrimary(v === true)}
                  label="Departamento principal (desmarca o principal anterior)"
                />
                <Button
                  onClick={handleAddDepartment}
                  disabled={!departmentToAdd || addDepartment.isPending}
                  className="w-full"
                >
                  <Plus size={16} />
                  Vincular departamento
                </Button>
              </div>
            )}
          </section>

          {/* ── Equipes do usuário ── */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-content">Equipes</h3>
            {loadingUserTeams ? (
              <Skeleton className="h-24 w-full" />
            ) : userTeams.length === 0 ? (
              <p className="py-4 text-center text-xs text-content-muted">
                Nenhuma equipe vinculada.
              </p>
            ) : (
              <ul className="space-y-2">
                {userTeams.map((ut) => (
                  <li
                    key={ut.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-content">
                          {ut.team.name}
                        </span>
                        {!ut.team.isActive && <Badge variant="neutral">Inativa</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-content-muted">
                        {ut.team.department.name} ({ut.team.department.code})
                      </div>
                    </div>
                    {canAssign && (
                      <button
                        onClick={() => handleRemoveTeam(ut.team.id, ut.team.name)}
                        title="Remover vínculo"
                        className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canAssign && (
              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <Field label="Vincular equipe">
                  <Select value={teamToAdd} onChange={(e) => setTeamToAdd(e.target.value)}>
                    <option value="">Selecione uma equipe</option>
                    {availableTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.department?.name ?? ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  onClick={handleAddTeam}
                  disabled={!teamToAdd || addTeam.isPending}
                  className="w-full"
                >
                  <Plus size={16} />
                  Vincular equipe
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
