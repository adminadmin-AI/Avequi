import type { LayoutOverride, WidgetInstance, WidgetId } from './types';
import { WIDGET_META } from './widget-meta';
import type { WorkspaceTemplate } from './templates';

/**
 * Merge template × overrides do usuário (F2) — função PURA, testada em node.
 *
 * Semântica:
 * - O template é a base e a fonte de verdade do DISPONÍVEL: override de id
 *   que não está no template é ignorado (forward-compat — widget removido/
 *   renomeado não quebra ninguém).
 * - Zonas 'orientation' e 'attention' têm ordem FIXA do template (invariante
 *   "tarefa acima de gráfico"); o usuário pode ocultar, não reordenar.
 * - Zonas 'work' e 'context' reordenam: a ordem dos overrides vale para os
 *   ids presentes; widget do template SEM override entra na posição default
 *   (apêndice na ordem do template) — widget novo aparece automaticamente.
 * - `pinned` sobe o widget para o topo da parte reordenável.
 * - `hidden` remove da renderização (mas continua listável no modo edição).
 * - `size` só aplica se estiver nos presets permitidos do widget.
 */

const FIXED_ZONES = new Set(['orientation', 'attention']);

function applyOverride(w: WidgetInstance, o: LayoutOverride | undefined): WidgetInstance {
  if (!o?.size) return w;
  return WIDGET_META[w.id].sizes.includes(o.size) ? { ...w, size: o.size } : w;
}

export function mergeLayout(
  template: WorkspaceTemplate,
  overrides: LayoutOverride[] | null | undefined,
): WidgetInstance[] {
  if (!overrides?.length) return template.widgets;
  const byId = new Map(overrides.map((o) => [o.id, o]));

  const fixed = template.widgets.filter((w) => FIXED_ZONES.has(WIDGET_META[w.id].zone));
  const reorderable = template.widgets.filter((w) => !FIXED_ZONES.has(WIDGET_META[w.id].zone));

  const overrideOrder = overrides
    .map((o) => o.id)
    .filter((id) => reorderable.some((w) => w.id === id));
  const ordered = [
    ...overrideOrder.map((id) => reorderable.find((w) => w.id === id)!),
    ...reorderable.filter((w) => !overrideOrder.includes(w.id)),
  ];
  const pinnedFirst = [
    ...ordered.filter((w) => byId.get(w.id)?.pinned),
    ...ordered.filter((w) => !byId.get(w.id)?.pinned),
  ];

  return [...fixed, ...pinnedFirst]
    .filter((w) => !byId.get(w.id)?.hidden)
    .map((w) => applyOverride(w, byId.get(w.id)));
}

/** Widgets do template ocultados pelo usuário — para a bandeja do modo edição. */
export function hiddenWidgets(
  template: WorkspaceTemplate,
  overrides: LayoutOverride[] | null | undefined,
): WidgetId[] {
  if (!overrides?.length) return [];
  const hidden = new Set(overrides.filter((o) => o.hidden).map((o) => o.id));
  return template.widgets.map((w) => w.id).filter((id) => hidden.has(id));
}
