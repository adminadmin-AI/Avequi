'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import { usePermission } from '@/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LayoutOverride, WidgetId, WidgetInstance, WidgetSize } from './types';
import { WIDGETS } from './widget-registry';
import { WIDGET_META } from './widget-meta';
import { resolveProfile, TEMPLATES, type WorkspaceProfile } from './templates';
import { mergeLayout, hiddenWidgets } from './merge';
import { useWorkspaceLayout } from './use-workspace-layout';
import { WorkspacePeriodContext } from './workspace-context';
import { WidgetFrameSkeleton } from './widget-frame';
import { EditBar, HiddenTray } from './edit-bar';

// Maquinário de drag fora do chunk inicial (padrão #323): só baixa quando o
// usuário entra no modo edição. arrayMove reimplementado inline abaixo — o
// import estático de @dnd-kit/sortable puxaria o pacote inteiro pro chunk.
const EditSurface = dynamic(() => import('./edit-mode').then((m) => m.EditSurface), { ssr: false });
const EditableShell = dynamic(() => import('./edit-mode').then((m) => m.EditableShell), {
  ssr: false,
});

/**
 * Workspace — a Home por papel.
 *
 * Pipeline (F0→F2): resolveProfile (override salvo → roles v2 → enum legado)
 * → template do perfil → merge com os desvios persistidos do usuário →
 * filtro de elegibilidade por permissão (fail-closed) → render por zona.
 *
 * Personalização (F2): modo edição explícito — arrastar (só zonas work/
 * context; atenção nunca desce), ocultar/mostrar e presets half/full.
 * Cada mudança salva otimista em PUT /workspace/layout.
 */

const FIXED_ZONES = new Set(['orientation', 'attention']);

/** Equivalente ao arrayMove do @dnd-kit/sortable, sem custar o pacote no chunk. */
function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function Workspace() {
  const user = useAuthStore((s) => s.user);
  const { canAny, isLoading, roles } = usePermission();
  const { overrides, profileOverride, canEdit, save, reset } = useWorkspaceLayout();
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [editing, setEditing] = useState(false);

  const resolved = resolveProfile(roles, user?.role);
  const profile: WorkspaceProfile =
    profileOverride && profileOverride in TEMPLATES
      ? (profileOverride as WorkspaceProfile)
      : resolved;
  const template = TEMPLATES[profile];

  const merged = useMemo(() => mergeLayout(template, overrides), [template, overrides]);
  const hidden = useMemo(() => hiddenWidgets(template, overrides), [template, overrides]);

  const { orientation, surface } = useMemo(() => {
    const eligible = (w: WidgetInstance) => {
      const def = WIDGETS[w.id];
      return def.permission.length === 0 || canAny(def.permission);
    };
    // Fail-closed: com permissões carregando, só widgets ungated aparecem;
    // os demais ficam de skeleton para não piscar conteúdo que pode sumir.
    const pending = (w: WidgetInstance) => isLoading && WIDGETS[w.id].permission.length > 0;
    const visible = merged.filter((w) => pending(w) || eligible(w));
    return {
      orientation: visible.filter((w) => WIDGETS[w.id].zone === 'orientation'),
      surface: visible.filter((w) => WIDGETS[w.id].zone !== 'orientation'),
    };
  }, [merged, canAny, isLoading]);

  // ─── Ações de edição (todas salvam otimista) ───────────────────────────────

  const upsertOverride = useCallback(
    (id: WidgetId, patch: Partial<LayoutOverride>) => {
      const current = overrides ?? [];
      const existing = current.find((o) => o.id === id);
      const entry: LayoutOverride = { ...(existing ?? { id }), ...patch };
      // JSON sparse: flag no valor default sai do desvio
      if (!entry.hidden) delete entry.hidden;
      if (!entry.pinned) delete entry.pinned;
      if (!entry.size) delete entry.size;
      const next = existing ? current.map((o) => (o.id === id ? entry : o)) : [...current, entry];
      // entradas de zona fixa sem nenhum desvio real são lixo — limpa
      const isNoop = (o: LayoutOverride) =>
        !o.size && !o.hidden && !o.pinned && FIXED_ZONES.has(WIDGET_META[o.id]?.zone ?? 'work');
      save(next.filter((o) => !isNoop(o)));
    },
    [overrides, save],
  );

  const sortableIds = useMemo(
    () => surface.filter((w) => !FIXED_ZONES.has(WIDGETS[w.id].zone)).map((w) => w.id),
    [surface],
  );

  const handleReorder = useCallback(
    (activeId: WidgetId, overId: WidgetId) => {
      const from = sortableIds.indexOf(activeId);
      const to = sortableIds.indexOf(overId);
      if (from < 0 || to < 0) return;
      const newOrder = arrayMove(sortableIds, from, to);
      const current = overrides ?? [];
      const entryOf = (id: WidgetId): LayoutOverride => current.find((o) => o.id === id) ?? { id };
      // ordem dos reordenáveis = novo arranjo; demais desvios preservados no fim
      const rest = current.filter((o) => !newOrder.includes(o.id));
      save([...newOrder.map(entryOf), ...rest]);
    },
    [sortableIds, overrides, save],
  );

  const renderWidget = (w: WidgetInstance) => {
    const def = WIDGETS[w.id];
    if (isLoading && def.permission.length > 0) return <WidgetFrameSkeleton />;
    const C = def.Component;
    return <C instance={w} />;
  };

  // Visualização: grid alinhado com CARDS DA MESMA LINHA NA MESMA ALTURA —
  // o grid estica a célula pela linha (align stretch) e o Card do WidgetFrame
  // usa h-full para acompanhar. O espaçamento fica linear (gap-4 em tudo,
  // linhas alinhadas) e a diferença de conteúdo vira respiro DENTRO do card,
  // nunca buraco entre cards (achado da auditoria visual, 30/07).
  //
  // grid-flow-dense: um half depois de um full sobe para preencher o buraco
  // que o full deixou — nunca fica cratera no MEIO do grid. Com dense e só
  // presets half/full, sobra vazio apenas na ÚLTIMA linha, e apenas quando o
  // número de halves é ímpar — essa célula vira o convite "Adicionar widget".
  const trailingSlot =
    surface.filter((w) => (w.size ?? WIDGETS[w.id].defaultSize) === 'half').length % 2 === 1;
  const viewSurface = (
    <div className="grid grid-cols-1 gap-4 lg:grid-flow-dense lg:grid-cols-2">
      {surface.map((w) => {
        const size = w.size ?? WIDGETS[w.id].defaultSize;
        return (
          <div key={w.id} className={cn(size === 'full' && 'lg:col-span-2')}>
            {renderWidget(w)}
          </div>
        );
      })}
      {trailingSlot && canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="hidden min-h-[140px] items-center justify-center gap-2 rounded-xl border border-dashed border-line text-caption font-medium text-content-muted transition-colors duration-flow ease-flow hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-600 dark:hover:text-brand-400 lg:flex"
        >
          <Plus size={15} /> Adicionar widget
        </button>
      )}
    </div>
  );

  // Edição: grid uniforme de propósito — arrastar em células regulares é mais
  // previsível que em colunas empacotadas; o encaixe fino é da visualização.
  const editSurfaceGrid = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {surface.map((w) => {
        const size = w.size ?? WIDGETS[w.id].defaultSize;
        return (
          <div key={w.id} className={cn(size === 'full' && 'lg:col-span-2')}>
            <EditableShell
              id={w.id}
              size={size}
              sortable={!FIXED_ZONES.has(WIDGETS[w.id].zone)}
              onHide={(id) => upsertOverride(id, { hidden: true })}
              onResize={(id, s: WidgetSize) => upsertOverride(id, { size: s })}
            >
              {renderWidget(w)}
            </EditableShell>
          </div>
        );
      })}
    </div>
  );

  return (
    <WorkspacePeriodContext.Provider value={{ periodDays, setPeriodDays }}>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-deliberate ease-flow">
        {/* Contexto + Resumo: saudação e KPIs formam UM BLOCO — um único
            container (auditoria UX 30/07: soltos sobre o canvas, "flutuavam").
            No modo edição a seção esmaece: sinaliza que a orientação é fixa. */}
        {orientation.length > 0 && (
          <Card
            className={cn(
              'space-y-6 px-5 py-5 transition-opacity duration-flow',
              editing && 'opacity-50',
            )}
          >
            {orientation.map((w) => (
              <div key={w.id}>{renderWidget(w)}</div>
            ))}
          </Card>
        )}

        <div className="space-y-3">
          <EditBar
            editing={editing}
            canEdit={canEdit}
            onToggle={() => setEditing((e) => !e)}
            onReset={() => {
              reset();
              setEditing(false);
            }}
          />

          {/* Narrativa: atenção antes de contexto — a ordem das zonas fixas vem
              do template; a personalização só reordena work/context */}
          {editing ? (
            <EditSurface sortableIds={sortableIds} onReorder={handleReorder}>
              {editSurfaceGrid}
            </EditSurface>
          ) : (
            viewSurface
          )}

          {editing && (
            <HiddenTray ids={hidden} onShow={(id) => upsertOverride(id, { hidden: false })} />
          )}
        </div>
      </div>
    </WorkspacePeriodContext.Provider>
  );
}
