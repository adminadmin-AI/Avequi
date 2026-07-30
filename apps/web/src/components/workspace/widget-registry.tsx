'use client';

import type { WidgetDefinition, WidgetId } from './types';
import { WIDGET_META } from './widget-meta';
import { GreetingWidget } from './widgets/greeting-widget';
import { KpiSummaryWidget } from './widgets/kpi-summary-widget';
import { AlertsWidget } from './widgets/alerts-widget';
import { ShortcutsWidget } from './widgets/shortcuts-widget';
import { RevenueChartWidget } from './widgets/revenue-chart-widget';
import { ProductionChartWidget } from './widgets/production-chart-widget';

/**
 * Registry de widgets — casa os metadados puros (widget-meta.ts) com os
 * componentes. Widget novo = meta + componente + entrada aqui; os templates
 * (templates.ts) passam a poder referenciá-lo.
 */
export const WIDGETS: Record<WidgetId, WidgetDefinition> = {
  greeting: { ...WIDGET_META.greeting, Component: GreetingWidget },
  'kpi-summary': { ...WIDGET_META['kpi-summary'], Component: KpiSummaryWidget },
  alerts: { ...WIDGET_META.alerts, Component: AlertsWidget },
  shortcuts: { ...WIDGET_META.shortcuts, Component: ShortcutsWidget },
  'chart-revenue': { ...WIDGET_META['chart-revenue'], Component: RevenueChartWidget },
  'chart-production': { ...WIDGET_META['chart-production'], Component: ProductionChartWidget },
};
