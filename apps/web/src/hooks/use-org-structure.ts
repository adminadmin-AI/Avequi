'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AddIamUserDepartmentInput,
  AddIamUserTeamInput,
  CreateIamBranchInput,
  CreateIamDepartmentInput,
  CreateIamTeamInput,
  IamBranch,
  IamDepartment,
  IamTeam,
  IamUserDepartment,
  IamUserTeam,
  UpdateIamBranchInput,
  UpdateIamDepartmentInput,
  UpdateIamTeamInput,
} from '@/types/api';

/**
 * Hooks TanStack Query da estrutura organizacional — issue #347 (IAM F5.2,
 * fase 1): filiais, departamentos, equipes e vínculos usuário ↔ dept/equipe.
 *
 * Endpoints sob /iam (SUPER_ADMIN/DIRECTOR/MANAGER + iam.org.*). O companyId
 * é resolvido no backend a partir do JWT — nenhum hook envia companyId.
 * Mesmo padrão do use-iam.ts (#352/#472).
 */

const KEYS = {
  branches: ['iam', 'org', 'branches'] as const,
  departments: ['iam', 'org', 'departments'] as const,
  teams: ['iam', 'org', 'teams'] as const,
  userDepartments: (userId: string) =>
    ['iam', 'org', 'users', userId, 'departments'] as const,
  userTeams: (userId: string) => ['iam', 'org', 'users', userId, 'teams'] as const,
};

// ─── Filiais ──────────────────────────────────────────────────────────────────

export function useIamBranches(enabled = true) {
  return useQuery<IamBranch[]>({
    queryKey: KEYS.branches,
    enabled,
    queryFn: async () => (await apiClient.get<IamBranch[]>('/iam/branches')).data,
  });
}

export function useCreateIamBranch() {
  const qc = useQueryClient();
  return useMutation<IamBranch, unknown, CreateIamBranchInput>({
    mutationFn: async (input) =>
      (await apiClient.post<IamBranch>('/iam/branches', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.branches }),
  });
}

export function useUpdateIamBranch() {
  const qc = useQueryClient();
  return useMutation<IamBranch, unknown, { id: string; data: UpdateIamBranchInput }>({
    mutationFn: async ({ id, data }) =>
      (await apiClient.patch<IamBranch>(`/iam/branches/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.branches }),
  });
}

export function useDeleteIamBranch() {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`/iam/branches/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.branches }),
  });
}

// ─── Departamentos ────────────────────────────────────────────────────────────

export function useIamDepartments(enabled = true) {
  return useQuery<IamDepartment[]>({
    queryKey: KEYS.departments,
    enabled,
    queryFn: async () =>
      (await apiClient.get<IamDepartment[]>('/iam/departments')).data,
  });
}

export function useCreateIamDepartment() {
  const qc = useQueryClient();
  return useMutation<IamDepartment, unknown, CreateIamDepartmentInput>({
    mutationFn: async (input) =>
      (await apiClient.post<IamDepartment>('/iam/departments', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.departments }),
  });
}

export function useUpdateIamDepartment() {
  const qc = useQueryClient();
  return useMutation<
    IamDepartment,
    unknown,
    { id: string; data: UpdateIamDepartmentInput }
  >({
    mutationFn: async ({ id, data }) =>
      (await apiClient.patch<IamDepartment>(`/iam/departments/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.departments });
      qc.invalidateQueries({ queryKey: KEYS.teams }); // nome do dept aparece na aba equipes
    },
  });
}

export function useDeleteIamDepartment() {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`/iam/departments/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.departments }),
  });
}

// ─── Equipes ──────────────────────────────────────────────────────────────────

export function useIamTeams(enabled = true) {
  return useQuery<IamTeam[]>({
    queryKey: KEYS.teams,
    enabled,
    queryFn: async () => (await apiClient.get<IamTeam[]>('/iam/teams')).data,
  });
}

export function useCreateIamTeam() {
  const qc = useQueryClient();
  return useMutation<IamTeam, unknown, CreateIamTeamInput>({
    mutationFn: async (input) =>
      (await apiClient.post<IamTeam>('/iam/teams', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.teams });
      qc.invalidateQueries({ queryKey: KEYS.departments }); // _count.teams
    },
  });
}

export function useUpdateIamTeam() {
  const qc = useQueryClient();
  return useMutation<IamTeam, unknown, { id: string; data: UpdateIamTeamInput }>({
    mutationFn: async ({ id, data }) =>
      (await apiClient.patch<IamTeam>(`/iam/teams/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.teams });
      qc.invalidateQueries({ queryKey: KEYS.departments });
    },
  });
}

export function useDeleteIamTeam() {
  const qc = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      await apiClient.delete(`/iam/teams/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.teams });
      qc.invalidateQueries({ queryKey: KEYS.departments });
    },
  });
}

// ─── Vínculos usuário ↔ departamento ─────────────────────────────────────────

export function useIamUserDepartments(userId: string | undefined) {
  return useQuery<IamUserDepartment[]>({
    queryKey: KEYS.userDepartments(userId ?? ''),
    enabled: !!userId,
    queryFn: async () =>
      (await apiClient.get<IamUserDepartment[]>(`/iam/users/${userId}/departments`))
        .data,
  });
}

export function useAddIamUserDepartment() {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    unknown,
    { userId: string; data: AddIamUserDepartmentInput }
  >({
    mutationFn: async ({ userId, data }) =>
      (await apiClient.post(`/iam/users/${userId}/departments`, data)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userDepartments(userId) });
      qc.invalidateQueries({ queryKey: KEYS.departments }); // _count.users
    },
  });
}

export function useRemoveIamUserDepartment() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; departmentId: string }>({
    mutationFn: async ({ userId, departmentId }) =>
      (await apiClient.delete(`/iam/users/${userId}/departments/${departmentId}`)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userDepartments(userId) });
      qc.invalidateQueries({ queryKey: KEYS.departments });
    },
  });
}

// ─── Vínculos usuário ↔ equipe ───────────────────────────────────────────────

export function useIamUserTeams(userId: string | undefined) {
  return useQuery<IamUserTeam[]>({
    queryKey: KEYS.userTeams(userId ?? ''),
    enabled: !!userId,
    queryFn: async () =>
      (await apiClient.get<IamUserTeam[]>(`/iam/users/${userId}/teams`)).data,
  });
}

export function useAddIamUserTeam() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; data: AddIamUserTeamInput }>({
    mutationFn: async ({ userId, data }) =>
      (await apiClient.post(`/iam/users/${userId}/teams`, data)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userTeams(userId) });
      qc.invalidateQueries({ queryKey: KEYS.teams }); // _count.members
    },
  });
}

export function useRemoveIamUserTeam() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { userId: string; teamId: string }>({
    mutationFn: async ({ userId, teamId }) =>
      (await apiClient.delete(`/iam/users/${userId}/teams/${teamId}`)).data,
    onSuccess: (_d, { userId }) => {
      qc.invalidateQueries({ queryKey: KEYS.userTeams(userId) });
      qc.invalidateQueries({ queryKey: KEYS.teams });
    },
  });
}
