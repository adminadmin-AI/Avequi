import { describe, expect, it } from 'vitest';
import { hiddenWidgets, mergeLayout } from './merge';
import { TEMPLATES } from './templates';

/**
 * Merge template × overrides (F2) — os invariantes que a personalização
 * NUNCA pode quebrar.
 */

const T = TEMPLATES.executive;
const ids = (list: { id: string }[]) => list.map((w) => w.id);

describe('mergeLayout', () => {
  it('sem overrides devolve o template intacto', () => {
    expect(mergeLayout(T, undefined)).toBe(T.widgets);
    expect(mergeLayout(T, [])).toBe(T.widgets);
  });

  it('hidden remove o widget da renderização', () => {
    const out = mergeLayout(T, [{ id: 'chart-production', hidden: true }]);
    expect(ids(out)).not.toContain('chart-production');
    expect(out.length).toBe(T.widgets.length - 1);
  });

  it('reordena APENAS as zonas work/context; orientação e atenção ficam fixas', () => {
    // usuário tentou colocar o gráfico "antes de tudo" — a zona fixa segura
    const out = mergeLayout(T, [{ id: 'chart-production' }, { id: 'chart-revenue' }]);
    expect(ids(out).slice(0, 5)).toEqual([
      'greeting',
      'kpi-summary',
      'ai-insights',
      'pending-tasks',
      'shortcuts',
    ]);
    // dentro da parte reordenável, a ordem do override vale; sem override,
    // segue a ordem do template (cashflow-13w e agenda, F3)
    expect(ids(out).slice(5)).toEqual([
      'chart-production',
      'chart-revenue',
      'cashflow-13w',
      'crm-portfolio',
      'agenda',
      'quick-notes',
    ]);
  });

  it('widget do template sem override aparece na posição default (widget novo entra sozinho)', () => {
    const out = mergeLayout(T, [{ id: 'chart-revenue' }]);
    // cashflow/agenda/chart-production não têm override → ordem do template após os ordenados
    expect(ids(out).slice(5)).toEqual([
      'chart-revenue',
      'cashflow-13w',
      'crm-portfolio',
      'agenda',
      'chart-production',
      'quick-notes',
    ]);
  });

  it('override de id fora do template é ignorado (forward-compat)', () => {
    const out = mergeLayout(T, [{ id: 'alerts', hidden: false }, { id: 'chart-revenue', hidden: true }]);
    expect(ids(out)).not.toContain('alerts');
    expect(ids(out)).not.toContain('chart-revenue');
  });

  it('size só aplica se estiver nos presets do widget', () => {
    const out = mergeLayout(T, [
      { id: 'chart-revenue', size: 'full' },
      { id: 'ai-insights', size: 'half' }, // ai-insights é full-only
    ]);
    expect(out.find((w) => w.id === 'chart-revenue')?.size).toBe('full');
    expect(out.find((w) => w.id === 'ai-insights')?.size).toBeUndefined();
  });

  it('pinned sobe para o topo da parte reordenável, nunca acima da atenção', () => {
    const out = mergeLayout(T, [{ id: 'chart-production', pinned: true }]);
    expect(ids(out)[5]).toBe('chart-production');
    expect(ids(out)[2]).toBe('ai-insights');
  });
});

describe('hiddenWidgets', () => {
  it('lista só os ocultos que existem no template', () => {
    expect(
      hiddenWidgets(T, [
        { id: 'agenda', hidden: true },
        { id: 'alerts', hidden: true }, // fora do template executive
        { id: 'chart-revenue' },
      ]),
    ).toEqual(['agenda']);
    expect(hiddenWidgets(T, undefined)).toEqual([]);
  });
});
