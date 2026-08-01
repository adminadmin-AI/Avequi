'use client';

import type { WidgetDefinition, WidgetId } from './types';
import { WIDGET_META } from './widget-meta';
import { GreetingWidget } from './widgets/greeting-widget';
import { KpiSummaryWidget } from './widgets/kpi-summary-widget';
import { MyDayWidget } from './widgets/my-day-widget';
import { AiInsightsWidget } from './widgets/ai-insights-widget';
import { PendingTasksWidget } from './widgets/pending-tasks-widget';
import { AlertsWidget } from './widgets/alerts-widget';
import { ShortcutsWidget } from './widgets/shortcuts-widget';
import { AgendaWidget } from './widgets/agenda-widget';
import { CashFlowWidget } from './widgets/cashflow-widget';
import { CrmSlaWidget } from './widgets/crm-sla-widget';
import { CrmPortfolioWidget } from './widgets/crm-portfolio-widget';
import { WmsQueueWidget } from './widgets/wms-queue-widget';
import { VehicleDocsWidget } from './widgets/vehicle-docs-widget';
import { CapacityWidget } from './widgets/capacity-widget';
import { RevenueChartWidget } from './widgets/revenue-chart-widget';
import { ProductionChartWidget } from './widgets/production-chart-widget';
import { QuickNotesWidget } from './widgets/quick-notes-widget';

/**
 * Registry de widgets — casa os metadados puros (widget-meta.ts) com os
 * componentes. Widget novo = meta + componente + entrada aqui; os templates
 * (templates.ts) passam a poder referenciá-lo.
 */
export const WIDGETS: Record<WidgetId, WidgetDefinition> = {
  greeting: { ...WIDGET_META.greeting, Component: GreetingWidget },
  'kpi-summary': { ...WIDGET_META['kpi-summary'], Component: KpiSummaryWidget },
  'my-day': { ...WIDGET_META['my-day'], Component: MyDayWidget },
  'ai-insights': { ...WIDGET_META['ai-insights'], Component: AiInsightsWidget },
  'pending-tasks': { ...WIDGET_META['pending-tasks'], Component: PendingTasksWidget },
  alerts: { ...WIDGET_META.alerts, Component: AlertsWidget },
  shortcuts: { ...WIDGET_META.shortcuts, Component: ShortcutsWidget },
  agenda: { ...WIDGET_META.agenda, Component: AgendaWidget },
  'cashflow-13w': { ...WIDGET_META['cashflow-13w'], Component: CashFlowWidget },
  'crm-sla': { ...WIDGET_META['crm-sla'], Component: CrmSlaWidget },
  'crm-portfolio': { ...WIDGET_META['crm-portfolio'], Component: CrmPortfolioWidget },
  'wms-queue': { ...WIDGET_META['wms-queue'], Component: WmsQueueWidget },
  'vehicle-docs': { ...WIDGET_META['vehicle-docs'], Component: VehicleDocsWidget },
  'capacity-bottlenecks': { ...WIDGET_META['capacity-bottlenecks'], Component: CapacityWidget },
  'chart-revenue': { ...WIDGET_META['chart-revenue'], Component: RevenueChartWidget },
  'chart-production': { ...WIDGET_META['chart-production'], Component: ProductionChartWidget },
  'quick-notes': { ...WIDGET_META['quick-notes'], Component: QuickNotesWidget },
};
