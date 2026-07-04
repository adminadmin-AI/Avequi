'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Copy, Save, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  apiErrorMessage,
  useCreateIamRole,
  useIamRoles,
  usePermissionsCatalog,
  useRolePermissions,
  useSetRolePermissions,
} from '@/hooks/use-iam';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { PermissionTree } from './permission-tree';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'DIRECTOR'];

/**
 * Detalhe do perfil: árvore de permissões agrupada por módulo (#352).
 * Perfis system são somente leitura (com atalho "Duplicar" para criar um
 * personalizado a partir dele); perfis custom salvam via PUT (set completo).
 */
export default function RolePermissionsPage() {
  const params = useParams<{ id: string }>();
  const roleId = params?.id;
  const router = useRouter();
  const toast = useToast();
  const currentUser = useAuthStore((s) => s.user);
  const canManage = !!currentUser && ALLOWED_ROLES.includes(currentUser.role);

  const { data: roles = [] } = useIamRoles(canManage);
  const role = roles.find((r) => r.id === roleId);

  const { data: rolePerms, isLoading: loadingPerms } = useRolePermissions(
    canManage ? roleId : undefined,
  );
  const { data: catalog = [], isLoading: loadingCatalog } =
    usePermissionsCatalog(canManage);

  const setRolePermissions = useSetRolePermissions();
  const createRole = useCreateIamRole();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  // Estado inicial vindo do servidor (recarrega quando o perfil muda)
  useEffect(() => {
    if (rolePerms) {
      setSelected(new Set(rolePerms.codes));
      setDirty(false);
    }
  }, [rolePerms]);

  const inherited = useMemo(
    () => new Set(rolePerms?.inheritedCodes ?? []),
    [rolePerms],
  );

  const isSystem = rolePerms?.isSystem ?? role?.isSystem ?? false;
  const loading = loadingPerms || loadingCatalog;

  function handleChange(next: Set<string>) {
    setSelected(next);
    setDirty(true);
  }

  function handleSave() {
    if (!roleId) return;
    setRolePermissions.mutate(
      { roleId, codes: [...selected].sort() },
      {
        onSuccess: () => {
          toast.success('Permissões salvas');
          setDirty(false);
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao salvar permissões')),
      },
    );
  }

  function handleDuplicate() {
    if (!rolePerms) return;
    createRole.mutate(
      {
        name: `${rolePerms.name} (cópia)`,
        description: `Cópia do perfil de sistema ${rolePerms.name}.`,
        copyFromRoleId: rolePerms.roleId,
      },
      {
        onSuccess: (created) => {
          toast.success('Perfil duplicado — agora ele é editável');
          router.push(`/app/settings/roles/${created.id}`);
        },
        onError: (e) => toast.error(apiErrorMessage(e, 'Erro ao duplicar perfil')),
      },
    );
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Perfil" backHref="/app/settings/roles" />
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
          <ShieldAlert className="text-content-muted" size={40} />
          <p className="text-sm font-medium text-content-secondary">Acesso restrito</p>
        </div>
      </div>
    );
  }

  const totalSelected = selected.size + [...inherited].filter((c) => !selected.has(c)).length;

  return (
    <div>
      <PageHeader
        title={rolePerms?.name ?? role?.name ?? 'Perfil'}
        backHref="/app/settings/roles"
        description={
          isSystem
            ? 'Perfil de sistema — somente leitura. Duplique para personalizar.'
            : 'Marque as permissões deste perfil e salve (o conjunto é substituído por completo).'
        }
        meta={
          <div className="flex items-center gap-2">
            {rolePerms && (
              <>
                <Badge variant={isSystem ? 'info' : 'brand'}>
                  {isSystem ? 'Sistema' : 'Personalizado'}
                </Badge>
                <span className="text-xs text-content-muted">{rolePerms.code}</span>
                <span className="text-xs text-content-muted">
                  · {totalSelected} permissão(ões) efetiva(s)
                </span>
              </>
            )}
          </div>
        }
        actions={
          isSystem ? (
            <Button onClick={handleDuplicate} loading={createRole.isPending}>
              <Copy size={16} />
              Duplicar como personalizado
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={!dirty}
              loading={setRolePermissions.isPending}
            >
              <Save size={16} />
              Salvar permissões
            </Button>
          )
        }
      />

      {isSystem && (
        <Alert variant="info" title="Perfil de sistema (somente leitura)" className="mb-4">
          Perfis de sistema são mantidos pelo catálogo versionado em código e não podem
          ser editados aqui. Use &quot;Duplicar como personalizado&quot; para criar uma
          variação editável para a sua empresa.
        </Alert>
      )}

      {dirty && !isSystem && (
        <Alert variant="warning" title="Alterações não salvas" className="mb-4">
          O botão &quot;Salvar permissões&quot; substitui o conjunto completo do perfil
          de forma transacional.
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <PermissionTree
          catalog={catalog}
          selected={selected}
          inherited={inherited}
          readOnly={isSystem}
          onChange={handleChange}
        />
      )}
    </div>
  );
}
