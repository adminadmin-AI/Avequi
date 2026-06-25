import type { UserRole } from '@/types/api';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface RoleMeta {
  value: UserRole;
  label: string;
  variant: BadgeVariant;
}

// Papéis reais do enum UserRole (Prisma). A issue #89 citava OPERATOR/VIEWER,
// que não existem no schema — usamos os valores reais do backend.
export const ROLE_OPTIONS: RoleMeta[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', variant: 'danger' },
  { value: 'DIRECTOR', label: 'Diretor', variant: 'brand' },
  { value: 'MANAGER', label: 'Gerente', variant: 'info' },
  { value: 'COMMERCIAL', label: 'Comercial', variant: 'success' },
  { value: 'PRODUCTION', label: 'Produção', variant: 'warning' },
  { value: 'QUALITY', label: 'Qualidade', variant: 'info' },
  { value: 'WAREHOUSE', label: 'Estoque', variant: 'neutral' },
  { value: 'FINANCIAL', label: 'Financeiro', variant: 'success' },
  { value: 'STORE', label: 'Loja', variant: 'neutral' },
  { value: 'READER', label: 'Leitura', variant: 'neutral' },
];

const ROLE_MAP = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r])) as Record<
  UserRole,
  RoleMeta
>;

export function roleLabel(role: UserRole): string {
  return ROLE_MAP[role]?.label ?? role;
}

export function roleVariant(role: UserRole): BadgeVariant {
  return ROLE_MAP[role]?.variant ?? 'neutral';
}
