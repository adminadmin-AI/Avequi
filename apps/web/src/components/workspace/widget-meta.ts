import type { WidgetId, WidgetMeta } from './types';

/**
 * Metadados dos widgets — módulo PURO (sem React) para os specs rodarem em
 * node sem arrastar recharts/zustand. O registry (widget-registry.tsx) casa
 * cada meta com seu componente.
 *
 * `permission` segue a regra de ouro: é o code do endpoint que o widget
 * consome (anyOf). Widgets compostos (kpi-summary, shortcuts) ficam com []
 * no frame e gateiam cada item internamente — assim um financeiro sem acesso
 * a produção ainda vê o bloco, só sem as métricas de produção.
 */
export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
  greeting: {
    id: 'greeting',
    title: 'Saudação',
    permission: [],
    zone: 'orientation',
    defaultSize: 'full',
  },
  'kpi-summary': {
    id: 'kpi-summary',
    title: 'Indicadores',
    permission: [], // cada métrica gateia a si mesma (ver METRICS no widget)
    zone: 'orientation',
    defaultSize: 'full',
  },
  'ai-insights': {
    id: 'ai-insights',
    title: 'Resumo do dia',
    permission: ['workspace.insights.view'], // GET /workspace/insights
    zone: 'attention',
    defaultSize: 'full',
  },
  'pending-tasks': {
    id: 'pending-tasks',
    title: 'Minhas Pendências',
    permission: ['workspace.tasks.view'], // GET /workspace/tasks
    zone: 'attention',
    defaultSize: 'half',
  },
  // Fora dos templates desde a F1 (o Resumo do dia o substitui na atenção);
  // segue registrado para a personalização da F2 poder reativá-lo.
  alerts: {
    id: 'alerts',
    title: 'Pendências & Alertas',
    permission: ['dashboard.alerts.view'], // GET /alerts
    zone: 'attention',
    defaultSize: 'half',
  },
  shortcuts: {
    id: 'shortcuts',
    title: 'Ações rápidas',
    permission: [], // cada atalho gateia a si mesmo (ver SHORTCUT_ACTIONS)
    zone: 'attention',
    defaultSize: 'half',
  },
  agenda: {
    id: 'agenda',
    title: 'Agenda da semana',
    permission: ['workspace.agenda.view'], // GET /workspace/agenda
    zone: 'work',
    defaultSize: 'half',
  },
  'chart-revenue': {
    id: 'chart-revenue',
    title: 'Faturamento',
    permission: ['analytics.dashboards.view'], // GET /analytics/sales-cube
    zone: 'context',
    defaultSize: 'half',
  },
  'chart-production': {
    id: 'chart-production',
    title: 'Produção por status',
    permission: ['production.orders.view'], // GET /production
    zone: 'context',
    defaultSize: 'half',
  },
};

export const ALL_WIDGET_IDS = Object.keys(WIDGET_META) as WidgetId[];
