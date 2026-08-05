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
    defaultSize: 'large',
    sizes: ['large'],
  },
  'kpi-summary': {
    id: 'kpi-summary',
    title: 'Indicadores',
    permission: [], // cada métrica gateia a si mesma (ver METRICS no widget)
    zone: 'orientation',
    defaultSize: 'large',
    sizes: ['large'],
  },
  'my-day': {
    id: 'my-day',
    title: 'Meu dia',
    permission: ['workspace.insights.view'], // GET /workspace/my-day
    zone: 'orientation',
    defaultSize: 'large',
    sizes: ['large'],
  },
  'ai-insights': {
    id: 'ai-insights',
    title: 'Resumo da operação',
    permission: ['workspace.insights.view'], // GET /workspace/insights
    zone: 'attention',
    defaultSize: 'large',
    sizes: ['large'],
  },
  'pending-tasks': {
    id: 'pending-tasks',
    title: 'Minha Mesa',
    permission: ['workspace.tasks.view'], // GET /workspace/tasks
    zone: 'attention',
    defaultSize: 'medium',
    sizes: ['medium', 'large'],
  },
  // Fora dos templates desde a F1 (o Resumo do dia o substitui na atenção);
  // segue registrado para a personalização da F2 poder reativá-lo.
  alerts: {
    id: 'alerts',
    title: 'Pendências & Alertas',
    permission: ['dashboard.alerts.view'], // GET /alerts
    zone: 'attention',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  shortcuts: {
    id: 'shortcuts',
    title: 'Ações rápidas',
    permission: [], // cada atalho gateia a si mesmo (ver SHORTCUT_ACTIONS)
    zone: 'attention',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  agenda: {
    id: 'agenda',
    title: 'Agenda',
    permission: ['workspace.agenda.view'], // GET /workspace/agenda
    zone: 'work',
    // Calendário (rodada 2 UX): nasce full — grid de 7 colunas precisa de
    // largura; em half os chips degradam para dots.
    defaultSize: 'large',
    sizes: ['medium', 'large'],
  },
  'cashflow-13w': {
    id: 'cashflow-13w',
    title: 'Fluxo de caixa (13 semanas)',
    permission: ['finance.reports.view'], // GET /banking/cash-flow/weekly
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['medium', 'large'],
  },
  'crm-sla': {
    id: 'crm-sla',
    title: 'SLA de leads',
    permission: ['crm.leads.view'], // GET /crm/sla
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  'crm-portfolio': {
    id: 'crm-portfolio',
    title: 'Carteira de clientes',
    permission: ['crm.portfolio.view'], // GET /crm/portfolio (#846)
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  'vehicle-docs': {
    id: 'vehicle-docs',
    title: 'Documentos do veículo',
    permission: ['vehicle-tracking.documents.view'], // GET /vehicle-documents/pending-deliveries
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  'wms-queue': {
    id: 'wms-queue',
    title: 'Fila do armazém',
    permission: ['stock.wms.view'], // GET /wms/dashboard
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
  'capacity-bottlenecks': {
    id: 'capacity-bottlenecks',
    title: 'Capacidade & gargalos',
    permission: ['production.work-centers.view'], // GET /capacity/plan
    zone: 'work',
    defaultSize: 'medium',
    sizes: ['medium', 'large'],
  },
  'chart-revenue': {
    id: 'chart-revenue',
    title: 'Faturamento',
    permission: ['sales.orders.view'], // GET /workspace/revenue (venda faturada)
    zone: 'context',
    defaultSize: 'medium',
    sizes: ['medium', 'large'],
  },
  'chart-production': {
    id: 'chart-production',
    title: 'Produção',
    permission: ['production.orders.view'], // GET /production
    zone: 'context',
    defaultSize: 'medium',
    sizes: ['medium', 'large'],
  },
  'quick-notes': {
    id: 'quick-notes',
    title: 'Notas rápidas',
    permission: ['workspace.notes.view'], // GET /workspace/notes (post-its pessoais)
    zone: 'context',
    defaultSize: 'medium',
    sizes: ['small', 'medium', 'large'],
  },
};

export const ALL_WIDGET_IDS = Object.keys(WIDGET_META) as WidgetId[];
