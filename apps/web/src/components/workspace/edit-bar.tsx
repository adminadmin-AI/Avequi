'use client';

import { Check, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WidgetId } from './types';
import { WIDGET_META } from './widget-meta';

/**
 * Controles leves do modo edição (F2) — SEM dnd-kit neste módulo, de
 * propósito: isto entra no chunk inicial da rota /app; o maquinário de
 * drag (edit-mode.tsx) só chega via next/dynamic quando o usuário
 * clica em "Personalizar dashboard".
 */

export function EditBar({
  editing,
  canEdit,
  onToggle,
  onReset,
}: {
  editing: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  if (!canEdit) return null;
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      {/* No modo edição, a barra explica o que dá pra fazer — fora dele, some. */}
      <p className="text-caption text-content-muted">
        {editing ? 'Arraste para reordenar · escolha o tamanho (P/M/G) · oculte o que não usa' : ''}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        {editing && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw size={14} /> Restaurar padrão
          </Button>
        )}
        <Button variant={editing ? 'primary' : 'ghost'} size="sm" onClick={onToggle}>
          {editing ? (
            <>
              <Check size={14} /> Concluído
            </>
          ) : (
            <>
              <SlidersHorizontal size={14} /> Personalizar dashboard
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Área de adicionar widgets — só existe no modo edição. Widgets ocultos
 * aparecem como cards de convite; sem nenhum oculto, a área explica que o
 * dashboard já mostra tudo que o perfil tem.
 */
export function HiddenTray({ ids, onShow }: { ids: WidgetId[]; onShow: (id: WidgetId) => void }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-3">
      <p className="mb-2 text-helper font-medium uppercase tracking-wide text-content-muted">
        Adicionar widgets
      </p>
      {ids.length === 0 ? (
        <p className="pb-1 text-caption text-content-muted">
          Todos os widgets do seu perfil já estão no dashboard.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {ids.map((id) => (
            <button
              key={id}
              onClick={() => onShow(id)}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm text-content-secondary transition-colors duration-micro hover:border-brand-400 hover:text-content dark:hover:border-brand-600"
            >
              <Plus size={14} className="shrink-0 text-brand-600 dark:text-brand-400" />
              <span className="truncate">{WIDGET_META[id].title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
