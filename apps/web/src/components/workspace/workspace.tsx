'use client';

import { useMemo, useState } from 'react';
import { usePermission } from '@/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { WidgetInstance } from './types';
import { WIDGETS } from './widget-registry';
import { resolveProfile, TEMPLATES } from './templates';
import { WorkspacePeriodContext } from './workspace-context';
import { WidgetFrameSkeleton } from './widget-frame';

/**
 * Workspace — a Home por papel (F0).
 *
 * Pipeline: resolveProfile(roles v2, enum legado) → template do perfil →
 * filtro de elegibilidade por permissão (fail-closed: enquanto carrega,
 * widget gated vira skeleton) → render por zona.
 *
 * Zonas 'orientation' (saudação + KPIs de-boxed) empilham como seção única;
 * o resto entra num grid de 2 colunas onde size 'full' atravessa as duas.
 * A ordem narrativa (atenção antes de contexto) vem do template e é
 * garantida por spec — não é configurável.
 */
export function Workspace() {
  const user = useAuthStore((s) => s.user);
  const { canAny, isLoading, roles } = usePermission();
  const [periodDays, setPeriodDays] = useState<number>(30);

  const profile = resolveProfile(roles, user?.role);
  const template = TEMPLATES[profile];

  const { orientation, surface } = useMemo(() => {
    const eligible = (w: WidgetInstance) => {
      const def = WIDGETS[w.id];
      return def.permission.length === 0 || canAny(def.permission);
    };
    // Fail-closed: com permissões carregando, só widgets ungated aparecem;
    // os demais ficam de skeleton para não piscar conteúdo que pode sumir.
    const pending = (w: WidgetInstance) => isLoading && WIDGETS[w.id].permission.length > 0;
    const visible = template.widgets.filter((w) => pending(w) || eligible(w));
    return {
      orientation: visible.filter((w) => WIDGETS[w.id].zone === 'orientation'),
      surface: visible.filter((w) => WIDGETS[w.id].zone !== 'orientation'),
    };
  }, [template, canAny, isLoading]);

  const renderWidget = (w: WidgetInstance) => {
    const def = WIDGETS[w.id];
    if (isLoading && def.permission.length > 0) return <WidgetFrameSkeleton key={w.id} />;
    const C = def.Component;
    return <C key={w.id} instance={w} />;
  };

  return (
    <WorkspacePeriodContext.Provider value={{ periodDays, setPeriodDays }}>
      <div className="space-y-8">
        {/* Contexto + Resumo: saudação e KPIs formam UMA seção — os números
            pertencem ao "como estamos", não flutuam soltos na página */}
        <section className="space-y-5">{orientation.map(renderWidget)}</section>

        {/* Narrativa: atenção ("o que precisa de mim" → "o que fazer") antes
            de contexto (tendências) — ordem vem do template, por zona */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {surface.map((w) => {
            const size = w.size ?? WIDGETS[w.id].defaultSize;
            return (
              <div key={w.id} className={cn(size === 'full' && 'lg:col-span-2')}>
                {renderWidget(w)}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspacePeriodContext.Provider>
  );
}
