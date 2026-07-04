'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AssignIamRoleInput,
  CreateIamRoleInput,
  GrantIamPermissionInput,
  IamPermissionCatalogModule,
  IamRole,
  IamRolePermissions,
  IamUserPermission,
  IamUserRoleAssignment,
  UpdateIamRoleInput,
} from '@/types/api';

/**
 * Hooks TanStack Query do IAM v2 — tela de perfis e permissões (#352).
 *
 * Endpoints sob /iam (SUPER_ADMIN/DIRECTOR + iam.roles.*). O companyId é
 * resolvido no backend a partir do JWT — nenhum hook envia companyId.
 */

const KEYS = {
  roles: ['iam', 'roles'] as const,
  rolePermissions: (roleId: string) => ['iam', 'roles', roleId, 'permissions'] as const,
  catalog: ['iam', 'permissions-catalog'] as const,
  userRoles: (userId: string) => ['iam', 'users', userId, 'roles'] as const,
  userPermissions: (userId: string) => ['iam', 'users', userId, 'permissions'] as const,
};

// ─── Perfis ───────────────────────────────────────────────────────────────────

export function useIamRoles(enabled = true) {
  return useQuery<IamRole[]>({
    queryKey: KEYS.roles,
    enabled,
    queryFn: async () => (await apiClient.get<IamRole[]>('/iam/roles')).data,
  });
}

export function usePermissionsCatalog(enabled = true) {
  return useQuery<IamPermissionCatalogModule[]>({
    queryKey: KEYS.catalog,
    enabled,
    staleTime: 5 * 60_000, // catálogo muda só em deploy
    queryFn: async () =>
      (await apiClient.get<IamPermissionCatalogModule[]>('/iam/permissions')).data,
  });
}

export function useRolePermissions(roleId: string | undefined) {
  return useQuery<IamRolePermissions>({
    queryKey: KEYS.rolePermissions(roleId ?? ''),
    enabled: !!roleId,
    queryFn: async () =>
      (await apiClient.get<IamRolePermissions>(`/iam/roles/${roleId}/permissions`)).data,
  });
}

export function useCreateIamRole() {
  const qc = useQueryClient();
  return useMutation<IamRole, unknown, CreateIamRoleInput>({
    mutationFn: async (input) => (await apiClient.post<IamRole>('/iam/roles', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.roles }),
  });
}

export function useUpdateIamRole() {
  const qc = useQueryClient();
  return useMutation<IamRole, unknown, { id: string; data: UpdateIamRoleInput }>({
    mutationFn: async ({ id, data }) =>
      (await apiClient.patch<IamRole>(`/iam/roles/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.roles }),
  });
}

export function useDeleteIamRole() {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`/iam/roles/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.roles }),
  });
}

export function useSetRolePermissions() {
  const qc = useQueryClient();
  return useMutation<IamRolePermissions, unknown, { roleId: string; codes: string[] }>({
    mutationFn: async ({ roleId, codes }) =>
      (
        await apiClient.put<IamRolePermissions>(`/iam/roles/${roleId}/permissions`, {
          codes,
        })
      ).data,
    onSuccess: (_data, { roleId }) => {
      qc.invalidateQueries({ queryKey: KEYS.rolePermissions(roleId) });
      qc.invalidateQueries({ queryKey: KEYS.roles });
    },
  });
}

// ─── Atribuições por usuário ──────────────────────────────────────────────────

export function useUserRoles(userId: string | undefined) {
  return useQuery<IamUserRoleAssignment[]>({
    queryKey: KEYS.userRoles(userId ?? ''),
    enabled: !!userId,
    queryFn: async () =>
      (await apiClient.get<IamUserRoleAssignment[]>(`/iam/users/${userId}/roles`)).data,
  });
}

export function useAssignUserRole() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; data: AssignIamRoleInput }>({
    mutationFn: async ({ userId, data }) =>
      (await apiClient.post(`/iam/users/${userId}/roles`, data)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userRoles(userId) });
      qc.invalidateQueries({ queryKey: KEYS.roles }); // _count.userAssignments
    },
  });
}

export function useRemoveUserRole() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; roleId: string }>({
    mutationFn: async ({ userId, roleId }) =>
      (await apiClient.delete(`/iam/users/${userId}/roles/${roleId}`)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userRoles(userId) });
      qc.invalidateQueries({ queryKey: KEYS.roles });
    },
  });
}

export function useUserPermissions(userId: string | undefined) {
  return useQuery<IamUserPermission[]>({
    queryKey: KEYS.userPermissions(userId ?? ''),
    enabled: !!userId,
    queryFn: async () =>
      (await apiClient.get<IamUserPermission[]>(`/iam/users/${userId}/permissions`)).data,
  });
}

export function useGrantUserPermission() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; data: GrantIamPermissionInput }>({
    mutationFn: async ({ userId, data }) =>
      (await apiClient.post(`/iam/users/${userId}/permissions`, data)).data,
    onSuccess: (_d, { userId }) =>
      qc.invalidateQueries({ queryKey: KEYS.userPermissions(userId) }),
  });
}

export function useRemoveUserPermission() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; userPermissionId: string }>({
    mutationFn: async ({ userId, userPermissionId }) =>
      (await apiClient.delete(`/iam/users/${userId}/permissions/${userPermissionId}`)).data,
    onSuccess: (_d, { userId }) =>
      qc.invalidateQueries({ queryKey: KEYS.userPermissions(userId) }),
  });
}

/** Extrai a mensagem pt-BR do erro padrão da API (403/409/400 explicativos). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as any)?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string') return message;
  return fallback;
}
