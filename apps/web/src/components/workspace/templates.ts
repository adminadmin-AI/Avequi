import type { WidgetInstance } from './types';

/**
 * Templates de Workspace por perfil — F0.
 *
 * Papel define a EXPERIÊNCIA default (o que aparece e em que ordem);
 * permissão define o TETO (o que pode existir). São camadas separadas:
 * o Workspace ainda filtra cada widget do template pela permissão efetiva
 * do usuário, então um template nunca "vaza" nada — só compõe.
 *
 * Fonte do perfil (resolveProfile), em ordem de precedência:
 *   1. (F2) override explícito salvo pelo usuário
 *   2. perfis RBAC v2 diretamente atribuídos (GET /auth/me/permissions → roles)
 *   3. fallback do enum legado (User.role) para usuários não migrados
 *   4. 'default'
 */

export type WorkspaceProfile =
  | 'executive'
  | 'operations'
  | 'production'
  | 'purchasing'
  | 'finance'
  | 'commercial'
  | 'logistics'
  | 'default';

export interface WorkspaceTemplate {
  profile: WorkspaceProfile;
  /** Ordem do array = ordem de leitura. Autorar sempre em ordem de zona
   *  (orientation → attention → work → context) — há spec garantindo. */
  widgets: WidgetInstance[];
}

// Chaves de métrica do kpi-summary (ver METRICS em kpi-summary-widget.tsx)
const FINANCE_METRICS = ['revenue', 'cash', 'overdue-receivable', 'payable-upcoming'];
const OPS_METRICS = ['active-ops', 'stock-below-min'];
const ALL_METRICS = [...FINANCE_METRICS, ...OPS_METRICS];

// Chaves de atalho (ver SHORTCUT_ACTIONS em shortcuts-widget.tsx)
const ALL_SHORTCUTS = ['new-sale', 'new-production', 'new-product', 'new-purchase'];

export const TEMPLATES: Record<WorkspaceProfile, WorkspaceTemplate> = {
  executive: {
    profile: 'executive',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: ALL_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ALL_SHORTCUTS } },
      { id: 'cashflow-13w' },
      { id: 'crm-portfolio' },
      { id: 'agenda' },
      { id: 'chart-revenue' },
      { id: 'chart-production' },
    ],
  },
  // Gestão operacional (MANAGER legado, ADMIN_FILIAL): operação sem finanças.
  operations: {
    profile: 'operations',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: OPS_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ALL_SHORTCUTS } },
      { id: 'capacity-bottlenecks' },
      { id: 'agenda' },
      { id: 'chart-production' },
      { id: 'chart-revenue' },
    ],
  },
  // Chão de fábrica: nunca faturamento, nunca caixa — nem no template.
  production: {
    profile: 'production',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: OPS_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ['new-production', 'new-product'] } },
      { id: 'capacity-bottlenecks' },
      { id: 'agenda' },
      { id: 'chart-production' },
    ],
  },
  purchasing: {
    profile: 'purchasing',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: ['stock-below-min'] } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ['new-purchase', 'new-product'] } },
      { id: 'agenda' },
    ],
  },
  finance: {
    profile: 'finance',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: FINANCE_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ['new-sale'] } },
      { id: 'cashflow-13w', size: 'full' },
      { id: 'agenda' },
      { id: 'chart-revenue' },
    ],
  },
  commercial: {
    profile: 'commercial',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: ['revenue'] } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ['new-sale', 'new-product'] } },
      { id: 'crm-sla' },
      { id: 'crm-portfolio' },
      { id: 'agenda' },
      { id: 'chart-revenue' },
    ],
  },
  logistics: {
    profile: 'logistics',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: OPS_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ['new-product'] } },
      { id: 'wms-queue' },
      { id: 'vehicle-docs' },
      { id: 'agenda' },
    ],
  },
  // Sem perfil reconhecido: composição ampla, a permissão apara o resto.
  default: {
    profile: 'default',
    widgets: [
      { id: 'greeting' },
      { id: 'kpi-summary', props: { metrics: ALL_METRICS } },
      { id: 'ai-insights' },
      { id: 'pending-tasks' },
      { id: 'shortcuts', props: { actions: ALL_SHORTCUTS } },
      { id: 'agenda' },
      { id: 'chart-revenue' },
      { id: 'chart-production' },
    ],
  },
};

// ─── Resolução de perfil ─────────────────────────────────────────────────────

/**
 * Perfis RBAC v2 (roles.catalog.ts) → perfil de workspace.
 * Roles não mapeadas caem no fallback do enum legado e depois em 'default'
 * — nunca é erro ter role nova sem mapeamento aqui.
 */
const V2_ROLE_TO_PROFILE: Record<string, WorkspaceProfile> = {
  ADMIN_GLOBAL: 'executive',
  ADMIN_EMPRESA: 'executive',
  DIRETOR: 'executive',
  GERENTE_GERAL: 'executive',
  ADMIN_FILIAL: 'operations',
  GERENTE_INDUSTRIAL: 'production',
  SUPERVISOR_PRODUCAO: 'production',
  OPERADOR_PCP: 'production',
  OPERADOR_PRODUCAO: 'production',
  QUALIDADE: 'production',
  GERENTE_COMPRAS: 'purchasing',
  COMPRADOR: 'purchasing',
  GERENTE_FINANCEIRO: 'finance',
  FINANCEIRO: 'finance',
  FISCAL: 'finance',
  LOJA_FATURAMENTO: 'finance',
  GERENTE_COMERCIAL: 'commercial',
  COORDENADOR_COMERCIAL: 'commercial',
  VENDEDOR: 'commercial',
  SUPERVISOR_ESTOQUE: 'logistics',
  ALMOXARIFE: 'logistics',
  GERENTE_LOJA: 'logistics',
  LOJA_OPERACIONAL: 'logistics',
};

/** Enum legado (User.role) → perfil, para usuários ainda não migrados ao v2. */
const LEGACY_ROLE_TO_PROFILE: Record<string, WorkspaceProfile> = {
  SUPER_ADMIN: 'executive',
  DIRECTOR: 'executive',
  MANAGER: 'operations',
  PRODUCTION: 'production',
  QUALITY: 'production',
  FINANCIAL: 'finance',
  COMMERCIAL: 'commercial',
  WAREHOUSE: 'logistics',
  STORE: 'logistics',
};

/**
 * Com múltiplos perfis v2, vence o de maior alcance (um DIRETOR que também é
 * FINANCEIRO abre no executivo, não no financeiro).
 */
const PROFILE_PRECEDENCE: readonly WorkspaceProfile[] = [
  'executive',
  'operations',
  'finance',
  'commercial',
  'purchasing',
  'production',
  'logistics',
  'default',
] as const;

export function resolveProfile(
  v2Roles: string[] | undefined,
  legacyRole: string | undefined,
): WorkspaceProfile {
  const candidates = (v2Roles ?? [])
    .map((r) => V2_ROLE_TO_PROFILE[r])
    .filter((p): p is WorkspaceProfile => p != null);
  if (candidates.length > 0) {
    return PROFILE_PRECEDENCE.find((p) => candidates.includes(p)) ?? 'default';
  }
  if (legacyRole && LEGACY_ROLE_TO_PROFILE[legacyRole]) {
    return LEGACY_ROLE_TO_PROFILE[legacyRole];
  }
  return 'default';
}
