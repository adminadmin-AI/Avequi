'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Plus, ShieldMinus, ShieldPlus, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useList } from '@/hooks/use-resource';
import {
  useAssignUserRole,
  useGrantUserPermission,
  usePermissionsCatalog,
  useRemoveUserPermission,
  useRemoveUserRole,
  useUserPermissions,
  useUserRoles,
} from '@/hooks/use-iam';
import { erroDeAcao } from '@/lib/feedback';
import type { IamRole, User } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { moduleLabel } from './iam-labels';
import { formatDate } from '@/lib/format';

/**
 * Aba "Atribuições" da tela de perfis (#352): vincula usuários a perfis e
 * gerencia exceções individuais (grants/denies com expiração e justificativa).
 * Fica AQUI (e não na página de usuários) para não conflitar com PRs pendentes
 * da tela settings/users.
 */
export function AssignmentsTab({
  roles,
  userIdInicial,
}: {
  roles: IamRole[];
  /** #946: usuário pré-selecionado quando se chega pela tela de usuários. */
  userIdInicial?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const currentUser = useAuthStore((s) => s.user);

  const { data: users = [], isLoading: loadingUsers } = useList<User>('/users');
  const [selectedUserId, setSelectedUserId] = useState(userIdInicial ?? '');
  const selectedUser = users.find((u) => u.id === selectedUserId);

  const { data: assignments = [], isLoading: loadingAssignments } =
    useUserRoles(selectedUserId || undefined);
  const { data: exceptions = [], isLoading: loadingExceptions } =
    useUserPermissions(selectedUserId || undefined);
  const { data: catalog = [] } = usePermissionsCatalog(!!selectedUserId);

  const assignRole = useAssignUserRole();
  const removeRole = useRemoveUserRole();
  const grantPermission = useGrantUserPermission();
  const removePermission = useRemoveUserPermission();

  // ── Formulário: atribuir perfil ────────────────────────────────────────────
  const [roleToAssign, setRoleToAssign] = useState('');
  const [roleExpiresAt, setRoleExpiresAt] = useState('');

  const assignableRoles = roles.filter(
    (r) => r.isActive && !assignments.some((a) => a.roleId === r.id),
  );

  function handleAssignRole() {
    if (!selectedUserId || !roleToAssign) return;
    assignRole.mutate(
      {
        userId: selectedUserId,
        data: {
          roleId: roleToAssign,
          expiresAt: roleExpiresAt ? new Date(roleExpiresAt).toISOString() : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success('Perfil atribuído');
          setRoleToAssign('');
          setRoleExpiresAt('');
        },
        onError: (e) => toast.error(erroDeAcao('atribuir o perfil', e)),
      },
    );
  }

  async function handleRemoveRole(roleId: string, roleName: string) {
    const ok = await confirm({
      title: 'Remover perfil?',
      description: `"${selectedUser?.name}" perderá as permissões do perfil "${roleName}".`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    removeRole.mutate(
      { userId: selectedUserId, roleId },
      {
        onSuccess: () => toast.success('Perfil removido'),
        onError: (e) => toast.error(erroDeAcao('remover o perfil', e)),
      },
    );
  }

  // ── Formulário: exceção individual ─────────────────────────────────────────
  const [permissionCode, setPermissionCode] = useState('');
  const [permissionMode, setPermissionMode] = useState<'grant' | 'deny'>('grant');
  const [permissionExpiresAt, setPermissionExpiresAt] = useState('');
  const [permissionReason, setPermissionReason] = useState('');

  const permissionOptions: ComboboxOption[] = useMemo(
    () =>
      catalog.flatMap((mod) =>
        mod.resources.flatMap((res) =>
          res.permissions.map((p) => ({
            value: p.code,
            label: `${p.name} (${p.code})`,
            group: moduleLabel(mod.module),
          })),
        ),
      ),
    [catalog],
  );

  function handleGrantPermission() {
    if (!selectedUserId || !permissionCode) return;
    grantPermission.mutate(
      {
        userId: selectedUserId,
        data: {
          permissionCode,
          granted: permissionMode === 'grant',
          expiresAt: permissionExpiresAt
            ? new Date(permissionExpiresAt).toISOString()
            : undefined,
          reason: permissionReason || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(
            permissionMode === 'grant' ? 'Permissão concedida' : 'Permissão negada',
          );
          setPermissionCode('');
          setPermissionExpiresAt('');
          setPermissionReason('');
        },
        onError: (e) => toast.error(erroDeAcao('salvar a exceção', e)),
      },
    );
  }

  async function handleRemoveException(id: string, code: string) {
    const ok = await confirm({
      title: 'Remover exceção?',
      description: `A exceção sobre "${code}" será removida; valem apenas os perfis.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    removePermission.mutate(
      { userId: selectedUserId, userPermissionId: id },
      {
        onSuccess: () => toast.success('Exceção removida'),
        onError: (e) => toast.error(erroDeAcao('remover a exceção', e)),
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
          description="Escolha um usuário acima para ver e gerenciar os perfis e exceções de permissão dele."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Perfis do usuário ── */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-content">
              Perfis atribuídos
            </h3>
            {loadingAssignments ? (
              <Skeleton className="h-24 w-full" />
            ) : assignments.length === 0 ? (
              <p className="py-4 text-center text-xs text-content-muted">
                Nenhum perfil atribuído. O usuário depende apenas do papel legado.
              </p>
            ) : (
              <ul className="space-y-2">
                {assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-content">
                          {a.role.name}
                        </span>
                        {a.role.isSystem && <Badge variant="info">Sistema</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-content-muted">
                        <span>{a.role.code}</span>
                        {a.expiresAt && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock size={12} />
                            expira {formatDate(a.expiresAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveRole(a.roleId, a.role.name)}
                      title="Remover perfil"
                      className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <Field label="Atribuir perfil">
                <Select value={roleToAssign} onChange={(e) => setRoleToAssign(e.target.value)}>
                  <option value="">Selecione um perfil</option>
                  {assignableRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.isSystem ? '(Sistema)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Expira em (opcional)">
                <Input
                  type="date"
                  value={roleExpiresAt}
                  onChange={(e) => setRoleExpiresAt(e.target.value)}
                />
              </Field>
              <Button
                onClick={handleAssignRole}
                disabled={!roleToAssign || assignRole.isPending}
                className="w-full"
              >
                <Plus size={16} />
                Atribuir perfil
              </Button>
            </div>
          </section>

          {/* ── Exceções individuais ── */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-content">
              Exceções individuais (grants / denies)
            </h3>
            {loadingExceptions ? (
              <Skeleton className="h-24 w-full" />
            ) : exceptions.length === 0 ? (
              <p className="py-4 text-center text-xs text-content-muted">
                Nenhuma exceção. Valem apenas as permissões dos perfis.
              </p>
            ) : (
              <ul className="space-y-2">
                {exceptions.map((ex) => (
                  <li
                    key={ex.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={ex.granted ? 'success' : 'danger'}>
                          {ex.granted ? 'Concedida' : 'Negada'}
                        </Badge>
                        <span className="truncate text-xs font-medium text-content">
                          {ex.permission.code}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-content-muted">
                        {ex.permission.name}
                        {ex.expiresAt && ` · expira ${formatDate(ex.expiresAt)}`}
                        {ex.reason && ` · ${ex.reason}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveException(ex.id, ex.permission.code)}
                      title="Remover exceção"
                      className="rounded-md p-1.5 text-content-muted hover:bg-neutral-100 hover:text-danger dark:hover:bg-neutral-800"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <Field label="Permissão">
                <Combobox
                  options={permissionOptions}
                  value={permissionCode}
                  onValueChange={(v: string) => setPermissionCode(v)}
                  placeholder="Selecione a permissão"
                  searchPlaceholder="Buscar permissão..."
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo">
                  <Select
                    value={permissionMode}
                    onChange={(e) => setPermissionMode(e.target.value as 'grant' | 'deny')}
                  >
                    <option value="grant">Conceder (grant)</option>
                    <option value="deny">Negar (deny)</option>
                  </Select>
                </Field>
                <Field label="Expira em (opcional)">
                  <Input
                    type="date"
                    value={permissionExpiresAt}
                    onChange={(e) => setPermissionExpiresAt(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Justificativa (auditável)">
                <Input
                  value={permissionReason}
                  onChange={(e) => setPermissionReason(e.target.value)}
                  placeholder="Ex.: cobertura de férias do financeiro"
                />
              </Field>
              <Button
                onClick={handleGrantPermission}
                disabled={!permissionCode || grantPermission.isPending}
                variant={permissionMode === 'deny' ? 'danger' : 'primary'}
                className="w-full"
              >
                {permissionMode === 'deny' ? (
                  <ShieldMinus size={16} />
                ) : (
                  <ShieldPlus size={16} />
                )}
                {permissionMode === 'deny' ? 'Negar permissão' : 'Conceder permissão'}
              </Button>
              {selectedUserId === currentUser?.id && (
                <p className="text-xs text-warning">
                  Você está editando o próprio acesso: o sistema bloqueia mudanças que
                  removeriam seu acesso à gestão de perfis (anti-lockout).
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
